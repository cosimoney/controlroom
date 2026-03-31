/**
 * lib/modules.ts — Module cross-system mapping and signal logic
 *
 * Links Monday subscription data (products text column tags), Clerk enabled modules,
 * and PostHog usage (classifyModule() output) into a unified comparison.
 */

import type { ModuleComparisonEntry, ModuleSignalType } from './types'

export interface ModuleMapEntry {
  label: string
  products_tags: string[]     // tags to match in Monday `products` column (comma-separated)
  clerk_key: string | null    // key in parseClerkModules() output
  posthog_path: string | null // module name returned by classifyModule()
}

/**
 * Returns true if any of the given tags appear in the comma-separated `products` string.
 * Matching is case-insensitive and trims whitespace.
 */
export function hasProductTag(products: string | null | undefined, tags: string[]): boolean {
  if (tags.includes('__ALWAYS__')) return true
  if (!products || tags.length === 0) return false
  const parts = products.split(',').map((t) => t.trim().toLowerCase())
  return tags.some((tag) => parts.includes(tag.toLowerCase()))
}

export const MODULE_CROSS_MAP: Record<string, ModuleMapEntry> = {
  sales:       { label: 'Sales',              products_tags: ['S-Sales'],                      clerk_key: 'sales',    posthog_path: 'Sales' },
  media:       { label: 'Media',              products_tags: ['S-Media', 'S-AMC'],             clerk_key: 'media',    posthog_path: 'Media' },
  dsp:         { label: 'DSP',                products_tags: [],                               clerk_key: 'dsp',      posthog_path: 'DSP' },
  amc:         { label: 'AMC',                products_tags: ['S-AMC'],                        clerk_key: 'amc',      posthog_path: 'AMC' },
  category:    { label: 'Category',           products_tags: ['S-Category', 'S-Category+MS'],  clerk_key: 'category', posthog_path: 'Category Explorer' },
  seller:      { label: 'Seller',             products_tags: ['S-Seller'],                     clerk_key: 'seller',   posthog_path: 'Seller' },
  buybox:      { label: 'BuyBox',             products_tags: ['S-Product'],                    clerk_key: 'buybox',   posthog_path: 'BuyBox' },
  content:     { label: 'Content & SEO',      products_tags: ['S-Product'],                    clerk_key: 'content',  posthog_path: 'Content & SEO' },
  voice:       { label: 'Customer Voice',     products_tags: ['S-Product'],                    clerk_key: 'voice',    posthog_path: 'Customer Voice' },
  price:       { label: 'Price & Deals',      products_tags: ['S-Product'],                    clerk_key: 'price',    posthog_path: 'Price & Deals' },
  quickwins:   { label: 'Quick Wins',         products_tags: ['S-QuickWins'],                  clerk_key: 'quickwins',posthog_path: 'Quick Wins' },
  sell_in:     { label: 'Sell-In',            products_tags: ['S-Sell-In'],                    clerk_key: 'sellin',   posthog_path: 'Sell-In' },
  multiretail: { label: 'Studio Multiretail', products_tags: ['SMR'],                          clerk_key: null,       posthog_path: null },
  home:        { label: 'Home',               products_tags: ['__ALWAYS__'],                   clerk_key: '__ALWAYS__', posthog_path: 'Home' },
}

export function getModuleSignal(
  subscribed: boolean,
  clerk_enabled: boolean | null,
  posthog_views: number,
): ModuleSignalType {
  const used = posthog_views > 0

  if (!subscribed && !used) return 'grey'
  if (!subscribed && used)  return 'upsell'
  // subscribed === true
  if (clerk_enabled === null) {
    // No Clerk data — 2-level comparison only
    return used ? 'green' : 'yellow'
  }
  if (clerk_enabled && used)    return 'green'
  if (clerk_enabled && !used)   return 'yellow'   // paid + enabled but not used
  if (!clerk_enabled && !used)  return 'red'       // paid but not enabled or used
  return 'yellow' // paid + not enabled + used (anomaly — treat as yellow)
}

export function buildModuleComparison(
  products: string | null,
  clerkModules: string[] | null,  // null = no Clerk data
  posthogModules: Record<string, number>,  // from UsageSummary.modules
): ModuleComparisonEntry[] {
  return Object.entries(MODULE_CROSS_MAP).map(([key, entry]) => {
    const subscribed = hasProductTag(products, entry.products_tags)
    const monday_value = subscribed ? 1 : 0

    const clerk_enabled = clerkModules === null
      ? null
      : entry.clerk_key !== null
        ? clerkModules.includes(entry.clerk_key)
        : null

    const posthog_views = entry.posthog_path && posthogModules[entry.posthog_path]
      ? posthogModules[entry.posthog_path]
      : 0

    const signal = getModuleSignal(subscribed, clerk_enabled, posthog_views)

    return { key, label: entry.label, monday_value, clerk_enabled, posthog_views, signal }
  }).filter((e) => e.signal !== 'grey' || e.monday_value > 0)
  // Only show modules that are subscribed OR have some activity
}
