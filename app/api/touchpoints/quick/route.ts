import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { calculateHealthScore, calculatePriorityScore, getDaysSince } from '@/lib/health'
import { isPostHogConfigured, usageScoreFromSummary } from '@/lib/posthog'
import type { UsageSummary } from '@/lib/types'

export async function POST(request: Request) {
  const sql = await db()
  const body = await request.json()
  const { client_id, type, notes, date } = body

  if (!client_id || !type) {
    return NextResponse.json({ error: 'client_id and type are required' }, { status: 400 })
  }
  if (!['teams', 'email', 'feedback', 'training'].includes(type)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }

  // If date provided, validate it's not in the future
  const today = new Date().toISOString().split('T')[0]
  const tpDate = (date && date <= today) ? date : today

  const [touchpoint] = await sql`
    INSERT INTO touchpoints (client_id, date, type, notes)
    VALUES (${client_id}, ${tpDate}, ${type}, ${notes || null})
    RETURNING *
  `

  const bugCountRow = await sql<{ bug_count: number }[]>`SELECT COUNT(*)::int AS bug_count FROM bugs`
  const hasBugData = bugCountRow[0].bug_count > 0

  const rows = await sql<Record<string, unknown>[]>`
    SELECT c.*,
           tp.date AS last_touchpoint_date,
           tp.type AS last_touchpoint_type,
           COALESCE(bo.open_count,     0) AS open_bugs,
           COALESCE(bo.critical_count, 0) AS critical_bugs,
           COALESCE(bo.high_count,     0) AS high_bugs,
           COALESCE(br.resolved_count, 0) AS resolved_bugs,
           phc.value AS phc_value
    FROM clients c
    LEFT JOIN LATERAL (
      SELECT date, type FROM touchpoints
      WHERE client_id = c.id
      ORDER BY date DESC, created_at DESC LIMIT 1
    ) tp ON TRUE
    LEFT JOIN (
      SELECT LOWER(TRIM(reported_by)) AS rby,
             COUNT(*)::int AS open_count,
             SUM(CASE WHEN priority='Critical' THEN 1 ELSE 0 END)::int AS critical_count,
             SUM(CASE WHEN priority='High' THEN 1 ELSE 0 END)::int AS high_count
      FROM bugs WHERE status IN ('Open','In Progress','Testing')
      GROUP BY LOWER(TRIM(reported_by))
    ) bo ON LOWER(TRIM(c.client_code)) = bo.rby
    LEFT JOIN (
      SELECT LOWER(TRIM(reported_by)) AS rby, COUNT(*)::int AS resolved_count
      FROM bugs WHERE status IN ('Fixed','Closed')
      GROUP BY LOWER(TRIM(reported_by))
    ) br ON LOWER(TRIM(c.client_code)) = br.rby
    LEFT JOIN posthog_usage_cache phc
      ON phc.client_code = c.client_code
     AND phc.metric_type = 'summary'
     AND phc.user_type   = 'all'
     AND phc.period_days = 30
    WHERE c.id = ${client_id}
  `
  const row = rows[0] ?? {}

  let phData: UsageSummary | null = null
  if (isPostHogConfigured() && row.phc_value) {
    try { phData = JSON.parse(row.phc_value as string) as UsageSummary } catch { /* ignore */ }
  }
  const usageScore = phData ? usageScoreFromSummary(phData) : null
  const rawScore = calculateHealthScore(
    row.last_touchpoint_date as string | null,
    row.last_touchpoint_type as string | null,
    hasBugData ? {
      open: row.open_bugs as number,
      critical: row.critical_bugs as number,
      high: row.high_bugs as number,
      resolved: row.resolved_bugs as number,
    } : null,
    hasBugData,
    usageScore,
  )
  const { priorityScore, penalty } = calculatePriorityScore(rawScore, row.tier as number | null)

  const updatedClient = {
    ...row,
    phc_value: undefined,
    modules_active: row.modules_active ? JSON.parse(row.modules_active as string) : [],
    days_since_contact: getDaysSince(row.last_touchpoint_date as string | null),
    raw_score:    rawScore,
    tier_penalty: penalty,
    health_score: priorityScore,
    adoption_level: phData?.adoption_level ?? 'New',
    active_external: phData?.active_external ?? 0,
    active_internal: phData?.active_internal ?? 0,
  }

  return NextResponse.json({ touchpoint, client: updatedClient }, { status: 201 })
}
