import { NextResponse } from 'next/server'
import { isPostHogConfigured, getOrSyncUsage, getUsageFromCache, usageScoreFromSummary } from '@/lib/posthog'
import { db } from '@/lib/db'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const clientCode = searchParams.get('client')
  const days = parseInt(searchParams.get('days') ?? '30')

  if (!isPostHogConfigured()) {
    return NextResponse.json(
      { error: 'PostHog non configurato. Aggiungi POSTHOG_API_KEY e POSTHOG_PROJECT_ID in .env.local' },
      { status: 503 },
    )
  }

  // Single client
  if (clientCode) {
    const summary = await getOrSyncUsage(clientCode, days)
    if (!summary) {
      return NextResponse.json({ adoption_level: 'New', client_code: clientCode }, { status: 200 })
    }
    return NextResponse.json({ ...summary, usage_score: usageScoreFromSummary(summary) })
  }

  // All clients — read from cache only (no bulk auto-sync on GET)
  const sql = await db()
  const clients = await sql<{ client_code: string }[]>`
    SELECT client_code FROM clients WHERE client_code IS NOT NULL
  `

  const entries = await Promise.all(
    clients.map(async ({ client_code }) => {
      const cached = await getUsageFromCache(client_code, days)
      return [
        client_code,
        cached ? { ...cached, usage_score: usageScoreFromSummary(cached) } : null,
      ] as const
    }),
  )

  return NextResponse.json(Object.fromEntries(entries))
}
