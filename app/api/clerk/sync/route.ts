import { NextResponse } from 'next/server'
import { isClerkConfigured, syncAllClerk } from '@/lib/clerk'

// ~120 orgs × 5 batched = 24 batches × ~2s = ~48s
export const maxDuration = 60

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
