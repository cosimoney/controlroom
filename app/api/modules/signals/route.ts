import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getModuleSignal, MODULE_CROSS_MAP, hasProductTag } from '@/lib/modules'

export async function GET() {
  const db = getDb()

  // Load all active clients with products column
  const clients = db.prepare(`
    SELECT id, name, client_code, tier, arr, products
    FROM clients
    WHERE status = 'active' AND client_code IS NOT NULL
  `).all() as { id: number; name: string; client_code: string; tier: number | null; arr: number | null; products: string | null }[]

  // Load Clerk org modules (keyed by lowercase slug)
  const clerkOrgs = db.prepare(`
    SELECT slug, modules_enabled FROM clerk_organizations
  `).all() as { slug: string; modules_enabled: string }[]
  const clerkMap = new Map(clerkOrgs.map((o) => [o.slug.toLowerCase(), JSON.parse(o.modules_enabled || '[]') as string[]]))

  // Load PostHog module breakdown (from cache — use modules field in the summary JSON)
  const phRows = db.prepare(`
    SELECT client_code, value FROM posthog_usage_cache
    WHERE metric_type = 'summary' AND user_type = 'all' AND period_days = 30
  `).all() as { client_code: string; value: string }[]
  const phMap = new Map<string, Record<string, number>>()
  for (const row of phRows) {
    try {
      const summary = JSON.parse(row.value)
      phMap.set(row.client_code.toLowerCase(), summary.modules ?? {})
    } catch { /* skip */ }
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
    const phModules    = phMap.get(code) ?? {}

    for (const [key, entry] of Object.entries(MODULE_CROSS_MAP)) {
      const subscribed     = hasProductTag(client.products, entry.products_tags)
      const monday_value   = subscribed ? 1 : 0
      const clerk_enabled  = entry.clerk_key === '__ALWAYS__'
        ? true
        : clerkModules === null
          ? null
          : entry.clerk_key !== null ? clerkModules.includes(entry.clerk_key) : null
      const posthog_views  = entry.posthog_path && phModules[entry.posthog_path]
        ? phModules[entry.posthog_path]
        : 0
      const signal         = getModuleSignal(subscribed, clerk_enabled, posthog_views)

      if (signal !== 'grey') {
        alerts.push({
          client_id:    client.id,
          client_name:  client.name,
          client_code:  client.client_code,
          tier:         client.tier,
          arr:          client.arr,
          module_key:   key,
          module_label: entry.label,
          monday_value,
          clerk_enabled,
          posthog_views,
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

  return NextResponse.json({ alerts, total: alerts.length })
}
