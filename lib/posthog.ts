/**
 * lib/posthog.ts — PostHog EU Cloud API client
 *
 * Uses the PostHog REST API (EU region: https://eu.posthog.com).
 * All data is cached in the Postgres posthog_usage_cache table (TTL 30 min).
 * This file is SERVER-ONLY (uses postgres.js via db()).
 */

import { db } from './db'
import { computeAdoptionLevel, computeUsageScore } from './health'
import type { AdoptionLevel, UsageSummary, UserActivity } from './types'

// ─── Config ──────────────────────────────────────────────────────────

const POSTHOG_API_KEY    = process.env.POSTHOG_API_KEY
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID
const POSTHOG_HOST       = process.env.POSTHOG_HOST ?? 'https://eu.posthog.com'
const CACHE_TTL_MS       = 30 * 60 * 1000 // 30 minutes

export function isPostHogConfigured(): boolean {
  return !!(POSTHOG_API_KEY && POSTHOG_PROJECT_ID)
}

// ─── Internal user classification ────────────────────────────────────

/**
 * Returns true if the email belongs to a Witailer/Retex/Alkemy employee.
 * These are "internal" users — their activity does not count as client adoption.
 */
export function isInternalUser(email: string | null | undefined): boolean {
  if (!email) return false
  const domain = email.toLowerCase().split('@')[1] || ''
  return (
    domain.includes('witailer') ||
    domain.includes('retex') ||
    domain.includes('alkemy')
  )
}

// ─── Module classification ────────────────────────────────────────────

// TODO: verify the real Studio URL path structure and update this classification.
//       Current paths are hypothesis-based — the CSM should adjust after first sync.
export function classifyModule(url: string): string {
  try {
    const path = new URL(url).pathname.toLowerCase()
    if (path.includes('/sales'))                                          return 'Sales'
    if (path.includes('/media'))                                          return 'Media'
    if (path.includes('/dsp'))                                            return 'DSP'
    if (path.includes('/amc'))                                            return 'AMC'
    if (path.includes('/content'))                                        return 'Content & SEO'
    if (path.includes('/quick-wins') || path.includes('/quickwins'))      return 'Quick Wins'
    if (path.includes('/review') || path.includes('/voice'))              return 'Customer Voice'
    if (path.includes('/competitor') || path.includes('/category'))       return 'Category Explorer'
    if (path.includes('/seller'))                                         return 'Seller'
    if (path.includes('/buybox') || path.includes('/buy-box'))            return 'BuyBox'
    if (path.includes('/price') || path.includes('/deals'))               return 'Price & Deals'
    if (path.includes('/inventory'))                                      return 'Inventory'
    if (path.includes('/margin'))                                         return 'Margin'
    if (path.includes('/product'))                                        return 'Products'
    if (path.includes('/sell-in') || path.includes('/sellin'))            return 'Sell-In'
    if (path.includes('/dashboard'))                                      return 'Custom Dashboards'
    if (path.includes('/home') || path === '/' || path === '')            return 'Home'
    return 'Home'
  } catch {
    return 'Unknown'
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────

function phHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${POSTHOG_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

function baseUrl(): string {
  return `${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}`
}

/** Fetch with exponential backoff on 429 / 5xx (max 3 attempts: 1s → 2s → 4s) */
async function fetchWithRetry(url: string, options: RequestInit, attempt = 0): Promise<Response> {
  const res = await fetch(url, options)
  if ((res.status === 429 || res.status >= 500) && attempt < 3) {
    await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000))
    return fetchWithRetry(url, options, attempt + 1)
  }
  return res
}

// ─── HogQL helpers ───────────────────────────────────────────────────

async function hogqlQuery(query: string): Promise<unknown[][]> {
  const res = await fetchWithRetry(`${baseUrl()}/query/`, {
    method: 'POST',
    headers: phHeaders(),
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  })
  if (!res.ok) return []
  const data = await res.json()
  return (data.results as unknown[][] ?? [])
}

// ─── User activity from events ────────────────────────────────────────

/**
 * NOTE: Person profiles are disabled on this PostHog project ($process_person_profile=false).
 * All user data is derived from event properties: `properties.organization` (client code)
 * and `properties.user_email` (user email). The /persons/ API returns 0 results.
 */

interface UserRow {
  email: string
  last_seen_at: string
  events: number
}

/**
 * Fetch unique users active in the last `days` days for a given client code.
 * Returns one row per unique email with last_seen and event count.
 */
async function fetchUsersFromEvents(clientCode: string, days: number): Promise<UserRow[]> {
  const safeCode = clientCode.replace(/'/g, "\\'")
  const rows = await hogqlQuery(`
    SELECT
      properties.user_email AS email,
      max(timestamp)         AS last_seen_at,
      count()                AS events
    FROM events
    WHERE event = '$pageview'
      AND properties.organization = '${safeCode}'
      AND timestamp >= now() - interval ${days} day
      AND properties.user_email IS NOT NULL
      AND properties.user_email != ''
      AND properties.user_email != 'null'
    GROUP BY email
    ORDER BY last_seen_at DESC
  `)
  return rows
    .map((r) => ({ email: String(r[0] ?? ''), last_seen_at: String(r[1] ?? ''), events: Number(r[2] ?? 0) }))
    .filter((u) => u.email && u.email !== 'null')
}

// ─── HogQL query for events + modules ────────────────────────────────

interface EventRow {
  email: string
  module: string | null
  cnt: number
}

/**
 * Fetch pageview events grouped by (email, module) for a given period window.
 * Uses the custom event property `module` set by the app.
 * `sinceOffset` = 0 → last `days` days; `sinceOffset` = `days` → previous period.
 */
async function fetchEventRows(clientCode: string, days: number, sinceOffset = 0): Promise<EventRow[]> {
  const safeCode = clientCode.replace(/'/g, "\\'")
  const rows = await hogqlQuery(`
    SELECT
      properties.user_email    AS email,
      properties.module        AS module,
      count()                  AS cnt
    FROM events
    WHERE event = '$pageview'
      AND properties.organization = '${safeCode}'
      AND timestamp >= now() - interval ${days + sinceOffset} day
      AND timestamp < now() - interval ${sinceOffset} day
    GROUP BY email, module
  `)
  return rows.map((r) => ({
    email:  String(r[0] ?? ''),
    module: r[1] ? String(r[1]) : null,
    cnt:    Number(r[2] ?? 0),
  }))
}

// ─── HogQL query for unique sessions ─────────────────────────────────

async function fetchSessionCounts(clientCode: string, days: number, sinceOffset = 0): Promise<{ ext: number; int: number }> {
  const safeCode = clientCode.replace(/'/g, "\\'")
  const rows = await hogqlQuery(`
    SELECT
      properties.user_email AS email,
      count(distinct properties.$session_id) AS sessions
    FROM events
    WHERE event = '$pageview'
      AND properties.organization = '${safeCode}'
      AND timestamp >= now() - interval ${days + sinceOffset} day
      AND timestamp < now() - interval ${sinceOffset} day
      AND properties.user_email IS NOT NULL
      AND properties.user_email != ''
    GROUP BY email
  `)
  let ext = 0, int = 0
  for (const r of rows) {
    const email = String(r[0] ?? '')
    const s = Number(r[1] ?? 0)
    if (isInternalUser(email)) int += s
    else ext += s
  }
  return { ext, int }
}

// ─── Full sync for one client ─────────────────────────────────────────

export async function syncClientUsage(clientCode: string, days = 30): Promise<UsageSummary> {
  const code = clientCode.toUpperCase()

  // 1. Users active in period (derived from events — person profiles are disabled)
  const users = await fetchUsersFromEvents(code, days)
  const externalUsers = users.filter((u) => !isInternalUser(u.email))
  const internalUsers = users.filter((u) => isInternalUser(u.email))

  const lastExt = externalUsers[0] ?? null  // already sorted by last_seen_at DESC
  const lastInt = internalUsers[0] ?? null

  // 2. Event rows — current period (for module breakdown + totals)
  // 3. Previous period for trend
  // 4. Sessions — all in parallel
  const [rows, prevRows, sessions, sessionsPrev] = await Promise.all([
    fetchEventRows(code, days, 0),
    fetchEventRows(code, days, days),
    fetchSessionCounts(code, days, 0),
    fetchSessionCounts(code, days, days),
  ])

  // 5. Classify events using the `module` property from PostHog
  let eventsExt = 0, eventsInt = 0
  let eventsExtPrev = 0, eventsIntPrev = 0
  const modulesMap: Record<string, number> = {}

  // Map PostHog module property values to our display labels
  const MODULE_PROP_MAP: Record<string, string> = {
    sales:         'Sales',
    buybox:        'BuyBox',
    media:         'Media',
    category:      'Category Explorer',
    content:       'Content & SEO',
    priceAndDeals: 'Price & Deals',
    sellIn:        'Sell-In',
    reports:       'Quick Wins',
    voice:         'Customer Voice',
  }

  for (const r of rows) {
    const internal = isInternalUser(r.email)
    if (internal) {
      eventsInt += r.cnt
    } else {
      eventsExt += r.cnt
      if (r.module) {
        const label = MODULE_PROP_MAP[r.module]
        if (label) {
          modulesMap[label] = (modulesMap[label] ?? 0) + r.cnt
        }
      }
    }
  }
  for (const r of prevRows) {
    if (isInternalUser(r.email)) eventsIntPrev += r.cnt
    else eventsExtPrev += r.cnt
  }

  // 5. Build user lists (already have events per user from fetchUsersFromEvents)
  const usersExt: UserActivity[] = externalUsers
    .map((u) => ({ email: u.email, last_seen_at: u.last_seen_at, events: u.events }))
    .sort((a, b) => b.events - a.events)

  const usersInt: UserActivity[] = internalUsers
    .map((u) => ({ email: u.email, last_seen_at: u.last_seen_at, events: u.events }))
    .sort((a, b) => b.events - a.events)

  // 6. Adoption level
  const adoptionLevel: AdoptionLevel = computeAdoptionLevel(externalUsers.length, internalUsers.length)

  const summary: UsageSummary = {
    client_code: code,
    last_seen_external: lastExt ? { last_seen_at: lastExt.last_seen_at, email: lastExt.email } : null,
    last_seen_internal: lastInt ? { last_seen_at: lastInt.last_seen_at, email: lastInt.email } : null,
    active_external: externalUsers.length,
    active_internal: internalUsers.length,
    events_external: eventsExt,
    events_internal: eventsInt,
    events_external_prev: eventsExtPrev,
    events_internal_prev: eventsIntPrev,
    sessions_external: sessions.ext,
    sessions_internal: sessions.int,
    sessions_external_prev: sessionsPrev.ext,
    sessions_internal_prev: sessionsPrev.int,
    modules: modulesMap,
    adoption_level: adoptionLevel,
    users_external: usersExt,
    users_internal: usersInt,
    last_synced_at: new Date().toISOString(),
    period_days: days,
  }

  // 7. Persist to cache (upsert)
  await storeSummaryInCache(code, summary, days)

  return summary
}

// ─── Cache helpers ────────────────────────────────────────────────────

async function storeSummaryInCache(clientCode: string, summary: UsageSummary, days: number): Promise<void> {
  const sql = await db()
  await sql`
    INSERT INTO posthog_usage_cache (client_code, metric_type, user_type, value, period_days, last_synced_at)
    VALUES (${clientCode}, 'summary', 'all', ${JSON.stringify(summary)}, ${days}, NOW())
    ON CONFLICT (client_code, metric_type, user_type, period_days) DO UPDATE SET
      value = EXCLUDED.value, last_synced_at = EXCLUDED.last_synced_at
  `
}

/** Read the cached summary row; returns null if missing or expired (TTL 30 min). */
export async function getUsageFromCache(clientCode: string, days = 30): Promise<UsageSummary | null> {
  const sql = await db()
  const rows = await sql<{ value: string; last_synced_at: string }[]>`
    SELECT value, last_synced_at::text FROM posthog_usage_cache
    WHERE client_code = ${clientCode.toUpperCase()} AND metric_type = 'summary' AND user_type = 'all' AND period_days = ${days}
  `
  const row = rows[0]
  if (!row) return null

  const age = Date.now() - new Date(row.last_synced_at).getTime()
  if (age > CACHE_TTL_MS) return null

  try { return JSON.parse(row.value) as UsageSummary } catch { return null }
}

/** Read cache even if stale (for fallback). */
async function getStaleCacheValue(clientCode: string, days = 30): Promise<UsageSummary | null> {
  const sql = await db()
  const rows = await sql<{ value: string }[]>`
    SELECT value FROM posthog_usage_cache
    WHERE client_code = ${clientCode.toUpperCase()} AND metric_type = 'summary' AND user_type = 'all' AND period_days = ${days}
  `
  const row = rows[0]
  if (!row) return null
  try { return JSON.parse(row.value) as UsageSummary } catch { return null }
}

/**
 * Returns fresh cache if available; otherwise triggers a sync.
 * Falls back to stale cache if sync fails (network error, rate limit, etc.).
 */
export async function getOrSyncUsage(clientCode: string, days = 30): Promise<UsageSummary | null> {
  if (!isPostHogConfigured()) return null

  const cached = await getUsageFromCache(clientCode, days)
  if (cached) return cached

  try {
    return await syncClientUsage(clientCode, days)
  } catch {
    return await getStaleCacheValue(clientCode, days)
  }
}

// ─── Bulk sync (all clients) ──────────────────────────────────────────

export async function syncAllClients(days = 30): Promise<{ synced: number; errors: string[] }> {
  const sql = await db()
  const clients = await sql<{ client_code: string }[]>`
    SELECT client_code FROM clients WHERE client_code IS NOT NULL
  `

  let synced = 0
  const errors: string[] = []

  for (const { client_code } of clients) {
    try {
      await syncClientUsage(client_code, days)
      synced++
    } catch (e) {
      errors.push(`${client_code}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { synced, errors }
}

// ─── Utility: compute usage score from raw summary ────────────────────

export function usageScoreFromSummary(summary: UsageSummary | null): number | null {
  if (!summary) return null
  return computeUsageScore(summary.adoption_level, summary.last_seen_external?.last_seen_at ?? null)
}

// ─── Utility: days since a date string ───────────────────────────────

export function daysSince(isoString: string | null): number | null {
  if (!isoString) return null
  return Math.floor((Date.now() - new Date(isoString).getTime()) / 86400000)
}
