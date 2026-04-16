import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { calculateHealthScore, calculatePriorityScore, getDaysSince } from '@/lib/health'
import { isPostHogConfigured, usageScoreFromSummary, daysSince as phDaysSince } from '@/lib/posthog'
import type { UsageSummary } from '@/lib/types'

type Params = Promise<{ id: string }>

export async function GET(_req: Request, { params }: { params: Params }) {
  const { id } = await params
  const sql = await db()

  const [{ bug_count }] = await sql<{ bug_count: number }[]>`SELECT COUNT(*)::int AS bug_count FROM bugs`
  const hasBugData = bug_count > 0

  const rows = await sql<Record<string, unknown>[]>`
    SELECT c.*,
           tp.date  AS last_touchpoint_date,
           tp.type  AS last_touchpoint_type,
           COALESCE(bo.open_count,     0)::int AS open_bugs,
           COALESCE(bo.critical_count, 0)::int AS critical_bugs,
           COALESCE(bo.high_count,     0)::int AS high_bugs,
           COALESCE(br.resolved_count, 0)::int AS resolved_bugs,
           phc.value AS phc_value
    FROM clients c
    LEFT JOIN LATERAL (
      SELECT date, type FROM touchpoints
      WHERE client_id = c.id
      ORDER BY date DESC, created_at DESC
      LIMIT 1
    ) tp ON TRUE
    LEFT JOIN (
      SELECT LOWER(TRIM(reported_by)) AS rby,
             COUNT(*)::int AS open_count,
             SUM(CASE WHEN priority = 'Critical' THEN 1 ELSE 0 END)::int AS critical_count,
             SUM(CASE WHEN priority = 'High'     THEN 1 ELSE 0 END)::int AS high_count
      FROM bugs WHERE status IN ('Open', 'In Progress', 'Testing')
      GROUP BY LOWER(TRIM(reported_by))
    ) bo ON LOWER(TRIM(c.client_code)) = bo.rby
    LEFT JOIN (
      SELECT LOWER(TRIM(reported_by)) AS rby, COUNT(*)::int AS resolved_count
      FROM bugs WHERE status IN ('Fixed', 'Closed')
      GROUP BY LOWER(TRIM(reported_by))
    ) br ON LOWER(TRIM(c.client_code)) = br.rby
    LEFT JOIN posthog_usage_cache phc
      ON LOWER(TRIM(phc.client_code)) = LOWER(TRIM(c.client_code))
     AND phc.metric_type = 'summary'
     AND phc.user_type   = 'all'
     AND phc.period_days = 30
    WHERE c.id = ${parseInt(id)}
  `
  const row = rows[0]
  if (!row) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  let phData: UsageSummary | null = null
  if (row.phc_value) {
    try { phData = JSON.parse(row.phc_value as string) as UsageSummary } catch { /* ignore */ }
  }

  const usageScore = phData ? usageScoreFromSummary(phData) : null
  const rawScore = calculateHealthScore(
    row.last_touchpoint_date as string | null,
    row.last_touchpoint_type as string | null,
    hasBugData ? {
      open: row.open_bugs as number, critical: row.critical_bugs as number,
      high: row.high_bugs as number, resolved: row.resolved_bugs as number,
    } : null,
    hasBugData,
    usageScore,
  )
  const { priorityScore, penalty } = calculatePriorityScore(rawScore, row.tier as number | null)

  return NextResponse.json({
    ...row,
    phc_value: undefined,
    modules_active: row.modules_active ? JSON.parse(row.modules_active as string) : [],
    days_since_contact: getDaysSince(row.last_touchpoint_date as string | null),
    raw_score:    rawScore,
    tier_penalty: penalty,
    health_score: priorityScore,
    adoption_level:          phData?.adoption_level        ?? 'New',
    active_external:         phData?.active_external       ?? 0,
    active_internal:         phData?.active_internal       ?? 0,
    last_seen_external_days: phData ? phDaysSince(phData.last_seen_external?.last_seen_at ?? null) : null,
    last_seen_internal_days: phData ? phDaysSince(phData.last_seen_internal?.last_seen_at ?? null) : null,
    has_posthog_data:        !!phData,
    posthog_configured:      isPostHogConfigured(),
  })
}

export async function PUT(request: Request, { params }: { params: Params }) {
  const { id } = await params
  const sql = await db()
  const body = await request.json()
  const { name, company, pm_assigned, contract_type, modules_active, market, status, notes, client_code, tier } = body

  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

  await sql`
    UPDATE clients SET
      name           = ${name.trim()},
      company        = ${company || null},
      pm_assigned    = ${pm_assigned || null},
      contract_type  = ${contract_type || null},
      modules_active = ${modules_active?.length ? JSON.stringify(modules_active) : null},
      market         = ${market || null},
      status         = ${status || 'active'},
      notes          = ${notes || null},
      client_code    = ${client_code?.trim().toUpperCase() || null},
      tier           = ${tier ? parseInt(tier) : 3},
      updated_at     = NOW()
    WHERE id = ${parseInt(id)}
  `

  const [updated] = await sql<Record<string, unknown>[]>`SELECT * FROM clients WHERE id = ${parseInt(id)}`
  return NextResponse.json({
    ...updated,
    modules_active: updated.modules_active ? JSON.parse(updated.modules_active as string) : [],
  })
}

export async function DELETE(_req: Request, { params }: { params: Params }) {
  const { id } = await params
  const sql = await db()
  await sql`DELETE FROM clients WHERE id = ${parseInt(id)}`
  return NextResponse.json({ success: true })
}
