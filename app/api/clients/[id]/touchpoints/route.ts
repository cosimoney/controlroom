import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

type Params = Promise<{ id: string }>

export async function GET(_req: Request, { params }: { params: Params }) {
  const { id } = await params
  const db = getDb()

  const touchpoints = db.prepare(`
    SELECT * FROM touchpoints
    WHERE client_id = ?
    ORDER BY date DESC, created_at DESC
  `).all(parseInt(id))

  return NextResponse.json(touchpoints)
}

export async function POST(request: Request, { params }: { params: Params }) {
  const { id } = await params
  const db = getDb()
  const body = await request.json()
  const { date, type, notes } = body

  if (!type || !['teams', 'email', 'feedback', 'training'].includes(type)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }

  const touchpointDate = date || new Date().toISOString().split('T')[0]

  const result = db.prepare(`
    INSERT INTO touchpoints (client_id, date, type, notes)
    VALUES (?, ?, ?, ?)
  `).run(parseInt(id), touchpointDate, type, notes || null)

  const touchpoint = db.prepare('SELECT * FROM touchpoints WHERE id = ?').get(result.lastInsertRowid)
  return NextResponse.json(touchpoint, { status: 201 })
}
