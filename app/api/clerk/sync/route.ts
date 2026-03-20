import { NextResponse } from 'next/server'
import { isClerkConfigured, syncAllClerk } from '@/lib/clerk'

export async function POST() {
  if (!isClerkConfigured()) {
    return NextResponse.json({ error: 'CLERK_SECRET_KEY not configured' }, { status: 400 })
  }
  try {
    const result = await syncAllClerk()
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Sync failed' }, { status: 500 })
  }
}
