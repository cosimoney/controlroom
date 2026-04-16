import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

type Params = Promise<{ id: string }>

export async function GET(_req: Request, { params }: { params: Params }) {
  const { id } = await params
  const sql = await db()

  const touchpoints = await sql`
    SELECT * FROM touchpoints
    WHERE client_id = ${parseInt(id)}
    ORDER BY date DESC, created_at DESC
  `

  return NextResponse.json(touchpoints)
}

export async function POST(request: Request, { params }: { params: Params }) {
  const { id } = await params
  const sql = await db()
  const body = await request.json()
  const { date, type, notes } = body

  if (!type || !['teams', 'email', 'feedback', 'training'].includes(type)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }

  const touchpointDate = date || new Date().toISOString().split('T')[0]

  const [touchpoint] = await sql`
    INSERT INTO touchpoints (client_id, date, type, notes)
    VALUES (${parseInt(id)}, ${touchpointDate}, ${type}, ${notes || null})
    RETURNING *
  `

  return NextResponse.json(touchpoint, { status: 201 })
}
