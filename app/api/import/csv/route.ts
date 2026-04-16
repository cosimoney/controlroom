import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(request: Request) {
  const sql = await db()
  const body = await request.json()
  const { rows } = body as { rows: Record<string, string>[] }

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'No rows provided' }, { status: 400 })
  }

  let imported = 0
  const errors: string[] = []

  await sql.begin(async (tsql) => {
    for (const row of rows) {
      if (!row.name?.trim()) {
        errors.push(`Skipped row: missing name`)
        continue
      }
      try {
        const modulesRaw = row.modules_active
        let modulesJson: string | null = null
        if (modulesRaw) {
          const arr = modulesRaw.split(',').map((s) => s.trim()).filter(Boolean)
          modulesJson = JSON.stringify(arr)
        }
        await tsql`
          INSERT INTO clients (name, company, pm_assigned, contract_type, modules_active, market, status, notes)
          VALUES (
            ${row.name.trim()},
            ${row.company || null},
            ${row.pm_assigned || null},
            ${row.contract_type || null},
            ${modulesJson},
            ${row.market || null},
            ${['active', 'churned', 'onboarding', 'paused'].includes(row.status) ? row.status : 'active'},
            ${row.notes || null}
          )
        `
        imported++
      } catch (e) {
        errors.push(`Error on row "${row.name}": ${e}`)
      }
    }
  })

  return NextResponse.json({ imported, errors })
}
