import { NextResponse } from 'next/server'
import { getDb, recordSync } from '@/lib/db'

const NOTION_VERSION = '2022-06-28'

interface NotionPage {
  id: string
  properties: Record<string, unknown>
  url: string
}

function getText(prop: unknown): string | null {
  if (!prop) return null
  const p = prop as Record<string, unknown>
  if (p.type === 'rich_text') {
    const rt = p.rich_text as Array<{ plain_text: string }>
    return rt?.map((t) => t.plain_text).join('') || null
  }
  if (p.type === 'title') {
    const title = p.title as Array<{ plain_text: string }>
    return title?.map((t) => t.plain_text).join('') || null
  }
  return null
}

function getSelect(prop: unknown): string | null {
  if (!prop) return null
  const p = prop as Record<string, unknown>
  const s = p.select as { name?: string } | null
  return s?.name ?? null
}

function getStatus(prop: unknown): string | null {
  if (!prop) return null
  const p = prop as Record<string, unknown>
  const s = p.status as { name?: string } | null
  return s?.name ?? null
}

function getDate(prop: unknown): string | null {
  if (!prop) return null
  const p = prop as Record<string, unknown>
  const d = p.date as { start?: string } | null
  return d?.start ?? null
}

function getMultiSelect(prop: unknown): string[] {
  if (!prop) return []
  const p = prop as Record<string, unknown>
  const ms = p.multi_select as Array<{ name: string }> | null
  return ms?.map((s) => s.name) ?? []
}

function getRelationText(prop: unknown): string | null {
  // Relations come back as list of IDs only — we store null for now
  // (would need extra API calls to resolve names)
  if (!prop) return null
  const p = prop as Record<string, unknown>
  const rel = p.relation as Array<{ id: string }> | null
  if (!rel?.length) return null
  return null // TODO: resolve in future iteration
}

function parseBug(page: NotionPage): Record<string, unknown> {
  const p = page.properties
  return {
    id: page.id,
    bug_title:    getText(p['Bug Title'])     ?? '(senza titolo)',
    status:       getStatus(p['Status'])      ?? null,
    priority:     getSelect(p['Priority'])    ?? null,
    modulo:       getSelect(p['Modulo'])      ?? null,
    tool:         getSelect(p['Tool'])        ?? null,
    reported_by:  getText(p['Reported By'])   ?? null,
    client_tier:  getText(p['Client Tier'])   ?? null,
    assigned_to:  getRelationText(p['Assigned To']),
    sprint:       getRelationText(p['Sprint']),
    date_reported: getDate(p['Date Reported']),
    due_date:      getDate(p['Due Date']),
    tags: JSON.stringify(getMultiSelect(p['Tags'])),
    description:  getText(p['Description'])  ?? null,
    notion_url:   `https://notion.so/${page.id.replace(/-/g, '')}`,
    source: 'api',
  }
}

export async function POST() {
  const token = process.env.NOTION_TOKEN
  const dbId  = process.env.NOTION_BUGS_DATABASE_ID

  if (!token || !dbId) {
    return NextResponse.json({ error: 'NOTION_TOKEN and NOTION_BUGS_DATABASE_ID not configured' }, { status: 400 })
  }

  const db = getDb()
  const pages: NotionPage[] = []

  // Paginated fetch — Notion returns max 100 per request
  let cursor: string | null = null
  let hasMore = true

  while (hasMore) {
    const body: Record<string, unknown> = {
      sorts: [
        { property: 'Priority', direction: 'ascending' },
        { property: 'Date Reported', direction: 'descending' },
      ],
      page_size: 100,
    }
    if (cursor) body.start_cursor = cursor

    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const err = await res.text()
      return NextResponse.json({ error: `Notion API error: ${res.status} ${err}` }, { status: 502 })
    }

    const data = await res.json() as { results: NotionPage[]; has_more: boolean; next_cursor: string | null }
    pages.push(...data.results)
    hasMore = data.has_more
    cursor = data.next_cursor
  }

  // Upsert into bugs table
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO bugs
      (id, bug_title, status, priority, modulo, tool, reported_by, client_tier,
       assigned_to, sprint, date_reported, due_date, tags, description, notion_url, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')
  `)

  let synced = 0
  const syncAll = db.transaction(() => {
    for (const page of pages) {
      const b = parseBug(page)
      upsert.run(
        b.id, b.bug_title, b.status, b.priority, b.modulo, b.tool,
        b.reported_by, b.client_tier, b.assigned_to, b.sprint,
        b.date_reported, b.due_date, b.tags, b.description, b.notion_url,
      )
      synced++
    }
  })
  syncAll()
  recordSync('notion', 'api', synced)

  return NextResponse.json({ synced, total: pages.length })
}
