import { NextResponse } from 'next/server'
import { db, recordSync } from '@/lib/db'

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

function parseDate(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null
  const d = new Date(raw.trim())
  if (isNaN(d.getTime())) return null
  return d.toISOString().split('T')[0]
}

export async function POST(request: Request) {
  const sql = await db()
  const body = await request.json()
  const { rows, overwrite } = body as {
    rows: Record<string, string>[]
    overwrite?: boolean
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'No rows provided' }, { status: 400 })
  }

  let imported = 0
  const errors: string[] = []

  await sql.begin(async (tsql) => {
    if (overwrite) {
      await tsql`DELETE FROM bugs WHERE source = 'csv'`
    }

    for (const row of rows) {
      const title = row.bug_title?.trim() || row['Bug Title']?.trim()
      if (!title) { errors.push(`Riga ignorata: bug_title mancante`); continue }

      const tagsRaw = row.tags ?? row['Tags'] ?? ''
      const tagsArr = tagsRaw ? tagsRaw.split(',').map((t: string) => t.trim()).filter(Boolean) : []

      const reportedBy = (row.reported_by ?? row['Reported By'] ?? '').trim() || null

      try {
        await tsql`
          INSERT INTO bugs
            (id, bug_title, status, priority, modulo, tool, reported_by, client_tier,
             assigned_to, sprint, date_reported, due_date, tags, description, notion_url, source)
          VALUES (
            ${uuid()},
            ${title},
            ${row.status ?? row['Status'] ?? null},
            ${row.priority ?? row['Priority'] ?? null},
            ${row.modulo ?? row['Modulo'] ?? null},
            ${row.tool ?? row['Tool'] ?? null},
            ${reportedBy},
            ${(row.client_tier ?? row['Client Tier'] ?? '').trim() || null},
            ${(row.assigned_to ?? row['Assigned To'] ?? '').trim() || null},
            ${(row.sprint ?? row['Sprint'] ?? '').trim() || null},
            ${parseDate(row.date_reported ?? row['Date Reported'])},
            ${parseDate(row.due_date ?? row['Due Date'])},
            ${JSON.stringify(tagsArr)},
            ${(row.description ?? row['Description'] ?? '').trim() || null},
            ${null},
            'csv'
          )
          ON CONFLICT (id) DO UPDATE SET
            bug_title     = EXCLUDED.bug_title,
            status        = EXCLUDED.status,
            priority      = EXCLUDED.priority,
            modulo        = EXCLUDED.modulo,
            tool          = EXCLUDED.tool,
            reported_by   = EXCLUDED.reported_by,
            client_tier   = EXCLUDED.client_tier,
            assigned_to   = EXCLUDED.assigned_to,
            sprint        = EXCLUDED.sprint,
            date_reported = EXCLUDED.date_reported,
            due_date      = EXCLUDED.due_date,
            tags          = EXCLUDED.tags,
            description   = EXCLUDED.description,
            source        = 'csv'
        `
        imported++
      } catch (e) {
        errors.push(`Errore su "${title}": ${String(e).slice(0, 100)}`)
      }
    }
  })

  await recordSync('notion', 'csv', imported)

  // Return breakdown by status
  const breakdown = await sql<{ status: string; cnt: number }[]>`
    SELECT status, COUNT(*)::int as cnt FROM bugs WHERE source = 'csv' GROUP BY status
  `

  return NextResponse.json({ imported, errors, breakdown })
}
