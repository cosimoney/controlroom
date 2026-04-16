import postgres from 'postgres'
import fs from 'fs'

const env = fs.readFileSync('.env.local', 'utf8')
const url = env.match(/DATABASE_URL=(.+)/)[1].trim()

console.log('Connecting to:', url.replace(/:[^:@]+@/, ':***@'))

const sql = postgres(url, { prepare: false, ssl: 'require', max: 1, connect_timeout: 15 })

try {
  const [{ now }] = await sql`SELECT NOW()::text AS now`
  console.log('✓ Connection OK — server time:', now)

  const [{ ver }] = await sql`SELECT version() AS ver`
  console.log('✓ Postgres version:', ver.slice(0, 80))

  // List existing tables in public schema
  const tables = await sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `
  console.log(`\n✓ Existing tables (${tables.length}):`)
  for (const t of tables) console.log('  -', t.tablename)

  await sql.end()
} catch (e) {
  console.error('✗ FAIL:', e.message)
  console.error(e)
  process.exit(1)
}
