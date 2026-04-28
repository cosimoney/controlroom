/**
 * Cron endpoint for Clerk sync — runs daily via Vercel Cron Jobs.
 * Syncs 30 orgs per run (rotating batch) to fit in 60s timeout.
 * ~120 orgs = 4 batches = full sync every 4 days with daily cron.
 */

import { NextResponse } from 'next/server'
import { isClerkConfigured, syncClerkBatch } from '@/lib/clerk'

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

  try {
    const result = await syncClerkBatch()
    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      ...result,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
