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
  if (!res.ok) return []
  const data = await res.json() as { results?: unknown[][] }
  return (data.results ?? []) as unknown[][]
}

interface CachedSummary {
  sessions_external?: number
  sessions_internal?: number
  events_external?: number
  modules?: Record<string, number>
}

export async function GET(request: Request) {
  if (!isPostHogConfigured()) {
    return NextResponse.json({ error: 'PostHog not configured' }, { status: 400 })
  }

  const { searchParams } = new URL(request.url)
  const days        = parseInt(searchParams.get('days') ?? '30')
  const onlyIssues  = searchParams.get('only_issues') === 'true'

  const sql = await db()

  // 1. Active clients
  const clients = await sql<{ id: number; name: string; client_code: string; tier: number | null; arr: number | null }[]>`
    SELECT id, name, client_code, tier, arr FROM clients
    WHERE status = 'active' AND client_code IS NOT NULL
    ORDER BY name
  `

  // 2. All cache entries for the requested period
  const cacheRows = await sql<{ client_code: string; value: string; last_synced_at: string }[]>`
    SELECT client_code, value, last_synced_at::text FROM posthog_usage_cache
    WHERE metric_type = 'summary' AND user_type = 'all' AND period_days = ${days}
  `
  const cacheMap = new Map<string, { summary: CachedSummary; last_synced_at: string }>()
  for (const r of cacheRows) {
    try {
      cacheMap.set(r.client_code.toUpperCase(), {
        summary: JSON.parse(r.value) as CachedSummary,
        last_synced_at: r.last_synced_at,
      })
    } catch { /* skip malformed JSON */ }
  }

  // 3. Live PostHog: one query for all orgs (with LIMIT to avoid silent truncation)
  const liveRows = await hogql(`
    SELECT
      properties.organization AS org,
      properties.user_email   AS email,
      count(distinct properties.$session_id) AS sessions
    FROM events
    WHERE event = '$pageview'
      AND timestamp >= now() - interval ${days} day
      AND properties.user_email IS NOT NULL AND properties.user_email != ''
      AND properties.organization IS NOT NULL AND properties.organization != ''
      AND properties.organization NOT IN ('empty', 'sign-in')
    GROUP BY org, email
    LIMIT 10000
  `)
  const liveByOrg = new Map<string, { ext: number; int: number; users: number }>()
  for (const r of liveRows) {
    const org   = String(r[0] ?? '').toUpperCase()
    const email = String(r[1] ?? '')
    const sess  = Number(r[2] ?? 0)
    if (!liveByOrg.has(org)) liveByOrg.set(org, { ext: 0, int: 0, users: 0 })
    const e = liveByOrg.get(org)!
    e.users += 1
    if (isInternalUser(email)) e.int += sess
    else e.ext += sess
  }

  // 4. Per-client audit
  const now = Date.now()
  const audit = clients.map((c) => {
    const code   = c.client_code.toUpperCase()
    const cache  = cacheMap.get(code)
    const live   = liveByOrg.get(code) ?? { ext: 0, int: 0, users: 0 }

    const cacheAgeMin = cache
      ? Math.round((now - new Date(cache.last_synced_at).getTime()) / 60000)
      : null
    const cacheExt = cache?.summary?.sessions_external ?? null
    const cacheInt = cache?.summary?.sessions_internal ?? null
    const modules  = cache?.summary?.modules ?? null
    const modulesCount = modules ? Object.keys(modules).length : 0

    const flags: string[] = []
    if (!cache)                                                                              flags.push('cache_missing')
    else if (cacheAgeMin !== null && cacheAgeMin > 30)                                       flags.push('cache_stale')
    if (live.ext === 0 && live.int === 0)                                                    flags.push('no_posthog_activity')
    if (live.ext > 0 && cacheExt !== null && Math.abs(live.ext - cacheExt) > 2)              flags.push('ext_sessions_mismatch')
    if ((live.ext > 0 || live.int > 0) && cache && modulesCount === 0)                       flags.push('modules_untracked')
    if (live.ext === 0 && live.int > 0)                                                      flags.push('internal_only')

    return {
      client_code: c.client_code,
      client_name: c.name,
      tier:        c.tier,
      arr:         c.arr,
      cache: cache ? {
        age_min:          cacheAgeMin,
        last_synced_at:   cache.last_synced_at,
        sessions_ext:     cacheExt,
        sessions_int:     cacheInt,
        modules_count:    modulesCount,
        modules,
      } : null,
      live: { sessions_ext: live.ext, sessions_int: live.int, distinct_users: live.users },
      flags,
    }
  })

  // 5. Summary counts
  const totals = {
    active_clients:        clients.length,
    in_cache:              audit.filter((a) => a.cache !== null).length,
    cache_fresh:           audit.filter((a) => a.cache && (a.cache.age_min ?? 99999) <= 30).length,
    cache_stale:           audit.filter((a) => a.flags.includes('cache_stale')).length,
    cache_missing:         audit.filter((a) => a.flags.includes('cache_missing')).length,
    no_posthog_activity:   audit.filter((a) => a.flags.includes('no_posthog_activity')).length,
    modules_untracked:     audit.filter((a) => a.flags.includes('modules_untracked')).length,
    ext_sessions_mismatch: audit.filter((a) => a.flags.includes('ext_sessions_mismatch')).length,
    internal_only:         audit.filter((a) => a.flags.includes('internal_only')).length,
    all_ok:                audit.filter((a) => a.flags.length === 0).length,
  }

  // 6. Optionally filter to only clients with at least one flag
  const clientsOut = onlyIssues ? audit.filter((a) => a.flags.length > 0) : audit

  return NextResponse.json({
    audited_at: new Date().toISOString(),
    days,
    totals,
    flag_legend: {
      cache_missing:         'Nessuna cache PostHog per questo cliente (mai sincronizzato)',
      cache_stale:           'Cache > 30 min — la pagina mostra dati vecchi finché non si rifa il sync',
      no_posthog_activity:   '0 sessioni ext + int negli ultimi N giorni (cliente inattivo o tracking mancante)',
      ext_sessions_mismatch: 'Cache e PostHog live divergono di >2 sessioni — sync probabilmente da rieseguire',
      modules_untracked:     'Sessioni presenti ma `properties.module` mancante negli eventi (script tracking incompleto)',
      internal_only:         'Solo utenti interni Witailer/Retex/Alkemy — il cliente vero non ha mai usato il prodotto',
    },
    clients: clientsOut,
  })
}
