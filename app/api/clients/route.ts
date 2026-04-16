import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { calculateHealthScore, calculateBugScore, calculatePriorityScore, getDaysSince } from '@/lib/health'
import { usageScoreFromSummary, daysSince as phDaysSince } from '@/lib/posthog'
import type { UsageSummary } from '@/lib/types'

export async function GET() {
  const sql = await db()

  const [{ bug_count }] = await sql<{ bug_count: number }[]>`SELECT COUNT(*)::int AS bug_count FROM bugs`
  const hasBugData = bug_count > 0

  const rows = await sql<Record<string, unknown>[]>`
    SELECT c.*,
           tp.date  AS last_touchpoint_date,
           tp.type  AS last_touchpoint_type,
           tp.notes AS last_touchpoint_notes,
           COALESCE(bo.open_count,     0)::int AS open_bugs,
           COALESCE(bo.critical_count, 0)::int AS critical_bugs,
           COALESCE(bo.high_count,     0)::int AS high_bugs,
           COALESCE(br.resolved_count, 0)::int AS resolved_bugs,
           phc.value AS phc_value,
           COALESCE(
             (SELECT co.external_members FROM clerk_organizations co WHERE LOWER(TRIM(co.slug)) = LOWER(TRIM(c.client_code)) LIMIT 1),
             (SELECT co.external_members FROM clerk_organizations co WHERE LOWER(TRIM(c.client_code)) LIKE LOWER(TRIM(co.slug)) || '%' AND LENGTH(co.slug) >= 4 ORDER BY LENGTH(co.slug) DESC LIMIT 1)
           ) AS clerk_external_members
    FROM clients c
    LEFT JOIN LATERAL (
      SELECT date, type, notes FROM touchpoints
      WHERE client_id = c.id
      ORDER BY date DESC, created_at DESC
      LIMIT 1
    ) tp ON TRUE
    LEFT JOIN (
      SELECT LOWER(TRIM(reported_by)) AS rby,
             COUNT(*)::int AS open_count,
             SUM(CASE WHEN priority = 'Critical' THEN 1 ELSE 0 END)::int AS critical_count,
             SUM(CASE WHEN priority = 'High'     THEN 1 ELSE 0 END)::int AS high_count
      FROM bugs
      WHERE status IN ('Open', 'In Progress', 'Testing')
      GROUP BY LOWER(TRIM(reported_by))
    ) bo ON LOWER(TRIM(c.client_code)) = bo.rby
    LEFT JOIN (
      SELECT LOWER(TRIM(reported_by)) AS rby, COUNT(*)::int AS resolved_count
      FROM bugs
      WHERE status IN ('Fixed', 'Closed')
      GROUP BY LOWER(TRIM(reported_by))
    ) br ON LOWER(TRIM(c.client_code)) = br.rby
    LEFT JOIN posthog_usage_cache phc
      ON LOWER(TRIM(phc.client_code)) = LOWER(TRIM(c.client_code))
     AND phc.metric_type = 'summary'
     AND phc.user_type   = 'all'
     AND phc.period_days = 30
    ORDER BY c.name
  `

  const result = rows.map((c) => {
    // Parse PostHog cache
    let phData: UsageSummary | null = null
    if (c.phc_value) {
      try { phData = JSON.parse(c.phc_value as string) as UsageSummary } catch { /* ignore */ }
    }

    const clerkHasExternal = (c.clerk_external_members as number | null) != null && (c.clerk_external_members as number) > 0
    const isInternalUse = !!phData && phData.adoption_level === 'PM-driven' && !clerkHasExternal
    let usageScore = phData ? usageScoreFromSummary(phData) : null
    // Internal-use clients: neutralize usage and recency — managed internally by PMs
    if (usageScore !== null && isInternalUse) {
      usageScore = 50
    }
    const bugInfo = hasBugData ? {
      open:     c.open_bugs as number,
      critical: c.critical_bugs as number,
      high:     c.high_bugs as number,
      resolved: c.resolved_bugs as number,
    } : null
    const rawScore = isInternalUse
      ? Math.round(
          0.50 * (bugInfo ? calculateBugScore(bugInfo.open, bugInfo.critical, bugInfo.high, bugInfo.resolved) : 100)
          + 0.50 * (usageScore ?? 50)
        )
      : calculateHealthScore(
          c.last_touchpoint_date as string | null,
          c.last_touchpoint_type as string | null,
          bugInfo,
          hasBugData,
          usageScore,
        )
    const { priorityScore, penalty } = calculatePriorityScore(rawScore, c.tier as number | null)

    return {
      ...c,
      phc_value: undefined, // don't expose raw JSON
      modules_active: c.modules_active ? JSON.parse(c.modules_active as string) : [],
      days_since_contact: getDaysSince(c.last_touchpoint_date as string | null),
      raw_score:    rawScore,
      tier_penalty: penalty,
      health_score: priorityScore,
      // PostHog summary fields for dashboard display
      adoption_level:          phData?.adoption_level        ?? 'New',
      active_external:         phData?.active_external       ?? 0,
      active_internal:         phData?.active_internal       ?? 0,
      last_seen_external_days: phData ? phDaysSince(phData.last_seen_external?.last_seen_at ?? null) : null,
      last_seen_internal_days: phData ? phDaysSince(phData.last_seen_internal?.last_seen_at ?? null) : null,
      has_posthog_data:        !!phData,
      clerk_has_external:      (c.clerk_external_members as number | null) != null && (c.clerk_external_members as number) > 0,
    }
  })

  return NextResponse.json(result)
}

export async function POST(request: Request) {
  const sql = await db()
  const body = await request.json()
  const { name, company, pm_assigned, contract_type, modules_active, market, status, notes, client_code, tier } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const [newClient] = await sql`
    INSERT INTO clients (name, company, pm_assigned, contract_type, modules_active, market, status, notes, client_code, tier)
    VALUES (
      ${name.trim()},
      ${company || null},
      ${pm_assigned || null},
      ${contract_type || null},
      ${modules_active?.length ? JSON.stringify(modules_active) : null},
      ${market || null},
      ${status || 'active'},
      ${notes || null},
      ${client_code?.trim().toUpperCase() || null},
      ${tier ? parseInt(tier) : 3}
    )
    RETURNING *
  `

  return NextResponse.json({
    ...newClient,
    modules_active: newClient.modules_active ? JSON.parse(newClient.modules_active as string) : [],
  }, { status: 201 })
}
