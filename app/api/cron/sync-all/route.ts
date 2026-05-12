/**
 * Cron endpoint — runs automatically via Vercel Cron Jobs.
 *
 * Strategy (fits in 60s Hobby timeout):
 * 1. Always: Monday sync (~10s) + Notion bugs sync (~15s)
 * 2. FIFO: PostHog sync for the 10 clients with the oldest cache (or never synced).
 *    Self-balancing — no rotating counter needed; the oldest naturally rise to the
 *    top each run. With ~55 clients and daily cron, full coverage in ~6 days.
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

  // ── 3. PostHog FIFO batch (oldest cache first) ─────────────────────
  if (isPostHogConfigured()) {
    try {
      // Pick the 10 active clients whose 30-day summary cache is oldest
      // (or null = never synced — those go to the top via NULLS FIRST).
      const batchClients = await sql<{ client_code: string; last_synced_at: string | null }[]>`
        SELECT
          c.client_code,
          pc.last_synced_at::text AS last_synced_at
        FROM clients c
        LEFT JOIN posthog_usage_cache pc
          ON pc.client_code = c.client_code
          AND pc.metric_type = 'summary'
          AND pc.user_type = 'all'
          AND pc.period_days = 30
        WHERE c.client_code IS NOT NULL AND c.status = 'active'
        ORDER BY pc.last_synced_at ASC NULLS FIRST
        LIMIT ${POSTHOG_BATCH_SIZE}
      `

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

      await recordSync('posthog', 'cron', phSynced, 'fifo')
      results.posthog = {
        strategy: 'fifo',
        clients: batchClients.map((c) => ({
          code: c.client_code,
          cache_age_h: c.last_synced_at
            ? Math.round((Date.now() - new Date(c.last_synced_at).getTime()) / 3600000)
            : null,
        })),
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
