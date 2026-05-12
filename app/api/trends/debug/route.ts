import { NextResponse } from 'next/server'
import { isPostHogConfigured, isInternalUser } from '@/lib/posthog'

const POSTHOG_HOST       = process.env.POSTHOG_HOST ?? 'https://eu.posthog.com'
const POSTHOG_API_KEY    = process.env.POSTHOG_API_KEY
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID

async function hogql(query: string): Promise<{ rows: unknown[][]; rowCount: number; raw: unknown }> {
  const res = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${POSTHOG_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  })
  if (!res.ok) {
    const text = await res.text()
    return { rows: [], rowCount: 0, raw: { error: text, status: res.status } }
  }
  const data = await res.json() as { results?: unknown[][]; hasMore?: boolean; limit?: number }
  return {
    rows: (data.results ?? []) as unknown[][],
    rowCount: (data.results ?? []).length,
    raw: { hasMore: data.hasMore, limit: data.limit },
  }
}

export async function GET(request: Request) {
  if (!isPostHogConfigured()) {
    return NextResponse.json({ error: 'PostHog not configured' }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const client = (searchParams.get('client') ?? 'SODAL').toUpperCase()
  const days   = parseInt(searchParams.get('days') ?? '30')

  // Replicate exactly the trends API query, but inspect what comes back for this specific client
  const trendsStyleAll = await hogql(`
    SELECT
      properties.organization   AS org,
      properties.user_email     AS email,
      count(distinct properties.$session_id) AS sessions
    FROM events
    WHERE event = '$pageview'
      AND timestamp >= now() - interval ${days} day
      AND properties.user_email IS NOT NULL AND properties.user_email != ''
      AND properties.organization IS NOT NULL AND properties.organization != ''
      AND properties.organization NOT IN ('empty', 'sign-in')
    GROUP BY org, email
  `)

  // Same query but explicitly filtered to this client (to see if it's a row-cap issue)
  const trendsStyleFiltered = await hogql(`
    SELECT
      properties.organization   AS org,
      properties.user_email     AS email,
      count(distinct properties.$session_id) AS sessions
    FROM events
    WHERE event = '$pageview'
      AND timestamp >= now() - interval ${days} day
      AND properties.user_email IS NOT NULL AND properties.user_email != ''
      AND lower(properties.organization) = '${client.toLowerCase()}'
    GROUP BY org, email
  `)

  // Per-client style query (what /clients/[id] uses via syncClientUsage)
  const perClientStyle = await hogql(`
    SELECT
      properties.user_email AS email,
      count(distinct properties.$session_id) AS sessions
    FROM events
    WHERE event = '$pageview'
      AND properties.organization = '${client}'
      AND timestamp >= now() - interval ${days} day
      AND timestamp < now() - interval 0 day
      AND properties.user_email IS NOT NULL
      AND properties.user_email != ''
    GROUP BY email
  `)

  // Aggregate trends-style results to see what trends API sees for this client
  let trendsExtForClient = 0
  let trendsIntForClient = 0
  const trendsClientRows: { org: string; email: string; sessions: number; internal: boolean }[] = []
  for (const r of trendsStyleAll.rows) {
    const org   = String(r[0] ?? '')
    if (org.toLowerCase() !== client.toLowerCase()) continue
    const email = String(r[1] ?? '')
    const sess  = Number(r[2] ?? 0)
    const internal = isInternalUser(email)
    trendsClientRows.push({ org, email, sessions: sess, internal })
    if (internal) trendsIntForClient += sess
    else trendsExtForClient += sess
  }

  // Aggregate per-client style
  let perClientExt = 0
  let perClientInt = 0
  const perClientUsers: { email: string; sessions: number; internal: boolean }[] = []
  for (const r of perClientStyle.rows) {
    const email = String(r[0] ?? '')
    const sess  = Number(r[1] ?? 0)
    const internal = isInternalUser(email)
    perClientUsers.push({ email, sessions: sess, internal })
    if (internal) perClientInt += sess
    else perClientExt += sess
  }

  // List all distinct org values found in the trends-style query (to spot case differences etc)
  const distinctOrgs = new Set<string>()
  for (const r of trendsStyleAll.rows) distinctOrgs.add(String(r[0] ?? ''))

  return NextResponse.json({
    client,
    days,
    trends_api_view: {
      rowCount: trendsStyleAll.rowCount,
      hasMore: (trendsStyleAll.raw as { hasMore?: boolean }).hasMore,
      limit:   (trendsStyleAll.raw as { limit?: number }).limit,
      ext_sessions_for_client: trendsExtForClient,
      int_sessions_for_client: trendsIntForClient,
      rows_matching_client: trendsClientRows,
      sample_distinct_orgs_first_30: [...distinctOrgs].slice(0, 30),
    },
    trends_style_filtered_to_client: {
      rowCount: trendsStyleFiltered.rowCount,
      rows: trendsStyleFiltered.rows,
    },
    per_client_view: {
      rowCount: perClientStyle.rowCount,
      ext_sessions: perClientExt,
      int_sessions: perClientInt,
      users: perClientUsers,
    },
  }, { status: 200 })
}
