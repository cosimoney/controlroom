/**
 * lib/modules.ts — Module cross-system mapping and signal logic
 *
 * Links Monday subscription data (s_* fields), Clerk enabled modules,
 * and PostHog usage (classifyModule() output) into a unified comparison.
 *
 * TODO: verify posthog_path values against real Studio URL structure after
 *       first Clerk sync. Current values are based on classifyModule() in posthog.ts.
 */

import type { ModuleComparisonEntry, ModuleSignalType } from './types'
import type { ClientWithStats } from './types'

export interface ModuleMapEntry {
  label: string
  monday_field: keyof ClientWithStats | null
  clerk_key: string | null    // key in parseClerkModules() output
  posthog_path: string | null // module name returned by classifyModule()
}

// TODO: verify posthog_path values against real Studio URL structure
export const MODULE_CROSS_MAP: Record<string, ModuleMapEntry> = {
  home:     { label: 'Home',       monday_field: 's_home',     clerk_key: null,       posthog_path: 'Other' },
  quickwins:{ label: 'Quick Wins', monday_field: 's_quickwins',clerk_key: null,       posthog_path: 'QuickWins' },
  sales:    { label: 'Sales',      monday_field: 's_sales',    clerk_key: 'sales',    posthog_path: 'Sales' },
  media:    { label: 'Media',      monday_field: 's_media',    clerk_key: 'media',    posthog_path: 'Media' },
  dsp:      { label: 'DSP',        monday_field: null,         clerk_key: 'dsp',      posthog_path: 'DSP' },
  amc:      { label: 'AMC',        monday_field: 's_amc',      clerk_key: 'amc',      posthog_path: 'AMC' },
  category: { label: 'Category',   monday_field: 's_category', clerk_key: 'category', posthog_path: 'Category Explorer' },
  seller:   { label: 'Seller',     monday_field: 's_seller',   clerk_key: 'seller',   posthog_path: 'Seller' },
  sell_in:  { label: 'Sell-In',    monday_field: 's_sell_in',  clerk_key: null,       posthog_path: 'Other' },
  products: { label: 'Products',   monday_field: 's_products', clerk_key: null,       posthog_path: 'Other' },
}

export function getModuleSignal(
  monday_value: number | null,
  clerk_enabled: boolean | null,
  posthog_views: number,
): ModuleSignalType {
  const subscribed = monday_value === 1
  const used       = posthog_views > 0

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
  client: ClientWithStats,
  clerkModules: string[] | null,  // null = no Clerk data
  posthogModules: Record<string, number>,  // from UsageSummary.modules
): ModuleComparisonEntry[] {
  return Object.entries(MODULE_CROSS_MAP).map(([key, entry]) => {
    const monday_value = entry.monday_field
      ? (client[entry.monday_field] as number | null) ?? null
      : null

    const clerk_enabled = clerkModules === null
      ? null
      : entry.clerk_key !== null
        ? clerkModules.includes(entry.clerk_key)
        : null

    const posthog_views = entry.posthog_path && posthogModules[entry.posthog_path]
      ? posthogModules[entry.posthog_path]
      : 0

    const signal = getModuleSignal(monday_value, clerk_enabled, posthog_views)

    return { key, label: entry.label, monday_value, clerk_enabled, posthog_views, signal }
  }).filter((e) => e.signal !== 'grey' || e.monday_value === 1)
  // Only show modules that are subscribed OR have some activity
}
