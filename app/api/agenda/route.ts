import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// Contact cadence by tier (days between contacts)
const CADENCE: Record<number, number> = { 1: 30, 2: 45, 3: 60 }

// Max clients per week — realistic CSM throughput
const WEEK_CAPACITY = 8

type AgendaItem = {
  client_id: number
  client_name: string
  client_code: string
  tier: number
  arr: number | null
  last_touchpoint_date: string | null
  days_since_contact: number | null
  next_due_date: string
  weeks_from_now: number
  reasons: string[]
  priority: 'high' | 'medium' | 'low'
  contacted_this_week: boolean
  rolled_over: boolean
  score: number // internal urgency score for sorting/capacity
}

function startOfWeek(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day // Monday as start
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

export async function GET() {
  const sql = await db()

  const clients = await sql<{
    id: number; name: string; client_code: string; tier: number | null; arr: number | null;
    service_end: string | null; potential_churn: string | null;
    last_touchpoint_date: string | null;
    open_bugs: number; critical_bugs: number; high_bugs: number;
    clerk_ext: number | null;
  }[]>`
    SELECT c.id, c.name, c.client_code, c.tier, c.arr, c.service_end, c.potential_churn,
           tp.date AS last_touchpoint_date,
           COALESCE(bo.open_count, 0)::int AS open_bugs,
           COALESCE(bo.critical_count, 0)::int AS critical_bugs,
           COALESCE(bo.high_count, 0)::int AS high_bugs,
           (SELECT co.external_members FROM clerk_organizations co WHERE LOWER(TRIM(co.slug)) = LOWER(TRIM(c.client_code)) LIMIT 1) AS clerk_ext
    FROM clients c
    LEFT JOIN LATERAL (
      SELECT date FROM touchpoints WHERE client_id = c.id
      ORDER BY date DESC, created_at DESC LIMIT 1
    ) tp ON TRUE
    LEFT JOIN (
      SELECT LOWER(TRIM(reported_by)) AS rby,
             COUNT(*)::int AS open_count,
             SUM(CASE WHEN priority='Critical' THEN 1 ELSE 0 END)::int AS critical_count,
             SUM(CASE WHEN priority='High' THEN 1 ELSE 0 END)::int AS high_count
      FROM bugs WHERE status IN ('Open','In Progress','Testing')
      GROUP BY LOWER(TRIM(reported_by))
    ) bo ON LOWER(TRIM(c.client_code)) = bo.rby
    WHERE c.status = 'active' AND c.client_code IS NOT NULL
  `

  const now = new Date()
  const thisWeekStart = startOfWeek(now)
  const thisWeekStartStr = thisWeekStart.toISOString().slice(0, 10)

  // Prefetch all touchpoints since Monday — avoids N+1 queries inside the loop
  const contactedRows = await sql<{ client_id: number }[]>`
    SELECT DISTINCT client_id FROM touchpoints WHERE date >= ${thisWeekStartStr}
  `
  const contactedSet = new Set(contactedRows.map((r) => Number(r.client_id)))

  const rawItems: AgendaItem[] = []

  for (const c of clients) {
    // Skip internal-use clients
    if (!c.clerk_ext || c.clerk_ext === 0) continue
    // Skip very low ARR
    if ((c.arr ?? 0) < 3000) continue

    const tier = c.tier ?? 3
    const cadence = CADENCE[tier] ?? 60

    // Compute raw next due date based on last touchpoint + cadence
    let nextDue: Date
    let rolledOver = false
    if (c.last_touchpoint_date) {
      const last = new Date(c.last_touchpoint_date)
      nextDue = addDays(last, cadence)
    } else {
      nextDue = new Date(now)
    }

    // If already overdue, roll over to this week
    if (nextDue < thisWeekStart) {
      rolledOver = true
      nextDue = new Date(thisWeekStart)
    }

    const dueWeekStart = startOfWeek(nextDue)
    const weeksFromNow = Math.floor((dueWeekStart.getTime() - thisWeekStart.getTime()) / (7 * 86400000))

    if (weeksFromNow < 0 || weeksFromNow > 7) continue

    const daysSinceContact = c.last_touchpoint_date
      ? Math.floor((now.getTime() - new Date(c.last_touchpoint_date).getTime()) / 86400000)
      : null

    const reasons: string[] = []
    let priority: 'high' | 'medium' | 'low' = 'low'
    let score = 0

    // Base score from tier (lower tier = higher urgency)
    score += (4 - tier) * 10

    // Reason: overdue / rollover
    if (daysSinceContact === null) {
      reasons.push('Mai contattato')
      priority = tier === 1 ? 'high' : 'medium'
      score += 30
    } else if (daysSinceContact > cadence) {
      reasons.push(`${daysSinceContact}gg dall'ultimo contatto`)
      priority = tier === 1 ? 'high' : 'medium'
      score += Math.min(40, daysSinceContact - cadence) // more overdue = higher score
    } else {
      reasons.push(`Cadenza ${cadence}gg`)
    }

    if (rolledOver) {
      reasons.push('Da settimana precedente')
      priority = 'high'
      score += 20
    }

    // Bugs
    if (c.critical_bugs > 0) {
      reasons.push(`${c.critical_bugs} bug critici`)
      priority = 'high'
      score += 30
    } else if (c.high_bugs > 0) {
      reasons.push(`${c.high_bugs} bug high`)
      if (priority === 'low') priority = 'medium'
      score += 15
    }

    // Contract expiring
    if (c.service_end) {
      const endDate = new Date(c.service_end)
      const daysToEnd = Math.floor((endDate.getTime() - now.getTime()) / 86400000)
      if (daysToEnd >= 0 && daysToEnd <= 90) {
        reasons.push(`Contratto scade in ${daysToEnd}gg`)
        priority = 'high'
        score += 25
      }
    }

    // Churn
    if (c.potential_churn && !['', 'no', '-'].includes(c.potential_churn.toLowerCase().trim())) {
      reasons.push('Potential churn')
      priority = 'high'
      score += 25
    }

    // ARR weight
    score += Math.min(20, Math.floor((c.arr ?? 0) / 5000))

    if (tier === 1 && priority === 'low') priority = 'medium'

    rawItems.push({
      client_id: c.id,
      client_name: c.name,
      client_code: c.client_code,
      tier,
      arr: c.arr,
      last_touchpoint_date: c.last_touchpoint_date,
      days_since_contact: daysSinceContact,
      next_due_date: dueWeekStart.toISOString().slice(0, 10),
      weeks_from_now: weeksFromNow,
      reasons,
      priority,
      contacted_this_week: contactedSet.has(Number(c.id)),
      rolled_over: rolledOver,
      score,
    })
  }

  // Group by week, respecting capacity
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  const weekItems: Record<number, AgendaItem[]> = {}

  // Sort all items by score (highest first) within their own week
  // Then apply capacity cap starting from this week — overflow pushes to next week
  rawItems.sort((a, b) => {
    if (a.weeks_from_now !== b.weeks_from_now) return a.weeks_from_now - b.weeks_from_now
    const po = priorityOrder[a.priority] - priorityOrder[b.priority]
    if (po !== 0) return po
    return b.score - a.score
  })

  for (const item of rawItems) {
    let targetWeek = item.weeks_from_now
    // Already-contacted items stay in their original week and don't count toward capacity
    if (item.contacted_this_week) {
      if (!weekItems[targetWeek]) weekItems[targetWeek] = []
      weekItems[targetWeek].push(item)
      continue
    }
    // Push overflow to next available week (but not past week 7)
    while (targetWeek <= 7 && (weekItems[targetWeek]?.filter((i) => !i.contacted_this_week).length ?? 0) >= WEEK_CAPACITY) {
      targetWeek++
    }
    if (targetWeek > 7) continue // beyond horizon
    if (!weekItems[targetWeek]) weekItems[targetWeek] = []
    item.weeks_from_now = targetWeek
    weekItems[targetWeek].push(item)
  }

  // Final sort within each week
  for (const w of Object.values(weekItems)) {
    w.sort((a, b) => {
      // Contacted go to bottom
      if (a.contacted_this_week !== b.contacted_this_week) return a.contacted_this_week ? 1 : -1
      const po = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (po !== 0) return po
      return b.score - a.score
    })
  }

  const weekList = Array.from({ length: 8 }, (_, i) => {
    const start = addDays(thisWeekStart, i * 7)
    const end = addDays(start, 6)
    return {
      week_offset: i,
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
      capacity: WEEK_CAPACITY,
      items: weekItems[i] ?? [],
    }
  })

  return NextResponse.json({ weeks: weekList })
}
