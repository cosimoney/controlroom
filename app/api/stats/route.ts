import { NextResponse } from 'next/server'
import { getDb, getSyncMetadata } from '@/lib/db'
import { calculateHealthScore, calculateBugScore, calculatePriorityScore, getDaysSince } from '@/lib/health'
import { isPostHogConfigured, usageScoreFromSummary } from '@/lib/posthog'
import type { UsageSummary } from '@/lib/types'
import { getMondayStatus } from '@/lib/services/monday.service'

export async function GET() {
  const db = getDb()

  // Active clients with last touchpoint
  const activeClients = db.prepare(`
    SELECT c.id, c.client_code, c.tier, c.arr,
           tp.date AS last_touchpoint_date,
           tp.type AS last_touchpoint_type
    FROM clients c
    LEFT JOIN touchpoints tp ON tp.id = (
      SELECT id FROM touchpoints WHERE client_id = c.id
      ORDER BY date DESC, created_at DESC LIMIT 1
    )
    WHERE c.status = 'active'
  `).all() as { id: number; client_code: string | null; tier: number | null; arr: number | null; last_touchpoint_date: string | null; last_touchpoint_type: string | null }[]

  const { bugCount } = db.prepare('SELECT COUNT(*) as bugCount FROM bugs').get() as { bugCount: number }
  const hasBugDataEarly = bugCount > 0

  // Build a quick bug lookup for stats calculation
  const bugRows = hasBugDataEarly
    ? db.prepare(`
        SELECT LOWER(TRIM(reported_by)) AS rby,
               COUNT(*) AS open_count,
               SUM(CASE WHEN priority='Critical' THEN 1 ELSE 0 END) AS critical_count,
               SUM(CASE WHEN priority='High' THEN 1 ELSE 0 END) AS high_count,
               (SELECT COUNT(*) FROM bugs b2 WHERE b2.status IN ('Fixed','Closed') AND LOWER(TRIM(b2.reported_by)) = LOWER(TRIM(bugs.reported_by))) AS resolved_count
        FROM bugs WHERE status IN ('Open','In Progress','Testing')
        GROUP BY LOWER(TRIM(reported_by))
      `).all() as { rby: string; open_count: number; critical_count: number; high_count: number; resolved_count: number }[]
    : []
  const bugMap = new Map(bugRows.map((r) => [r.rby, r]))

  // PostHog usage cache for score alignment
  const phRows = db.prepare(`
    SELECT client_code, value FROM posthog_usage_cache
    WHERE metric_type = 'summary' AND user_type = 'all' AND period_days = 30
  `).all() as { client_code: string; value: string }[]
  const phMap = new Map(phRows.map((r) => [r.client_code?.toLowerCase().trim(), r.value]))

  // Clerk external members lookup
  const clerkOrgs = db.prepare('SELECT slug, external_members FROM clerk_organizations').all() as { slug: string; external_members: number }[]
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
    const critBugCodes = db.prepare(`
      SELECT DISTINCT LOWER(TRIM(reported_by)) as code
      FROM bugs
      WHERE status IN ('Open', 'In Progress', 'Testing')
        AND priority IN ('Critical', 'High')
    `).all() as { code: string }[]
    const critSet = new Set(critBugCodes.map((r) => r.code))
    withCriticalBugs = activeClients.filter(
      (c) => c.client_code && critSet.has(c.client_code.toLowerCase().trim())
    ).length
  }

  const thisMonthStart = new Date()
  thisMonthStart.setDate(1); thisMonthStart.setHours(0, 0, 0, 0)
  const monthStr = thisMonthStart.toISOString().split('T')[0]
  const { bugsResolvedThisMonth } = db.prepare(`
    SELECT COUNT(*) as bugsResolvedThisMonth FROM bugs
    WHERE status IN ('Fixed', 'Closed') AND COALESCE(due_date, date_reported) >= ?
  `).get(monthStr) as { bugsResolvedThisMonth: number }

  // Notion status
  const notionEnabled = !!(process.env.NOTION_TOKEN && process.env.NOTION_BUGS_DATABASE_ID)
  let notionStatus: 'live' | 'csv' | 'none' = 'none'
  let lastBugImport: string | null = null

  if (notionEnabled) notionStatus = 'live'
  else if (hasBugData) notionStatus = 'csv'

  if (hasBugData) {
    const row = db.prepare("SELECT MAX(imported_at) as last FROM bugs WHERE source != 'seed'").get() as { last: string | null }
    lastBugImport = row.last
    if (!lastBugImport) {
      const seedRow = db.prepare('SELECT MAX(imported_at) as last FROM bugs').get() as { last: string | null }
      lastBugImport = seedRow.last
    }
  }

  // PostHog status
  const phConfigured = isPostHogConfigured()
  const { phCacheCount } = db.prepare(
    "SELECT COUNT(*) as phCacheCount FROM posthog_usage_cache WHERE metric_type='summary'"
  ).get() as { phCacheCount: number }
  const hasPostHogData = phCacheCount > 0

  let posthogStatus: 'live' | 'synced' | 'ready' | 'none' = 'none'
  if (phConfigured && hasPostHogData) posthogStatus = 'live'
  else if (hasPostHogData) posthogStatus = 'synced'
  else if (phConfigured) posthogStatus = 'ready'

  // Monday status + derived stats
  const mondayInfo = getMondayStatus()
  const now = new Date()
  const in90 = new Date(now); in90.setDate(now.getDate() + 90)
  const in90Str = in90.toISOString().split('T')[0]
  const nowStr = now.toISOString().split('T')[0]

  const { contractsExpiringSoon } = db.prepare(`
    SELECT COUNT(*) as contractsExpiringSoon FROM clients
    WHERE status = 'active' AND service_end IS NOT NULL
      AND service_end >= ? AND service_end <= ?
  `).get(nowStr, in90Str) as { contractsExpiringSoon: number }

  const { potentialChurnCount } = db.prepare(`
    SELECT COUNT(*) as potentialChurnCount FROM clients
    WHERE status = 'active'
      AND LOWER(TRIM(potential_churn)) NOT IN ('', 'no', '-')
      AND potential_churn IS NOT NULL
  `).get() as { potentialChurnCount: number }

  const { totalArr } = db.prepare(`
    SELECT COALESCE(SUM(arr), 0) as totalArr FROM clients
    WHERE status = 'active' AND arr IS NOT NULL AND arr > 0
  `).get() as { totalArr: number }

  const mondayMeta  = getSyncMetadata('monday')
  const notionMeta  = getSyncMetadata('notion')
  const posthogMeta = getSyncMetadata('posthog')

  // Clerk status
  const clerkSecretSet = !!process.env.CLERK_SECRET_KEY
  const { orgCount: clerkOrgCount } = db.prepare('SELECT COUNT(*) as orgCount FROM clerk_organizations').get() as { orgCount: number }
  const hasClerkData = clerkOrgCount > 0
  let clerkStatus: 'live' | 'synced' | 'ready' | 'none' = 'none'
  if (clerkSecretSet && hasClerkData) clerkStatus = 'live'
  else if (hasClerkData) clerkStatus = 'synced'
  else if (clerkSecretSet) clerkStatus = 'ready'
  const clerkMeta = getSyncMetadata('clerk')

  // Duplicate client detection (same name, both active)
  const duplicateRows = db.prepare(`
    SELECT LOWER(TRIM(name)) as norm_name, GROUP_CONCAT(COALESCE(client_code, '—')) as codes, COUNT(*) as cnt
    FROM clients
    WHERE status = 'active'
    GROUP BY LOWER(TRIM(name))
    HAVING COUNT(*) > 1
  `).all() as { norm_name: string; codes: string; cnt: number }[]
  const duplicateClients = duplicateRows.map((r) => ({ name: r.norm_name, codes: r.codes, count: r.cnt }))

  return NextResponse.json({
    totalActive,
    toContact,
    critical,
    tier1AtRisk,
    contractsExpiringSoon,
    potentialChurnCount,
    totalArr,
    withCriticalBugs,
    bugsResolvedThisMonth,
    notionStatus,
    lastBugImport,
    hasBugData,
    posthogStatus,
    hasPostHogData,
    mondayStatus: mondayInfo.status,
    hasMondayData: mondayInfo.recordCount > 0,
    lastMondaySync: mondayMeta.last_sync_at,
    lastNotionSync: notionMeta.last_sync_at,
    lastPosthogSync: posthogMeta.last_sync_at,
    clerkStatus,
    hasClerkData,
    lastClerkSync: clerkMeta.last_sync_at,
    duplicateClients,
  })
}
