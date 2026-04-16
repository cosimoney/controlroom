import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

type Params = Promise<{ id: string }>

export async function DELETE(_req: Request, { params }: { params: Params }) {
  const { id } = await params
  const sql = await db()
  await sql`DELETE FROM touchpoints WHERE id = ${parseInt(id)}`
  return NextResponse.json({ success: true })
}
