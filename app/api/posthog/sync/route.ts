import { NextResponse } from 'next/server'
import { isPostHogConfigured, syncAllClients } from '@/lib/posthog'
import { recordSync } from '@/lib/db'

// Vercel Hobby plan: 60s max. PostHog sync hits ~50 clients × ~10s each.
// Pro plan supports up to 300s. Increase if needed when upgraded.
export const maxDuration = 60

export async function POST() {
  if (!isPostHogConfigured()) {
    return NextResponse.json(
      { error: 'PostHog non configurato. Aggiungi POSTHOG_API_KEY e POSTHOG_PROJECT_ID in .env.local' },
      { status: 503 },
    )
  }

  const { synced, errors } = await syncAllClients(30)
  if (synced > 0) await recordSync('posthog', 'api', synced)
  return NextResponse.json({ synced, errors })
}
