/**
 * Migrates touchpoints from local SQLite DB to Supabase Postgres.
 *
 * Strategy:
 *   1. Use the better-sqlite3 npm package via npx (no install needed)
 *   2. Read touchpoints + their associated client_code from the local SQLite
 *   3. Look up the client_id in Supabase by client_code (since IDs differ between DBs)
 *   4. Insert touchpoints with the new client_ids
 *
 * Run: node scripts/migrate-touchpoints.mjs
 */

import { spawnSync } from 'node:child_process'
import postgres from 'postgres'
import fs from 'node:fs'

const SQLITE_DB = 'data/csm.db'

if (!fs.existsSync(SQLITE_DB)) {
  console.error(`✗ SQLite DB not found at ${SQLITE_DB}`)
  process.exit(1)
}

// Read DATABASE_URL from .env.local
const env = fs.readFileSync('.env.local', 'utf8')
const url = env.match(/DATABASE_URL=(.+)/)[1].trim()

console.log('Step 1/4 — Extracting touchpoints from local SQLite...')

// Extract touchpoints joined with clients to get client_code
// Use sqlite3 CLI via npx — works without installing better-sqlite3
const sqliteOut = spawnSync('npx', ['--yes', 'sqlite3-readonly-bin', SQLITE_DB,
  `SELECT json_object(
     'date', t.date,
     'type', t.type,
     'notes', t.notes,
     'created_at', t.created_at,
     'client_code', c.client_code,
     'client_name', c.name
   ) FROM touchpoints t JOIN clients c ON c.id = t.client_id ORDER BY t.id`,
], { encoding: 'utf8', shell: true })

if (sqliteOut.status !== 0) {
  // Fallback: try using sqlite3 directly (might not be installed on Windows)
  console.log('npx sqlite3 not available, trying alternative method...')

  // Alternative: try via better-sqlite3 if it's still in node_modules cache
  let Database
  try {
    const mod = await import('better-sqlite3')
    Database = mod.default
  } catch {
    console.error('✗ Cannot read SQLite DB. Install better-sqlite3 temporarily:')
    console.error('  npm install --no-save better-sqlite3')
    console.error('  Then re-run this script.')
    process.exit(1)
  }

  const db = new Database(SQLITE_DB, { readonly: true })
  const rows = db.prepare(`
    SELECT t.date, t.type, t.notes, t.created_at, c.client_code, c.name AS client_name
    FROM touchpoints t
    JOIN clients c ON c.id = t.client_id
    ORDER BY t.id
  `).all()
  db.close()

  await migrate(rows)
} else {
  const rows = sqliteOut.stdout.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  await migrate(rows)
}

async function migrate(rows) {
  console.log(`  → Found ${rows.length} touchpoints`)

  if (rows.length === 0) {
    console.log('Nothing to migrate.')
    return
  }

  console.log('\nStep 2/4 — Connecting to Supabase...')
  const sql = postgres(url, { prepare: false, ssl: 'require', max: 1 })

  const supaClients = await sql`SELECT id, client_code, LOWER(TRIM(name)) AS lname FROM clients`
  const codeMap = new Map()
  const nameMap = new Map()
  for (const c of supaClients) {
    if (c.client_code) codeMap.set(c.client_code.toLowerCase(), c.id)
    nameMap.set(c.lname, c.id)
  }
  console.log(`  → Loaded ${supaClients.length} clients from Supabase`)

  console.log('\nStep 3/4 — Inserting touchpoints...')
  let inserted = 0, skipped = 0

  await sql.begin(async (tsql) => {
    for (const row of rows) {
      const code = row.client_code?.toLowerCase()?.trim()
      const name = row.client_name?.toLowerCase()?.trim()

      let supaClientId = code ? codeMap.get(code) : null
      if (!supaClientId && name) supaClientId = nameMap.get(name)

      if (!supaClientId) {
        skipped++
        continue
      }

      await tsql`
        INSERT INTO touchpoints (client_id, date, type, notes, created_at)
        VALUES (${supaClientId}, ${row.date}, ${row.type}, ${row.notes ?? null}, ${row.created_at})
      `
      inserted++
    }
  })

  console.log(`  → Inserted: ${inserted}`)
  console.log(`  → Skipped (no matching client): ${skipped}`)

  console.log('\nStep 4/4 — Verifying...')
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM touchpoints`
  console.log(`  → Total touchpoints in Supabase now: ${count}`)

  await sql.end()
  console.log('\n✓ Migration complete')
}
