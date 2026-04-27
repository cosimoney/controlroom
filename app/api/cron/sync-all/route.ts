/**
 * Cron endpoint — runs automatically via Vercel Cron Jobs.
 *
 * Strategy (fits in 60s Hobby timeout):
 * 1. Always: Monday sync (~10s) + Notion bugs sync (~15s)
 * 2. Rotating: PostHog sync for a batch of ~10 clients per run
 *    (cycles through all 55 clients over ~6 runs = 24h if cron runs every 4h)
 *
 * Auth: requires CRON_SECRET header to prevent unauthorized calls.
 */

import { NextResponse } from 'next/server'
import { db, recordSync } from '@/lib/db'
import { syncFromMondayApi, isMondayConfigured } from '@/lib/services/monday.service'
import { syncClientUsage, isPostHogConfigured } from '@/lib/posthog'

export const maxDuration = 60

const POSTHOG_BATCH_SIZE = 10

export async function GET(request: Request) {
  // Auth check
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Record<string, unknown> = {}
  const sql = await db()

  // ── 1. Monday sync ─────────────────────────────────────────────────
  if (isMondayConfigured()) {
    try {
      const mondayResult = await syncFromMondayApi()
      results.monday = { synced: mondayResult.synced, created: mondayResult.created, updated: mondayResult.updated }
    } catch (e) {
      results.monday = { error: String(e) }
    }
  }

  // ── 2. Notion bugs sync ────────────────────────────────────────────
  const notionToken = process.env.NOTION_TOKEN
  const notionDbId = process.env.NOTION_BUGS_DATABASE_ID
  if (notionToken && notionDbId) {
    try {
      const notionRes = await fetch(`${getBaseUrl(request)}/api/bugs/sync-notion`, {
        method: 'POST',
        headers: { cookie: request.headers.get('cookie') ?? '' },
      })
      if (notionRes.ok) {
        results.notion = await notionRes.json()
      } else {
        results.notion = { error: `${notionRes.status}` }
      }
    } catch (e) {
      results.notion = { error: String(e) }
    }
  }

  // ── 3. PostHog rotating batch ──────────────────────────────────────
  if (isPostHogConfigured()) {
    try {
      const allClients = await sql<{ client_code: string }[]>`
        SELECT client_code FROM clients
        WHERE client_code IS NOT NULL AND status = 'active'
        ORDER BY client_code
      `

      // Determine which batch to sync based on a rotating counter
      const [meta] = await sql<{ notes: string | null }[]>`
        SELECT notes FROM sync_metadata WHERE source = 'posthog'
      `
      const lastBatch = parseInt(meta?.notes?.match(/batch:(\d+)/)?.[1] ?? '-1')
      const totalBatches = Math.ceil(allClients.length / POSTHOG_BATCH_SIZE)
      const currentBatch = (lastBatch + 1) % totalBatches

      const start = currentBatch * POSTHOG_BATCH_SIZE
      const batchClients = allClients.slice(start, start + POSTHOG_BATCH_SIZE)

      let phSynced = 0
      const phErrors: string[] = []
      for (const { client_code } of batchClients) {
        try {
          await syncClientUsage(client_code, 30)
          phSynced++
        } catch (e) {
          phErrors.push(`${client_code}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      await recordSync('posthog', 'cron', phSynced, `batch:${currentBatch} of ${totalBatches}`)
      results.posthog = {
        batch: `${currentBatch + 1}/${totalBatches}`,
        clients: batchClients.map((c) => c.client_code),
        synced: phSynced,
        errors: phErrors,
      }
    } catch (e) {
      results.posthog = { error: String(e) }
    }
  }

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    results,
  })
}

function getBaseUrl(request: Request): string {
  const url = new URL(request.url)
  return `${url.protocol}//${url.host}`
}
