import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

type Params = Promise<{ id: string }>

export async function DELETE(_req: Request, { params }: { params: Params }) {
  const { id } = await params
  const db = getDb()
  db.prepare('DELETE FROM touchpoints WHERE id = ?').run(parseInt(id))
  return NextResponse.json({ success: true })
}
