import { NextResponse } from 'next/server'
import { isPostHogConfigured, isInternalUser } from '@/lib/posthog'
import { db } from '@/lib/db'

const POSTHOG_HOST       = process.env.POSTHOG_HOST ?? 'https://eu.posthog.com'
const POSTHOG_API_KEY    = process.env.POSTHOG_API_KEY
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID

async function hogql(query: string): Promise<unknown[][]> {
  const res = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${POSTHOG_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  })
  if (!res.ok) {
    const text = await res.text()
    console.error('HogQL error:', res.status, text)
    return []
  }
  const data = await res.json()
  return (data.results as unknown[][] ?? [])
}

const ORG_EXCLUDE = `AND properties.organization IS NOT NULL AND properties.organization != '' AND properties.organization NOT IN ('empty', 'sign-in')`
const EMAIL_FILTER = `AND properties.user_email IS NOT NULL AND properties.user_email != ''`

export async function GET(request: Request) {
  if (!isPostHogConfigured()) {
    return NextResponse.json({ error: 'PostHog not configured' }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const days = Math.min(parseInt(searchParams.get('days') ?? '30'), 90)

  // 3 queries in parallel:
  // 1. Current period sessions per org+email (last N days)
  // 2. Previous period sessions per org+email (N-2N days ago)
  // 3. Weekly breakdown for sparkline (last 90 days, bucketed by week number)
  // NOTE: explicit LIMIT in SQL — HogQL defaults to 100 rows otherwise, which
  // silently truncates the GROUP BY result and drops clients alphabetically.
  const [currentRows, prevRows, weeklyRows] = await Promise.all([
    hogql(`
      SELECT
        properties.organization   AS org,
        properties.user_email     AS email,
        count(distinct properties.$session_id) AS sessions
      FROM events
      WHERE event = '$pageview'
        AND timestamp >= now() - interval ${days} day
        ${EMAIL_FILTER} ${ORG_EXCLUDE}
      GROUP BY org, email
      LIMIT 10000
    `),
    hogql(`
      SELECT
        properties.organization   AS org,
        properties.user_email     AS email,
        count(distinct properties.$session_id) AS sessions
      FROM events
      WHERE event = '$pageview'
        AND timestamp >= now() - interval ${days * 2} day
        AND timestamp < now() - interval ${days} day
        ${EMAIL_FILTER} ${ORG_EXCLUDE}
      GROUP BY org, email
      LIMIT 10000
    `),
    hogql(`
      SELECT
        properties.organization   AS org,
        properties.user_email     AS email,
        floor(dateDiff('day', timestamp, now()) / 7) AS weeks_ago,
        count(distinct properties.$session_id) AS sessions
      FROM events
      WHERE event = '$pageview'
        AND timestamp >= now() - interval 90 day
        ${EMAIL_FILTER} ${ORG_EXCLUDE}
      GROUP BY org, email, weeks_ago
      ORDER BY org, weeks_ago
      LIMIT 10000
    `),
  ])

  // Aggregate current period (external only)
  const currentTotals = new Map<string, number>()
  for (const r of currentRows) {
    const org   = String(r[0] ?? '').toLowerCase()
    const email = String(r[1] ?? '')
    const sess  = Number(r[2] ?? 0)
    if (isInternalUser(email)) continue
    currentTotals.set(org, (currentTotals.get(org) ?? 0) + sess)
  }

  // Aggregate previous period (external only)
  const prevTotals = new Map<string, number>()
  for (const r of prevRows) {
    const org   = String(r[0] ?? '').toLowerCase()
    const email = String(r[1] ?? '')
    const sess  = Number(r[2] ?? 0)
    if (isInternalUser(email)) continue
    prevTotals.set(org, (prevTotals.get(org) ?? 0) + sess)
  }

  // Aggregate weekly sparkline data (external only)
  // weeks_ago: 0 = this week, 1 = last week, etc. → we want 13 buckets (0-12)
  const NUM_WEEKS = 13
  const weeklyMap = new Map<string, number[]>()
  for (const r of weeklyRows) {
    const org      = String(r[0] ?? '').toLowerCase()
    const email    = String(r[1] ?? '')
    const weeksAgo = Number(r[2] ?? 0)
    const sess     = Number(r[3] ?? 0)
    if (isInternalUser(email)) continue
    if (weeksAgo < 0 || weeksAgo >= NUM_WEEKS) continue

    if (!weeklyMap.has(org)) weeklyMap.set(org, new Array(NUM_WEEKS).fill(0))
    const arr = weeklyMap.get(org)!
    // Index 0 = oldest week, index 12 = this week
    arr[NUM_WEEKS - 1 - weeksAgo] += sess
  }

  // Enrich with client data from Postgres
  const sql = await db()
  const clients = await sql<{ id: number; name: string; client_code: string; tier: number | null; arr: number | null }[]>`
    SELECT id, name, client_code, tier, arr FROM clients
    WHERE status = 'active' AND client_code IS NOT NULL
  `

  const results = clients.map((c) => {
    const code = c.client_code.toLowerCase()
    const current  = currentTotals.get(code) ?? 0
    const previous = prevTotals.get(code) ?? 0
    const delta_pct = previous > 0
      ? Math.round(((current - previous) / previous) * 100)
      : current > 0 ? null : null  // no previous data

    const weekly_sessions = weeklyMap.get(code) ?? new Array(NUM_WEEKS).fill(0)

    return {
      client_id:    c.id,
      client_name:  c.name,
      client_code:  c.client_code,
      tier:         c.tier,
      arr:          c.arr,
      sessions_current:  current,
      sessions_previous: previous,
      delta_pct,
      weekly_sessions,
    }
  })
  // Filter out clients with zero activity in both periods
  .filter((r) => r.sessions_current > 0 || r.sessions_previous > 0)
  // Sort by delta ascending (worst decline first), nulls at end
  .sort((a, b) => {
    if (a.delta_pct === null && b.delta_pct === null) return (b.sessions_current - a.sessions_current)
    if (a.delta_pct === null) return 1
    if (b.delta_pct === null) return -1
    return a.delta_pct - b.delta_pct
  })

  return NextResponse.json({ days, clients: results })
}
