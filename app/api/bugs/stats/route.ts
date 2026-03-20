import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(request: Request) {
  const db = getDb()
  const { searchParams } = new URL(request.url)
  const clientCode = searchParams.get('client')

  let where = ''
  const args: string[] = []
  if (clientCode) {
    where = 'WHERE LOWER(TRIM(reported_by)) = ?'
    args.push(clientCode.toLowerCase().trim())
  }

  const rows = db.prepare(`
    SELECT status, priority, COUNT(*) as cnt
    FROM bugs ${where}
    GROUP BY status, priority
  `).all(...args) as { status: string; priority: string; cnt: number }[]

  // Unmatched bugs count (no matching client)
  const unmatched = db.prepare(`
    SELECT COUNT(*) as cnt FROM bugs b
    WHERE NOT EXISTS (
      SELECT 1 FROM clients c
      WHERE LOWER(TRIM(c.client_code)) = LOWER(TRIM(b.reported_by))
    )
  `).get() as { cnt: number }

  const stats = {
    total: 0, open: 0, inProgress: 0, testing: 0, fixed: 0, closed: 0,
    byCritical: 0, byHigh: 0, byMedium: 0, byLow: 0,
    unmatched: unmatched.cnt,
  }

  for (const r of rows) {
    stats.total += r.cnt
    if (r.status === 'Open')        stats.open       += r.cnt
    if (r.status === 'In Progress') stats.inProgress += r.cnt
    if (r.status === 'Testing')     stats.testing    += r.cnt
    if (r.status === 'Fixed')       stats.fixed      += r.cnt
    if (r.status === 'Closed')      stats.closed     += r.cnt
    if (r.priority === 'Critical')  stats.byCritical += r.cnt
    if (r.priority === 'High')      stats.byHigh     += r.cnt
    if (r.priority === 'Medium')    stats.byMedium   += r.cnt
    if (r.priority === 'Low')       stats.byLow      += r.cnt
  }

  return NextResponse.json(stats)
}
