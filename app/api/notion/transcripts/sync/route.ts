import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { getDb, recordSync } from '@/lib/db'

const NOTION_VERSION = '2022-06-28'
const LOOKBACK_MONTHS = 6
const SUMMARY_MODEL = 'claude-sonnet-4-6'
const SUMMARY_MAX_INPUT_CHARS = 60000 // Claude can handle more, but this caps costs for very long transcripts

interface NotionPage {
  id: string
  last_edited_time: string
  properties: Record<string, unknown>
}

interface NotionBlock {
  type: string
  paragraph?: { rich_text: Array<{ plain_text: string }> }
  heading_1?: { rich_text: Array<{ plain_text: string }> }
  heading_2?: { rich_text: Array<{ plain_text: string }> }
  heading_3?: { rich_text: Array<{ plain_text: string }> }
  bulleted_list_item?: { rich_text: Array<{ plain_text: string }> }
  numbered_list_item?: { rich_text: Array<{ plain_text: string }> }
  to_do?: { rich_text: Array<{ plain_text: string }> }
  quote?: { rich_text: Array<{ plain_text: string }> }
  has_children?: boolean
  id?: string
}

// ─── Property extractors ────────────────────────────────────────────

function getTitle(prop: unknown): string | null {
  const p = prop as { title?: Array<{ plain_text: string }> }
  return p?.title?.map((t) => t.plain_text).join('') || null
}

function getRichText(prop: unknown): string | null {
  const p = prop as { rich_text?: Array<{ plain_text: string }> }
  return p?.rich_text?.map((t) => t.plain_text).join('') || null
}

function getDate(prop: unknown): string | null {
  const p = prop as { date?: { start?: string } }
  return p?.date?.start ?? null
}

function getSelect(prop: unknown): string | null {
  const p = prop as { select?: { name?: string } }
  return p?.select?.name ?? null
}

function getStatus(prop: unknown): string | null {
  const p = prop as { status?: { name?: string } }
  return p?.status?.name ?? null
}

function getMultiSelectJoined(prop: unknown): string | null {
  const p = prop as { multi_select?: Array<{ name: string }> }
  if (!p?.multi_select?.length) return null
  return p.multi_select.map((m) => m.name).join(', ')
}

// ─── Notion API helpers ─────────────────────────────────────────────

async function notionFetch(url: string, token: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Notion ${res.status}: ${err}`)
  }
  return res.json() as Promise<Record<string, unknown>>
}

/** Fetch all blocks of a page recursively and return the text content. */
async function fetchPageText(pageId: string, token: string): Promise<string> {
  const lines: string[] = []
  let cursor: string | null = null
  let hasMore = true

  while (hasMore) {
    const url = `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`
    const data = await notionFetch(url, token) as { results: NotionBlock[]; has_more: boolean; next_cursor: string | null }

    for (const block of data.results) {
      const text = blockToText(block)
      if (text) lines.push(text)
    }

    hasMore = data.has_more
    cursor = data.next_cursor
  }

  return lines.join('\n').trim()
}

// ─── Summary generation via Claude ──────────────────────────────────

const SUMMARY_SYSTEM_PROMPT = `Sei un analista di Customer Success che riassume transcript di feedback session con clienti B2B SaaS (Witailer Studio — analytics per brand su Amazon).

Produci un riassunto strutturato in italiano con queste sezioni, in Markdown:

## Partecipanti
Nomi e ruoli/aziende se deducibili.

## Argomenti discussi
Bullet list dei topic principali toccati, con breve contesto per ogni topic.

## Criticità e problemi emersi
Bullet list di bug, dubbi, obiezioni o blocchi menzionati. Cita il modulo/feature se specificato.

## Richieste e aspettative
Cose che il cliente ha chiesto o si aspetta di ricevere.

## Action items
Bullet list di impegni presi — chi deve fare cosa, entro quando se specificato.

## Sentiment generale
Una frase sulla percezione del cliente (positivo, neutro, preoccupato, insoddisfatto, ecc.) con motivazione.

## Citazioni chiave
2-4 citazioni testuali brevi e significative, con nome di chi ha parlato.

Regole:
- Sii conciso ma completo. Target: 400-800 parole totali.
- NON inventare informazioni non presenti nel transcript.
- Se una sezione non ha contenuto, scrivi "Nessun elemento rilevante" invece di saltarla.
- Mantieni il tono professionale e fattuale.`

async function generateSummary(transcript: string, anthropic: Anthropic): Promise<string | null> {
  const truncated = transcript.length > SUMMARY_MAX_INPUT_CHARS
    ? transcript.slice(0, SUMMARY_MAX_INPUT_CHARS) + '\n\n[... transcript troncato per lunghezza ...]'
    : transcript

  try {
    const response = await anthropic.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: 1500,
      system: [
        {
          type: 'text',
          text: SUMMARY_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: `Transcript della sessione:\n\n${truncated}` }],
    })
    return response.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { text: string }).text)
      .join('\n')
  } catch (e) {
    console.error('Summary generation failed:', e)
    return null
  }
}

function blockToText(block: NotionBlock): string | null {
  const rt =
    block.paragraph?.rich_text ??
    block.heading_1?.rich_text ??
    block.heading_2?.rich_text ??
    block.heading_3?.rich_text ??
    block.bulleted_list_item?.rich_text ??
    block.numbered_list_item?.rich_text ??
    block.to_do?.rich_text ??
    block.quote?.rich_text ??
    null
  if (!rt) return null
  const text = rt.map((t) => t.plain_text).join('')
  return text.length > 0 ? text : null
}

// ─── Main handler ───────────────────────────────────────────────────

export async function POST() {
  const token = process.env.NOTION_TOKEN
  const dbId = process.env.NOTION_TRANSCRIPTS_DATABASE_ID

  if (!token || !dbId) {
    return NextResponse.json(
      { error: 'NOTION_TOKEN and NOTION_TRANSCRIPTS_DATABASE_ID not configured' },
      { status: 400 },
    )
  }

  const db = getDb()

  // Filter: only last 6 months
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - LOOKBACK_MONTHS)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  // Existing transcripts → delta sync via last_edited_time
  const existingRows = db.prepare(
    'SELECT notion_page_id, last_edited_time FROM feedback_transcripts',
  ).all() as { notion_page_id: string; last_edited_time: string }[]
  const existingMap = new Map(existingRows.map((r) => [r.notion_page_id, r.last_edited_time]))

  // Paginated query of the Notion database
  const allPages: NotionPage[] = []
  let cursor: string | null = null
  let hasMore = true

  try {
    while (hasMore) {
      const body: Record<string, unknown> = {
        filter: { property: 'Date', date: { on_or_after: cutoffStr } },
        sorts: [{ property: 'Date', direction: 'descending' }],
        page_size: 100,
      }
      if (cursor) body.start_cursor = cursor

      const data = (await notionFetch(
        `https://api.notion.com/v1/databases/${dbId}/query`,
        token,
        body,
      )) as { results: NotionPage[]; has_more: boolean; next_cursor: string | null }

      allPages.push(...data.results)
      hasMore = data.has_more
      cursor = data.next_cursor
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }

  // Determine which pages need body re-fetch (new or updated)
  const toFetch = allPages.filter((p) => {
    const existing = existingMap.get(p.id)
    return !existing || existing !== p.last_edited_time
  })

  // Fetch page bodies sequentially to avoid hammering the API
  const fetchedTexts = new Map<string, string>()
  for (const page of toFetch) {
    try {
      const text = await fetchPageText(page.id, token)
      fetchedTexts.set(page.id, text)
    } catch (e) {
      console.error(`Failed to fetch blocks for ${page.id}:`, e)
    }
  }

  // Generate summaries for refreshed transcripts via Claude
  // Only if ANTHROPIC_API_KEY is set — otherwise skip gracefully
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const fetchedSummaries = new Map<string, string>()
  let summaryErrors = 0

  if (anthropicKey && fetchedTexts.size > 0) {
    const anthropic = new Anthropic({ apiKey: anthropicKey })
    for (const [pageId, text] of fetchedTexts) {
      if (!text || text.length < 200) continue // skip empty/very short transcripts
      const summary = await generateSummary(text, anthropic)
      if (summary) {
        fetchedSummaries.set(pageId, summary)
      } else {
        summaryErrors++
      }
    }
  }

  // Preload existing rows to keep transcript_text/summary when not refetched
  const existingRowsDetail = db.prepare(
    'SELECT notion_page_id, transcript_text, transcript_summary FROM feedback_transcripts',
  ).all() as { notion_page_id: string; transcript_text: string | null; transcript_summary: string | null }[]
  const existingDetailMap = new Map(
    existingRowsDetail.map((r) => [r.notion_page_id, { text: r.transcript_text, summary: r.transcript_summary }]),
  )

  // Upsert all pages
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO feedback_transcripts
      (notion_page_id, client_code, client_name, session_id, session_date,
       status, products, transcript_text, transcript_summary, last_edited_time, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `)

  let synced = 0
  let refreshed = 0
  let summarized = 0

  const tx = db.transaction(() => {
    for (const page of allPages) {
      const props = page.properties
      const clientName = getTitle(props['Client'])
      const clientCode = getRichText(props['Client ID'])
      const sessionId = getRichText(props['Session ID'])
      const sessionDate = getDate(props['Date'])
      const status = getStatus(props['Status']) ?? getSelect(props['Status'])
      const products = getMultiSelectJoined(props['Products']) ?? getSelect(props['Products'])

      const fetchedText = fetchedTexts.get(page.id)
      const fetchedSummary = fetchedSummaries.get(page.id)
      const existing = existingDetailMap.get(page.id)

      const finalText = fetchedText !== undefined ? fetchedText : (existing?.text ?? null)
      const finalSummary = fetchedSummary !== undefined ? fetchedSummary : (existing?.summary ?? null)

      if (fetchedText !== undefined) refreshed++
      if (fetchedSummary !== undefined) summarized++

      upsert.run(
        page.id,
        clientCode?.toUpperCase() ?? null,
        clientName,
        sessionId,
        sessionDate,
        status,
        products,
        finalText,
        finalSummary,
        page.last_edited_time,
      )
      synced++
    }
  })
  tx()

  recordSync('notion', 'transcripts', synced, `${refreshed} refreshed, ${summarized} summarized`)

  return NextResponse.json({
    total: allPages.length,
    synced,
    body_refreshed: refreshed,
    summarized,
    summary_errors: summaryErrors,
    cutoff: cutoffStr,
  })
}
