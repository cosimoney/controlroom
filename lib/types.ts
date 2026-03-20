export interface Client {
  id: number
  name: string
  company: string | null
  pm_assigned: string | null
  contract_type: string | null
  modules_active: string[] | null
  market: string | null
  status: 'active' | 'churned' | 'onboarding' | 'paused'
  notes: string | null
  client_code: string | null
  tier: number | null
  // Monday fields
  prio: string | null
  monday_health: string | null
  potential_churn: string | null
  contract_item: string | null
  is_renew: string | null
  is_closed: string | null
  is_churn: string | null
  total_contract_value: number | null
  products: string | null
  upsell: string | null
  opportunity_win_date: string | null
  service_start: string | null
  service_end: string | null
  setup_fee: number | null
  arr: number | null
  client_type: string | null
  country: string | null
  general_tiering: string | null
  adv_tiering: string | null
  client_manager: string | null
  am_owner: string | null
  adv_owner: string | null
  s_home: number | null
  s_quickwins: number | null
  s_sales: number | null
  s_media: number | null
  s_sell_in: number | null
  s_products: number | null
  s_category: number | null
  s_amc: number | null
  s_seller: number | null
  created_at: string
  updated_at: string
}

export interface Touchpoint {
  id: number
  client_id: number
  date: string
  type: 'teams' | 'email' | 'feedback' | 'training'
  notes: string | null
  created_at: string
}

export interface Bug {
  id: string
  bug_title: string
  status: string | null
  priority: string | null
  modulo: string | null
  tool: string | null
  reported_by: string | null
  client_tier: string | null
  assigned_to: string | null
  sprint: string | null
  date_reported: string | null
  due_date: string | null
  tags: string[] | null
  description: string | null
  notion_url: string | null
  source: string
  imported_at: string
  // Joined field (from clients table)
  client_name?: string | null
}

export interface ClientBugStats {
  open_bugs: number
  critical_bugs: number
  high_bugs: number
  resolved_bugs: number
}

// ─── PostHog types ─────────────────────────────────────────────────

export type AdoptionLevel = 'Self-serve' | 'Supported' | 'PM-driven' | 'Dormant' | 'New'

export interface UserActivity {
  email: string
  last_seen_at: string
  events: number
}

export interface UsageSummary {
  client_code: string
  last_seen_external: { last_seen_at: string; email: string } | null
  last_seen_internal: { last_seen_at: string; email: string } | null
  active_external: number
  active_internal: number
  events_external: number
  events_internal: number
  events_external_prev: number   // previous period (for trend)
  events_internal_prev: number
  sessions_external: number
  sessions_internal: number
  sessions_external_prev: number
  sessions_internal_prev: number
  modules: Record<string, number>
  adoption_level: AdoptionLevel
  users_external: UserActivity[]
  users_internal: UserActivity[]
  last_synced_at: string
  period_days: number
}

// ─── Dashboard / list ──────────────────────────────────────────────

export interface ClientWithStats extends Client {
  last_touchpoint_date: string | null
  last_touchpoint_type: string | null
  last_touchpoint_notes: string | null
  health_score: number    // priority_score (after tier penalty) — displayed prominently
  raw_score: number       // health score before tier penalty
  tier_penalty: number    // penalty applied (0 if score ≥ 60 or tier 3)
  days_since_contact: number | null
  // Bug data (present when bugs table has data)
  open_bugs: number
  critical_bugs: number
  high_bugs: number
  resolved_bugs: number
  // PostHog data (present when cache has data)
  adoption_level: AdoptionLevel
  last_seen_external_days: number | null
  last_seen_internal_days: number | null
  active_external: number
  active_internal: number
  has_posthog_data: boolean
  posthog_configured?: boolean // only returned by /api/clients/[id]
}

export interface DashboardStats {
  totalActive: number
  toContact: number
  critical: number
  withCriticalBugs: number
  tier1AtRisk: number
  contractsExpiringSoon: number   // scadono entro 90 giorni
  potentialChurnCount: number
  totalArr: number                // somma ARR clienti attivi
  bugsResolvedThisMonth: number
  notionStatus: 'live' | 'csv' | 'none'
  lastBugImport: string | null
  hasBugData: boolean
  posthogStatus: 'live' | 'synced' | 'ready' | 'none'
  hasPostHogData: boolean
  mondayStatus: 'api' | 'csv' | 'none'
  hasMondayData: boolean
  lastMondaySync: string | null
  lastNotionSync: string | null
  lastPosthogSync: string | null
  clerkStatus: 'live' | 'synced' | 'ready' | 'none'
  lastClerkSync: string | null
  hasClerkData: boolean
  duplicateClients: { name: string; codes: string; count: number }[]
}

// ─── Clerk types ─────────────────────────────────────────────────────

export interface ClerkOrgRow {
  id: string
  slug: string | null
  name: string | null
  modules_enabled: string   // JSON array string
  raw_metadata: string      // JSON object string
  currencies: string        // JSON array string
  total_members: number
  internal_members: number
  external_members: number
  last_synced_at: string
}

export interface ClerkUserRow {
  id: string
  org_id: string | null
  org_slug: string | null
  email: string | null
  first_name: string | null
  last_name: string | null
  role: string | null
  is_internal: number       // 0 or 1
  last_sign_in_at: string | null
  created_at: string | null
  last_synced_at: string
}

// ─── Module comparison ────────────────────────────────────────────────

export type ModuleSignalType = 'green' | 'yellow' | 'red' | 'upsell' | 'grey'

export interface ModuleComparisonEntry {
  key: string
  label: string
  monday_value: number | null    // s_* field value (1 = subscribed)
  clerk_enabled: boolean | null  // null = no Clerk data
  posthog_views: number          // pageview count from modules map
  signal: ModuleSignalType
}

export interface MondaySyncResult {
  synced: number
  created: number
  updated: number
  skipped: number
  errors: string[]
}

export interface BugStats {
  total: number
  open: number
  inProgress: number
  testing: number
  fixed: number
  closed: number
  byCritical: number
  byHigh: number
  byMedium: number
  byLow: number
}
