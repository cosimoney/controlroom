import type { AdoptionLevel } from './types'

export const TOUCHPOINT_WEIGHTS: Record<string, number> = {
  teams:    1.0,
  feedback: 1.0,
  training: 1.0,
  email:    0.5,
}

export function getDaysSince(dateStr: string | null): number | null {
  if (!dateStr) return null
  const date = new Date(dateStr)
  const now = new Date()
  const diff = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
  return Math.max(0, diff)
}

/** Phase 1 recency score (0–100) */
export function calculateRecencyScore(lastDate: string | null, lastType: string | null): number {
  if (!lastDate || !lastType) return 0
  const actualDays = getDaysSince(lastDate)
  if (actualDays === null) return 0
  const weight = TOUCHPOINT_WEIGHTS[lastType] ?? 1.0
  const effectiveDays = actualDays / weight
  if (effectiveDays <= 14) return 100
  if (effectiveDays <= 30) return 80
  if (effectiveDays <= 45) return 60
  if (effectiveDays <= 60) return 40
  return 20
}

/** Phase 2 bug score (0–100) */
export function calculateBugScore(
  openBugs: number,
  criticalBugs: number,
  highBugs: number,
  resolvedBugs: number,
): number {
  const otherOpen = Math.max(0, openBugs - criticalBugs - highBugs)
  const weighted = criticalBugs * 2 + highBugs * 1.5 + otherOpen * 1

  let base: number
  if (weighted === 0)      base = 100
  else if (weighted < 2)   base = 80
  else if (weighted < 3)   base = 60
  else if (weighted < 4)   base = 40
  else                     base = 20

  const total = openBugs + resolvedBugs
  let bonus = 0
  if (total > 0) {
    const ratio = resolvedBugs / total
    if (ratio > 0.8)      bonus = 10
    else if (ratio > 0.5) bonus = 5
  }

  return Math.min(100, base + bonus)
}

// ─── Phase 3: PostHog usage scoring ────────────────────────────────

/** Derive adoption level from active user counts */
export function computeAdoptionLevel(activeExternal: number, activeInternal: number): Exclude<AdoptionLevel, 'New'> {
  if (activeExternal === 0 && activeInternal === 0) return 'Dormant'
  if (activeExternal === 0) return 'PM-driven'
  const ratio = activeExternal / Math.max(activeInternal, 1)
  if (activeExternal >= 3 && ratio > 2) return 'Self-serve'
  return 'Supported'
}

/** Phase 3 usage score (0–100) from adoption level + last seen signal */
export function computeUsageScore(adoptionLevel: AdoptionLevel, lastSeenExternal: string | null): number {
  const base: Record<AdoptionLevel, number> = {
    'Self-serve': 100,
    'Supported':  75,
    'PM-driven':  20,
    'Dormant':    10,
    'New':        50,
  }
  let score = base[adoptionLevel]

  if (lastSeenExternal) {
    const days = Math.floor((Date.now() - new Date(lastSeenExternal).getTime()) / 86400000)
    if (days <= 7)   score += 10
    else if (days > 30) score -= 15
  }

  return Math.max(0, Math.min(100, score))
}

/**
 * Combined health score — Phase 3 formula:
 *   - Phase 3 (usageScore provided):  0.35 × recency + 0.30 × bug + 0.35 × usage
 *   - Phase 2 (hasBugData, no usage): 0.50 × recency + 0.50 × bug
 *   - Phase 1 (neither):              recency only
 */
export function calculateHealthScore(
  lastDate: string | null,
  lastType: string | null,
  bugData?: { open: number; critical: number; high: number; resolved: number } | null,
  hasBugData = false,
  usageScore?: number | null,
): number {
  const recency = calculateRecencyScore(lastDate, lastType)

  if (usageScore !== null && usageScore !== undefined) {
    const bug = hasBugData && bugData
      ? calculateBugScore(bugData.open, bugData.critical, bugData.high, bugData.resolved)
      : 50 // neutral when no bug data
    return Math.round(0.35 * recency + 0.30 * bug + 0.35 * usageScore)
  }

  if (hasBugData && bugData) {
    const bug = calculateBugScore(bugData.open, bugData.critical, bugData.high, bugData.resolved)
    return Math.round(0.50 * recency + 0.50 * bug)
  }

  return recency
}

// ─── Display helpers ───────────────────────────────────────────────

export function getDaysColorClass(days: number | null): string {
  if (days === null) return 'text-slate-500'
  if (days <= 30) return 'text-green-400'
  if (days <= 60) return 'text-yellow-400'
  return 'text-red-400'
}

export function getScoreDotClass(score: number): string {
  if (score >= 80) return 'bg-green-400'
  if (score >= 60) return 'bg-yellow-400'
  if (score >= 40) return 'bg-orange-400'
  if (score > 0)   return 'bg-red-400'
  return 'bg-slate-600'
}

export function getScoreTextClass(score: number): string {
  if (score >= 80) return 'text-green-400'
  if (score >= 60) return 'text-yellow-400'
  if (score >= 40) return 'text-orange-400'
  if (score > 0)   return 'text-red-400'
  return 'text-slate-500'
}

export function formatTouchpointType(type: string): string {
  const icons: Record<string, string> = { teams: '🎥', email: '📧', feedback: '💬', training: '🎓' }
  return icons[type] ?? type
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  const date = new Date(dateStr)
  return date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

export const PRIORITY_COLORS: Record<string, string> = {
  Critical: 'bg-red-500/15 text-red-400 border-red-500/30',
  High:     'bg-orange-500/15 text-orange-400 border-orange-500/30',
  Medium:   'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  Low:      'bg-slate-500/15 text-slate-400 border-slate-500/30',
}

export const STATUS_COLORS: Record<string, string> = {
  'Open':        'bg-red-500/15 text-red-400 border-red-500/30',
  'In Progress': 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  'Testing':     'bg-purple-500/15 text-purple-400 border-purple-500/30',
  'Fixed':       'bg-green-500/15 text-green-400 border-green-500/30',
  'Closed':      'bg-slate-500/15 text-slate-400 border-slate-500/30',
}

export const OPEN_STATUSES  = ['Open', 'In Progress', 'Testing']
export const CLOSED_STATUSES = ['Fixed', 'Closed']

// ─── Phase 3b: Tier penalty ────────────────────────────────────────

/**
 * Applies a tier-based urgency penalty when a client is in the critical zone.
 * The raw health score is unmodified when score ≥ 60.
 *
 * @returns { priorityScore, penalty }
 */
export function calculatePriorityScore(
  rawScore: number,
  tier: number | null,
): { priorityScore: number; penalty: number } {
  const t = tier ?? 3
  if (rawScore >= 60) return { priorityScore: rawScore, penalty: 0 }
  // Below 60: Tier 1 gets -10, Tier 2 gets -5, Tier 3 no penalty
  const penalty = t === 1 ? 10 : t === 2 ? 5 : 0
  return { priorityScore: Math.max(0, rawScore - penalty), penalty }
}

export const TIER_STYLES: Record<number, { bg: string; text: string; label: string }> = {
  1: { bg: '#97C459', text: '#173404', label: 'Tier 1' },
  2: { bg: '#85B7EB', text: '#042C53', label: 'Tier 2' },
  3: { bg: '#AFA9EC', text: '#26215C', label: 'Tier 3' },
}

// ─── Adoption display helpers ──────────────────────────────────────

export const ADOPTION_COLORS: Record<string, string> = {
  'Self-serve': 'bg-green-500/15 text-green-400 border-green-500/30',
  'Supported':  'bg-blue-500/15 text-blue-400 border-blue-500/30',
  'PM-driven':  'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  'Dormant':    'bg-red-500/15 text-red-400 border-red-500/30',
  'New':        'bg-slate-500/15 text-slate-400 border-slate-500/30',
}
