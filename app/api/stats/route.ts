import { NextResponse } from 'next/server'
import { db, getSyncMetadata } from '@/lib/db'
import { calculateHealthScore, calculateBugScore, calculatePriorityScore, getDaysSince } from '@/lib/health'
import { isPostHogConfigured, usageScoreFromSummary } from '@/lib/posthog'
import type { UsageSummary } from '@/lib/types'
import { isMondayConfigured } from '@/lib/services/monday.service'

export async function GET() {
  const sql = await db()

  // Active clients with last touchpoint
  const activeClients = await sql<{
    id: number; client_code: string | null; tier: number | null; arr: number | null;
    last_touchpoint_date: string | null; last_touchpoint_type: string | null
  }[]>`
    SELECT c.id, c.client_code, c.tier, c.arr,
           tp.date AS last_touchpoint_date,
           tp.type AS last_touchpoint_type
    FROM clients c
    LEFT JOIN LATERAL (
      SELECT date, type FROM touchpoints WHERE client_id = c.id
      ORDER BY date DESC, created_at DESC LIMIT 1
    ) tp ON TRUE
    WHERE c.status = 'active'
  `

  const [{ bug_count }] = await sql<{ bug_count: number }[]>`SELECT COUNT(*)::int AS bug_count FROM bugs`
  const hasBugDataEarly = bug_count > 0

  // Build a quick bug lookup for stats calculation
  // (split into two grouped queries + LEFT JOIN — Postgres is strict about correlated
  //  subqueries referencing ungrouped columns from the outer query)
  const bugRows = hasBugDataEarly
    ? await sql<{ rby: string; open_count: number; critical_count: number; high_count: number; resolved_count: number }[]>`
        SELECT
          o.rby,
          o.open_count,
          o.critical_count,
          o.high_count,
          COALESCE(r.resolved_count, 0)::int AS resolved_count
        FROM (
          SELECT LOWER(TRIM(reported_by)) AS rby,
                 COUNT(*)::int AS open_count,
                 SUM(CASE WHEN priority='Critical' THEN 1 ELSE 0 END)::int AS critical_count,
                 SUM(CASE WHEN priority='High' THEN 1 ELSE 0 END)::int AS high_count
          FROM bugs WHERE status IN ('Open','In Progress','Testing')
          GROUP BY LOWER(TRIM(reported_by))
        ) o
        LEFT JOIN (
          SELECT LOWER(TRIM(reported_by)) AS rby, COUNT(*)::int AS resolved_count
          FROM bugs WHERE status IN ('Fixed','Closed')
          GROUP BY LOWER(TRIM(reported_by))
        ) r ON r.rby = o.rby
      `
    : []
  const bugMap = new Map(bugRows.map((r) => [r.rby, r]))

  // PostHog usage cache for score alignment
  const phRows = await sql<{ client_code: string; value: string }[]>`
    SELECT client_code, value FROM posthog_usage_cache
    WHERE metric_type = 'summary' AND user_type = 'all' AND period_days = 30
  `
  const phMap = new Map(phRows.map((r) => [r.client_code?.toLowerCase().trim(), r.value]))

  // Clerk external members lookup
  const clerkOrgs = await sql<{ slug: string; external_members: number }[]>`
    SELECT slug, external_members FROM clerk_organizations
  `
  const clerkExtMap = new Map(clerkOrgs.map((o) => [o.slug.toLowerCase(), o.external_members]))

  const totalActive = activeClients.length
  let toContact = 0
  let critical = 0
  let tier1AtRisk = 0
  for (const c of activeClients) {
    const code = c.client_code?.toLowerCase().trim() ?? ''
    const days = getDaysSince(c.last_touchpoint_date)

    // Skip internal-use clients from touchpoint counters
    const cClerkExt = clerkExtMap.get(code) ?? (() => { for (const [slug, ext] of clerkExtMap) { if (code.startsWith(slug)) return ext } return null })()
    const isInternalUse = phMap.has(code) && !(cClerkExt != null && cClerkExt > 0)
    const isLowArr = (c.arr ?? 0) < 3000
    if (!isInternalUse) {
      if (days === null || days > 30) toContact++
      if (!isLowArr && (days === null || days > 60)) critical++
    }

    // Compute priority score identical to /api/clients (includes PostHog usage)
    const bugData = bugMap.get(code)
    const phRaw = phMap.get(code)
    let usageScore: number | null = null
    let phSummary: UsageSummary | null = null
    if (phRaw) {
      try { phSummary = JSON.parse(phRaw) as UsageSummary; usageScore = usageScoreFromSummary(phSummary) } catch { /* ignore */ }
    }
    // Internal-use clients: don't penalize for PM-driven adoption or missing touchpoints
    const clerkExt = clerkExtMap.get(code) ?? (() => { for (const [slug, ext] of clerkExtMap) { if (code.startsWith(slug)) return ext } return null })()
    const isIntUse = phSummary?.adoption_level === 'PM-driven' && !(clerkExt != null && clerkExt > 0)
    if (usageScore !== null && isIntUse) {
      usageScore = 50
    }
    const sBugInfo = hasBugDataEarly ? { open: bugData?.open_count ?? 0, critical: bugData?.critical_count ?? 0, high: bugData?.high_count ?? 0, resolved: bugData?.resolved_count ?? 0 } : null
    const rawScore = isIntUse
      ? Math.round(
          0.50 * (sBugInfo ? calculateBugScore(sBugInfo.open, sBugInfo.critical, sBugInfo.high, sBugInfo.resolved) : 100)
          + 0.50 * (usageScore ?? 50)
        )
      : calculateHealthScore(
          c.last_touchpoint_date,
          c.last_touchpoint_type,
          sBugInfo,
          hasBugDataEarly,
          usageScore,
        )
    const { priorityScore } = calculatePriorityScore(rawScore, c.tier)
    if ((c.tier ?? 3) === 1 && priorityScore < 60) tier1AtRisk++
  }

  // Bug stats
  const hasBugData = hasBugDataEarly

  let withCriticalBugs = 0
  if (hasBugData) {
    const critBugCodes = await sql<{ code: string }[]>`
      SELECT DISTINCT LOWER(TRIM(reported_by)) as code
      FROM bugs
      WHERE status IN ('Open', 'In Progress', 'Testing')
        AND priority IN ('Critical', 'High')
    `
    const critSet = new Set(critBugCodes.map((r) => r.code))
    withCriticalBugs = activeClients.filter(
      (c) => c.client_code && critSet.has(c.client_code.toLowerCase().trim())
    ).length
  }

  const thisMonthStart = new Date()
  thisMonthStart.setDate(1); thisMonthStart.setHours(0, 0, 0, 0)
  const monthStr = thisMonthStart.toISOString().split('T')[0]
  const [{ bugs_resolved_this_month }] = await sql<{ bugs_resolved_this_month: number }[]>`
    SELECT COUNT(*)::int as bugs_resolved_this_month FROM bugs
    WHERE status IN ('Fixed', 'Closed') AND COALESCE(due_date, date_reported) >= ${monthStr}
  `
  const bugsResolvedThisMonth = bugs_resolved_this_month

  // Notion status
  const notionEnabled = !!(process.env.NOTION_TOKEN && process.env.NOTION_BUGS_DATABASE_ID)
  let notionStatus: 'live' | 'csv' | 'none' = 'none'
  let lastBugImport: string | null = null

  if (notionEnabled) notionStatus = 'live'
  else if (hasBugData) notionStatus = 'csv'

  if (hasBugData) {
    const [row] = await sql<{ last: string | null }[]>`SELECT MAX(imported_at)::text as last FROM bugs WHERE source != 'seed'`
    lastBugImport = row.last
    if (!lastBugImport) {
      const [seedRow] = await sql<{ last: string | null }[]>`SELECT MAX(imported_at)::text as last FROM bugs`
      lastBugImport = seedRow.last
    }
  }

  // PostHog status
  const phConfigured = isPostHogConfigured()
  const [{ ph_cache_count }] = await sql<{ ph_cache_count: number }[]>`
    SELECT COUNT(*)::int as ph_cache_count FROM posthog_usage_cache WHERE metric_type='summary'
  `
  const hasPostHogData = ph_cache_count > 0

  let posthogStatus: 'live' | 'synced' | 'ready' | 'none' = 'none'
  if (phConfigured && hasPostHogData) posthogStatus = 'live'
  else if (hasPostHogData) posthogStatus = 'synced'
  else if (phConfigured) posthogStatus = 'ready'

  // Monday status + derived stats — inlined here since it depends on the async DB
  const [{ monday_record_count }] = await sql<{ monday_record_count: number }[]>`
    SELECT COUNT(*)::int as monday_record_count FROM clients
    WHERE arr IS NOT NULL OR monday_health IS NOT NULL
  `
  const apiConfigured = isMondayConfigured()
  let mondayStatus: 'api' | 'csv' | 'none' = 'none'
  if (apiConfigured) mondayStatus = 'api'
  else if (monday_record_count > 0) mondayStatus = 'csv'

  const now = new Date()
  const in90 = new Date(now); in90.setDate(now.getDate() + 90)
  const in90Str = in90.toISOString().split('T')[0]
  const nowStr = now.toISOString().split('T')[0]

  const [{ contracts_expiring_soon }] = await sql<{ contracts_expiring_soon: number }[]>`
    SELECT COUNT(*)::int as contracts_expiring_soon FROM clients
    WHERE status = 'active' AND service_end IS NOT NULL
      AND service_end >= ${nowStr} AND service_end <= ${in90Str}
  `

  const [{ potential_churn_count }] = await sql<{ potential_churn_count: number }[]>`
    SELECT COUNT(*)::int as potential_churn_count FROM clients
    WHERE status = 'active'
      AND LOWER(TRIM(potential_churn)) NOT IN ('', 'no', '-')
      AND potential_churn IS NOT NULL
  `

  const [{ total_arr }] = await sql<{ total_arr: number }[]>`
    SELECT COALESCE(SUM(arr), 0)::float as total_arr FROM clients
    WHERE status = 'active' AND arr IS NOT NULL AND arr > 0
  `

  const mondayMeta  = await getSyncMetadata('monday')
  const notionMeta  = await getSyncMetadata('notion')
  const posthogMeta = await getSyncMetadata('posthog')

  // Clerk status
  const clerkSecretSet = !!process.env.CLERK_SECRET_KEY
  const [{ org_count: clerkOrgCount }] = await sql<{ org_count: number }[]>`
    SELECT COUNT(*)::int as org_count FROM clerk_organizations
  `
  const hasClerkData = clerkOrgCount > 0
  let clerkStatus: 'live' | 'synced' | 'ready' | 'none' = 'none'
  if (clerkSecretSet && hasClerkData) clerkStatus = 'live'
  else if (hasClerkData) clerkStatus = 'synced'
  else if (clerkSecretSet) clerkStatus = 'ready'
  const clerkMeta = await getSyncMetadata('clerk')

  // Duplicate client detection (same name, both active)
  const duplicateRows = await sql<{ norm_name: string; codes: string; cnt: number }[]>`
    SELECT LOWER(TRIM(name)) as norm_name,
           STRING_AGG(COALESCE(client_code, '—'), ',') as codes,
           COUNT(*)::int as cnt
    FROM clients
    WHERE status = 'active'
    GROUP BY LOWER(TRIM(name))
    HAVING COUNT(*) > 1
  `
  const duplicateClients = duplicateRows.map((r) => ({ name: r.norm_name, codes: r.codes, count: r.cnt }))

  return NextResponse.json({
    totalActive,
    toContact,
    critical,
    tier1AtRisk,
    contractsExpiringSoon: contracts_expiring_soon,
    potentialChurnCount: potential_churn_count,
    totalArr: total_arr,
    withCriticalBugs,
    bugsResolvedThisMonth,
    notionStatus,
    lastBugImport,
    hasBugData,
    posthogStatus,
    hasPostHogData,
    mondayStatus,
    hasMondayData: monday_record_count > 0,
    lastMondaySync: mondayMeta.last_sync_at,
    lastNotionSync: notionMeta.last_sync_at,
    lastPosthogSync: posthogMeta.last_sync_at,
    clerkStatus,
    hasClerkData,
    lastClerkSync: clerkMeta.last_sync_at,
    duplicateClients,
  })
}
