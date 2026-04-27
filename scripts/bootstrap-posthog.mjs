/**
 * One-shot PostHog bootstrap from local machine to Supabase.
 * Bypasses Vercel's 60s function timeout for the initial heavy sync (~50 clients × ~10s each).
 *
 * Run: node scripts/bootstrap-posthog.mjs
 */

import postgres from 'postgres'
import fs from 'node:fs'

const env = fs.readFileSync('.env.local', 'utf8')
const url = env.match(/DATABASE_URL=(.+)/)[1].trim()
const POSTHOG_HOST       = env.match(/POSTHOG_HOST=(.+)/)?.[1]?.trim() ?? 'https://eu.posthog.com'
const POSTHOG_API_KEY    = env.match(/POSTHOG_API_KEY=(.+)/)[1].trim()
const POSTHOG_PROJECT_ID = env.match(/POSTHOG_PROJECT_ID=(.+)/)[1].trim()

if (!POSTHOG_API_KEY) { console.error('✗ POSTHOG_API_KEY missing'); process.exit(1) }

const sql = postgres(url, { prepare: false, ssl: 'require', max: 2, connect_timeout: 15 })

// ─── HogQL ───────────────────────────────────────────────────────────

async function hogql(query) {
  const res = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${POSTHOG_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
  })
  if (!res.ok) throw new Error(`HogQL ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.results ?? []
}

function isInternal(email) {
  if (!email) return false
  const domain = email.toLowerCase().split('@')[1] || ''
  return domain.includes('witailer') || domain.includes('retex') || domain.includes('alkemy')
}

// ─── Adoption level + usage score (mirrors lib/health.ts) ────────────

function daysSince(iso) {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

function computeAdoptionLevel(externalUsers, lastSeenExternal) {
  const ext = externalUsers.length
  const days = daysSince(lastSeenExternal)
  if (ext === 0) return days === null ? 'New' : 'PM-driven'
  if (days !== null && days > 30) return 'Dormant'
  if (ext >= 5) return 'Self-serve'
  if (ext >= 2) return 'Supported'
  return 'PM-driven'
}

// ─── Sync one client ─────────────────────────────────────────────────

async function syncClient(clientCode) {
  const code = clientCode.toUpperCase()
  const safeCode = code.replace(/'/g, "\\'")

  // Users from events (person profiles disabled)
  const userRows = await hogql(`
    SELECT
      properties.user_email AS email,
      max(timestamp) AS last_seen,
      count() AS events
    FROM events
    WHERE event = '$pageview'
      AND properties.organization = '${safeCode}'
      AND properties.user_email IS NOT NULL
      AND properties.user_email != ''
      AND timestamp >= now() - interval 30 day
    GROUP BY email
    ORDER BY last_seen DESC
  `)

  const users = userRows
    .map((r) => ({ email: String(r[0] ?? ''), last_seen_at: String(r[1] ?? ''), events: Number(r[2] ?? 0) }))
    .filter((u) => u.email && u.email !== 'null')

  const usersExt = users.filter((u) => !isInternal(u.email))
  const usersInt = users.filter((u) => isInternal(u.email))

  // Events per URL
  const eventRows = await hogql(`
    SELECT
      properties.user_email AS email,
      properties.$current_url AS url,
      properties.module AS module,
      count() AS cnt
    FROM events
    WHERE event = '$pageview'
      AND properties.organization = '${safeCode}'
      AND timestamp >= now() - interval 30 day
    GROUP BY email, url, module
  `)
  const prevEventRows = await hogql(`
    SELECT
      properties.user_email AS email,
      count() AS cnt
    FROM events
    WHERE event = '$pageview'
      AND properties.organization = '${safeCode}'
      AND timestamp >= now() - interval 60 day
      AND timestamp < now() - interval 30 day
    GROUP BY email
  `)

  // Sessions (via distinct session_id)
  const sessionRows = await hogql(`
    SELECT
      properties.user_email AS email,
      count(distinct properties.$session_id) AS sessions
    FROM events
    WHERE event = '$pageview'
      AND properties.organization = '${safeCode}'
      AND timestamp >= now() - interval 30 day
      AND properties.user_email IS NOT NULL
      AND properties.user_email != ''
    GROUP BY email
  `)
  const prevSessionRows = await hogql(`
    SELECT
      properties.user_email AS email,
      count(distinct properties.$session_id) AS sessions
    FROM events
    WHERE event = '$pageview'
      AND properties.organization = '${safeCode}'
      AND timestamp >= now() - interval 60 day
      AND timestamp < now() - interval 30 day
      AND properties.user_email IS NOT NULL
      AND properties.user_email != ''
    GROUP BY email
  `)

  let eventsExt = 0, eventsInt = 0, eventsExtPrev = 0, eventsIntPrev = 0
  let sessionsExt = 0, sessionsInt = 0, sessionsExtPrev = 0, sessionsIntPrev = 0
  const modulesMap = {}

  for (const r of eventRows) {
    const email = String(r[0] ?? '')
    const module = r[2] ? String(r[2]) : null
    const cnt = Number(r[3] ?? 0)
    const internal = isInternal(email)
    if (internal) { eventsInt += cnt } else {
      eventsExt += cnt
      if (module && module !== 'null') {
        modulesMap[module] = (modulesMap[module] ?? 0) + cnt
      }
    }
  }
  for (const r of prevEventRows) {
    const email = String(r[0] ?? '')
    const cnt = Number(r[1] ?? 0)
    if (isInternal(email)) eventsIntPrev += cnt; else eventsExtPrev += cnt
  }
  for (const r of sessionRows) {
    const email = String(r[0] ?? '')
    const s = Number(r[1] ?? 0)
    if (isInternal(email)) sessionsInt += s; else sessionsExt += s
  }
  for (const r of prevSessionRows) {
    const email = String(r[0] ?? '')
    const s = Number(r[1] ?? 0)
    if (isInternal(email)) sessionsIntPrev += s; else sessionsExtPrev += s
  }

  const lastExt = usersExt[0] ?? null
  const lastInt = usersInt[0] ?? null

  const adoption_level = computeAdoptionLevel(usersExt, lastExt?.last_seen_at ?? null)

  const summary = {
    client_code: code,
    period_days: 30,
    active_external: usersExt.length,
    active_internal: usersInt.length,
    events_external: eventsExt,
    events_internal: eventsInt,
    events_external_prev: eventsExtPrev,
    events_internal_prev: eventsIntPrev,
    sessions_external: sessionsExt,
    sessions_internal: sessionsInt,
    sessions_external_prev: sessionsExtPrev,
    sessions_internal_prev: sessionsIntPrev,
    users_external: usersExt,
    users_internal: usersInt,
    last_seen_external: lastExt,
    last_seen_internal: lastInt,
    modules: modulesMap,
    adoption_level,
    synced_at: new Date().toISOString(),
  }

  await sql`
    INSERT INTO posthog_usage_cache (client_code, metric_type, user_type, value, period_days, last_synced_at)
    VALUES (${code}, 'summary', 'all', ${JSON.stringify(summary)}, 30, NOW())
    ON CONFLICT (client_code, metric_type, user_type, period_days) DO UPDATE SET
      value = EXCLUDED.value, last_synced_at = EXCLUDED.last_synced_at
  `

  return { users: users.length, ext: usersExt.length, int: usersInt.length }
}

// ─── Main ────────────────────────────────────────────────────────────

console.log('Step 1/2 — Loading clients from Supabase...')
const clients = await sql`
  SELECT client_code FROM clients WHERE client_code IS NOT NULL AND status = 'active'
  ORDER BY client_code
`
console.log(`  → Found ${clients.length} active clients with client_code`)

console.log('\nStep 2/2 — Syncing PostHog for each client (serialized to avoid rate limits)...')
let ok = 0
const errors = []
for (let i = 0; i < clients.length; i++) {
  const { client_code } = clients[i]
  try {
    const stats = await syncClient(client_code)
    ok++
    console.log(`  [${i + 1}/${clients.length}] ${client_code}: ${stats.ext} ext + ${stats.int} int users`)
  } catch (e) {
    errors.push(`${client_code}: ${e.message}`)
    console.log(`  [${i + 1}/${clients.length}] ${client_code}: ✗ ${e.message}`)
  }
}

await sql`
  INSERT INTO sync_metadata (source, sync_type, last_sync_at, records, notes)
  VALUES ('posthog', 'api', NOW(), ${ok}, ${`bootstrap from local`})
  ON CONFLICT (source) DO UPDATE SET
    sync_type    = EXCLUDED.sync_type,
    last_sync_at = EXCLUDED.last_sync_at,
    records      = EXCLUDED.records,
    notes        = EXCLUDED.notes
`

console.log(`\n✓ Bootstrap complete`)
console.log(`  Synced: ${ok}/${clients.length}`)
if (errors.length > 0) {
  console.log(`  Errors (${errors.length}):`)
  for (const e of errors) console.log('  -', e)
}

await sql.end()
