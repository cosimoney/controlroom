import { NextResponse } from 'next/server'
import { db, getSql } from '@/lib/db'

export async function GET(request: Request) {
  const sql = await db()
  const { searchParams } = new URL(request.url)
  const clientCode = searchParams.get('client')
  const statusFilter = searchParams.get('status') // 'open' | 'resolved' | null
  const page = parseInt(searchParams.get('page') ?? '1')
  const limit = parseInt(searchParams.get('limit') ?? '200')
  const offset = (page - 1) * limit

  // Dynamic WHERE clause using postgres.js fragments
  const rawSql = getSql()
  const clientFilter = clientCode
    ? rawSql`AND LOWER(TRIM(b.reported_by)) = ${clientCode.toLowerCase().trim()}`
    : rawSql``
  const statusWhere = statusFilter === 'open'
    ? rawSql`AND b.status IN ('Open', 'In Progress', 'Testing')`
    : statusFilter === 'resolved'
      ? rawSql`AND b.status IN ('Fixed', 'Closed')`
      : rawSql``

  const rows = await sql<Record<string, unknown>[]>`
    SELECT b.*,
           (SELECT c.name FROM clients c WHERE LOWER(TRIM(c.client_code)) = LOWER(TRIM(b.reported_by)) ORDER BY c.id ASC LIMIT 1) AS client_name,
           (SELECT c.tier FROM clients c WHERE LOWER(TRIM(c.client_code)) = LOWER(TRIM(b.reported_by)) ORDER BY c.id ASC LIMIT 1) AS client_tier_num
    FROM bugs b
    WHERE 1=1 ${clientFilter} ${statusWhere}
    ORDER BY
      CASE b.priority WHEN 'Critical' THEN 1 WHEN 'High' THEN 2 WHEN 'Medium' THEN 3 ELSE 4 END,
      b.date_reported DESC
    LIMIT ${limit} OFFSET ${offset}
  `

  const result = rows.map((b) => ({
    ...b,
    tags: b.tags ? JSON.parse(b.tags as string) : [],
  }))

  return NextResponse.json(result)
}
