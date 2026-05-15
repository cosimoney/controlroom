import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getModuleSignal, MODULE_CROSS_MAP, hasProductTag } from '@/lib/modules'
import { isInternalUser, isPostHogConfigured } from '@/lib/posthog'

const POSTHOG_HOST       = process.env.POSTHOG_HOST ?? 'https://eu.posthog.com'
const POSTHOG_API_KEY    = process.env.POSTHOG_API_KEY
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID

// Maps raw `properties.module` event values to internal module labels.
// Mirror of MODULE_PROP_MAP in lib/posthog.ts. Kept inline to keep this
// route self-contained.
const POSTHOG_MODULE_TO_LABEL: Record<string, string> = {
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const daysParam = parseInt(searchParams.get('days') ?? '30')
  const days = [30, 60, 90].includes(daysParam) ? daysParam : 30

  const sql = await db()

  // Load all active clients with products column
  const clients = await sql<{ id: number; name: string; client_code: string; tier: number | null; arr: number | null; products: string | null }[]>`
    SELECT id, name, client_code, tier, arr, products
    FROM clients
    WHERE status = 'active' AND client_code IS NOT NULL
  `

  // Load Clerk org modules (keyed by lowercase slug)
  const clerkOrgs = await sql<{ slug: string; modules_enabled: string }[]>`
    SELECT slug, modules_enabled FROM clerk_organizations
  `
  const clerkMap = new Map(clerkOrgs.map((o) => [o.slug.toLowerCase(), JSON.parse(o.modules_enabled || '[]') as string[]]))

  // Live PostHog: pageviews + sessions per (org, module, email) over the
  // requested window. Aggregating per-email lets us exclude internal users
  // before summing. Switched from cache to live to support 60/90d and sessions.
  const phMap = new Map<string, Record<string, { pv: number; sessions: number }>>()
  if (isPostHogConfigured()) {
    const rows = await hogql(`
      SELECT
        properties.organization AS org,
        properties.module       AS module,
        properties.user_email   AS email,
        count() AS pv,
        count(distinct properties.$session_id) AS sessions
      FROM events
      WHERE event = '$pageview'
        AND timestamp >= now() - interval ${days} day
        AND properties.user_email IS NOT NULL AND properties.user_email != ''
        AND properties.organization IS NOT NULL AND properties.organization != ''
        AND properties.organization NOT IN ('empty', 'sign-in')
        AND properties.module IS NOT NULL AND properties.module != ''
      GROUP BY org, module, email
      LIMIT 100000
    `)

    for (const r of rows) {
      const org       = String(r[0] ?? '').toLowerCase()
      const moduleRaw = String(r[1] ?? '')
      const email     = String(r[2] ?? '')
      const pv        = Number(r[3] ?? 0)
      const sess      = Number(r[4] ?? 0)

      if (isInternalUser(email)) continue

      const label = POSTHOG_MODULE_TO_LABEL[moduleRaw]
      if (!label) continue

      if (!phMap.has(org)) phMap.set(org, {})
      const orgModules = phMap.get(org)!
      if (!orgModules[label]) orgModules[label] = { pv: 0, sessions: 0 }
      orgModules[label].pv       += pv
      orgModules[label].sessions += sess
    }
  }

  const alerts = []

  for (const client of clients) {
    const code         = client.client_code.toLowerCase()
    let clerkModules   = clerkMap.get(code) ?? null
    // Fallback: find slug that is a prefix of client_code (e.g. disn → disna)
    if (clerkModules === null) {
      for (const [slug, mods] of clerkMap) {
        if (code.startsWith(slug)) { clerkModules = mods; break }
      }
    }
    const phModules = phMap.get(code) ?? {}

    for (const [key, entry] of Object.entries(MODULE_CROSS_MAP)) {
      // 'home' is implicit on every plan and rarely tracked in PostHog → skip
      // to avoid noisy "paid but not used" alerts on this view. Other sections
      // (e.g. client detail's Moduli comparison) still include it.
      if (key === 'home') continue
      const subscribed     = hasProductTag(client.products, entry.products_tags)
      const monday_value   = subscribed ? 1 : 0
      const clerk_enabled  = entry.clerk_key === '__ALWAYS__'
        ? true
        : clerkModules === null
          ? null
          : entry.clerk_key !== null ? clerkModules.includes(entry.clerk_key) : null

      const phModule        = entry.posthog_path ? phModules[entry.posthog_path] : null
      const posthog_views   = phModule?.pv ?? 0
      const posthog_sessions = phModule?.sessions ?? 0
      const signal          = getModuleSignal(subscribed, clerk_enabled, posthog_views)

      if (signal !== 'grey') {
        alerts.push({
          client_id:        client.id,
          client_name:      client.name,
          client_code:      client.client_code,
          tier:             client.tier,
          arr:              client.arr,
          module_key:       key,
          module_label:     entry.label,
          monday_value,
          clerk_enabled,
          posthog_views,
          posthog_sessions,
          signal,
        })
      }
    }
  }

  // Sort: red first, then yellow, then upsell; within same signal: by tier asc, arr desc
  const signalOrder: Record<string, number> = { red: 0, yellow: 1, upsell: 2, green: 3, grey: 4 }
  alerts.sort((a, b) => {
    const so = (signalOrder[a.signal] ?? 5) - (signalOrder[b.signal] ?? 5)
    if (so !== 0) return so
    const to = (a.tier ?? 9) - (b.tier ?? 9)
    if (to !== 0) return to
    return (b.arr ?? 0) - (a.arr ?? 0)
  })

  return NextResponse.json({ alerts, total: alerts.length, days })
}
