import { NextResponse } from 'next/server'
import { isPostHogConfigured } from '@/lib/posthog'
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
  if (!res.ok) return []
  const data = await res.json()
  return (data.results as unknown[][] ?? [])
}

export async function GET(request: Request) {
  if (!isPostHogConfigured()) {
    return NextResponse.json({ error: 'PostHog not configured' }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const days = Math.min(parseInt(searchParams.get('days') ?? '30'), 90)
  const org  = searchParams.get('org') ?? null

  const orgFilter = org ? `AND properties.organization = '${org.replace(/'/g, "\\'")}'` : ''
  const orgExclude = `AND properties.organization IS NOT NULL AND properties.organization != '' AND properties.organization NOT IN ('empty', 'sign-in')`

  // Main user metrics + session duration in a single query using a subquery for avg duration
  const rows = await hogql(`
    SELECT
      properties.user_email     AS email,
      properties.organization   AS org,
      count(distinct properties.$session_id) AS sessions,
      count()                   AS pageviews,
      max(timestamp)            AS last_seen
    FROM events
    WHERE event = '$pageview'
      AND timestamp >= now() - interval ${days} day
      AND properties.user_email IS NOT NULL
      AND properties.user_email != ''
      ${orgExclude}
      ${orgFilter}
    GROUP BY email, org
    ORDER BY sessions DESC
    LIMIT 200
  `)

  // Fetch average session duration per (email, org) — derived from min/max timestamp per session_id
  const durationRows = await hogql(`
    SELECT
      email,
      org,
      avg(duration) AS avg_duration
    FROM (
      SELECT
        properties.user_email AS email,
        properties.organization AS org,
        properties.$session_id AS sid,
        dateDiff('second', min(timestamp), max(timestamp)) AS duration
      FROM events
      WHERE event = '$pageview'
        AND timestamp >= now() - interval ${days} day
        AND properties.user_email IS NOT NULL
        AND properties.user_email != ''
        AND properties.$session_id IS NOT NULL
        ${orgExclude}
        ${orgFilter}
      GROUP BY email, org, sid
      HAVING duration > 0
    )
    GROUP BY email, org
  `)
  const durationMap = new Map<string, number>()
  for (const r of durationRows) {
    const key = `${String(r[0] ?? '').toLowerCase()}|${String(r[1] ?? '').toLowerCase()}`
    durationMap.set(key, Math.round(Number(r[2] ?? 0)))
  }

  // Enrich with client data (name, tier) from Postgres
  const sql = await db()
  const clientRows = await sql<{ id: number; name: string; client_code: string; tier: number | null }[]>`
    SELECT id, name, client_code, tier FROM clients
    WHERE client_code IS NOT NULL
  `
  const clientMap = new Map<string, { id: number; name: string; tier: number | null }>(
    clientRows.map((c) => [c.client_code.toLowerCase(), c]),
  )

  const users = rows.map((r) => {
    const email      = String(r[0] ?? '')
    const orgCode    = String(r[1] ?? '')
    const sessions   = Number(r[2] ?? 0)
    const pageviews  = Number(r[3] ?? 0)
    const last_seen  = String(r[4] ?? '')
    const client     = clientMap.get(orgCode.toLowerCase()) ?? null
    const isInternal = email.includes('witailer') || email.includes('retex') || email.includes('alkemy')

    const durationKey = `${email.toLowerCase()}|${orgCode.toLowerCase()}`
    return {
      email,
      org: orgCode,
      client_id:   client?.id ?? null,
      client_name: client?.name ?? null,
      tier:        client?.tier ?? null,
      sessions,
      pageviews,
      avg_session_seconds: durationMap.get(durationKey) ?? 0,
      last_seen,
      is_internal: isInternal,
    }
  })

  return NextResponse.json({ users, days })
}
