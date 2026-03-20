import { NextResponse } from 'next/server'
import { isPostHogConfigured, syncAllClients } from '@/lib/posthog'
import { recordSync } from '@/lib/db'

export async function POST() {
  if (!isPostHogConfigured()) {
    return NextResponse.json(
      { error: 'PostHog non configurato. Aggiungi POSTHOG_API_KEY e POSTHOG_PROJECT_ID in .env.local' },
      { status: 503 },
    )
  }

  const { synced, errors } = await syncAllClients(30)
  if (synced > 0) recordSync('posthog', 'api', synced)
  return NextResponse.json({ synced, errors })
}
