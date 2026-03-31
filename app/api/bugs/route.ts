import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function GET(request: Request) {
  const db = getDb()
  const { searchParams } = new URL(request.url)
  const clientCode = searchParams.get('client')
  const statusFilter = searchParams.get('status') // 'open' | 'resolved' | null
  const page = parseInt(searchParams.get('page') ?? '1')
  const limit = parseInt(searchParams.get('limit') ?? '200')
  const offset = (page - 1) * limit

  let where = 'WHERE 1=1'
  const args: (string | number)[] = []

  if (clientCode) {
    where += ' AND LOWER(TRIM(b.reported_by)) = ?'
    args.push(clientCode.toLowerCase().trim())
  }

  if (statusFilter === 'open') {
    where += " AND b.status IN ('Open', 'In Progress', 'Testing')"
  } else if (statusFilter === 'resolved') {
    where += " AND b.status IN ('Fixed', 'Closed')"
  }

  const rows = db.prepare(`
    SELECT b.*,
           (SELECT c.name FROM clients c WHERE LOWER(TRIM(c.client_code)) = LOWER(TRIM(b.reported_by)) ORDER BY c.id ASC LIMIT 1) AS client_name,
           (SELECT c.tier FROM clients c WHERE LOWER(TRIM(c.client_code)) = LOWER(TRIM(b.reported_by)) ORDER BY c.id ASC LIMIT 1) AS client_tier_num
    FROM bugs b
    ${where}
    ORDER BY
      CASE b.priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END,
      b.date_reported DESC
    LIMIT ? OFFSET ?
  `).all(...args, limit, offset) as Record<string, unknown>[]

  const result = rows.map((b) => ({
    ...b,
    tags: b.tags ? JSON.parse(b.tags as string) : [],
  }))

  return NextResponse.json(result)
}
