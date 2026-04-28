/**
 * One-shot endpoint to retry specific Clerk orgs (sequential, no deadlocks).
 * Usage: GET /api/cron/sync-clerk-retry?slugs=ufifi,panin,lavaz
 */

import { NextResponse } from 'next/server'
import { isClerkConfigured, syncClerkBySlugs } from '@/lib/clerk'

export const maxDuration = 60

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isClerkConfigured()) {
    return NextResponse.json({ error: 'CLERK_SECRET_KEY not configured' }, { status: 400 })
  }

  const url = new URL(request.url)
  const slugs = (url.searchParams.get('slugs') ?? '').split(',').filter(Boolean)
  if (slugs.length === 0) {
    return NextResponse.json({ error: 'Missing ?slugs= parameter' }, { status: 400 })
  }

  try {
    const result = await syncClerkBySlugs(slugs)
    return NextResponse.json({ ok: true, timestamp: new Date().toISOString(), ...result })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
