// Apply schema migrations to Supabase — mirrors lib/db.ts runMigrations()
import postgres from 'postgres'
import fs from 'fs'

const env = fs.readFileSync('.env.local', 'utf8')
const url = env.match(/DATABASE_URL=(.+)/)[1].trim()
const sql = postgres(url, { prepare: false, ssl: 'require', max: 1, connect_timeout: 15 })

console.log('Connecting to Supabase...')

try {
  // ── Base tables ────────────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS clients (
      id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name            TEXT NOT NULL,
      company         TEXT,
      pm_assigned     TEXT,
      contract_type   TEXT,
      modules_active  TEXT,
      market          TEXT,
      status          TEXT DEFAULT 'active',
      notes           TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS touchpoints (
      id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      client_id   BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      date        DATE NOT NULL,
      type        TEXT NOT NULL,
      notes       TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `

  // ── Migration 1 ────────────────────────────────────────────────────
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_code TEXT`
  await sql`CREATE INDEX IF NOT EXISTS idx_clients_client_code ON clients(client_code)`

  // ── Migration 2: bugs ──────────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS bugs (
      id            TEXT PRIMARY KEY,
      bug_title     TEXT NOT NULL,
      status        TEXT, priority      TEXT, modulo        TEXT, tool          TEXT,
      reported_by   TEXT, client_tier   TEXT, assigned_to   TEXT, sprint        TEXT,
      date_reported TEXT, due_date      TEXT, tags          TEXT, description   TEXT,
      notion_url    TEXT, source        TEXT DEFAULT 'csv',
      imported_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_bugs_reported_by ON bugs(reported_by)`
  await sql`CREATE INDEX IF NOT EXISTS idx_bugs_status ON bugs(status)`

  // ── Migration 3: PostHog cache ─────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS posthog_usage_cache (
      client_code    TEXT NOT NULL,
      metric_type    TEXT NOT NULL,
      user_type      TEXT NOT NULL,
      value          TEXT NOT NULL,
      period_days    INTEGER DEFAULT 30,
      last_synced_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (client_code, metric_type, user_type, period_days)
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_phcache_code ON posthog_usage_cache(client_code)`

  // ── Migration 4: tier ──────────────────────────────────────────────
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS tier INTEGER DEFAULT 3`

  // ── Migration 5: Monday columns ────────────────────────────────────
  const mondayCols = [
    ['prio', 'TEXT'], ['monday_health', 'TEXT'], ['potential_churn', 'TEXT'],
    ['contract_item', 'TEXT'], ['is_renew', 'TEXT'], ['is_closed', 'TEXT'],
    ['is_churn', 'TEXT'], ['total_contract_value', 'DOUBLE PRECISION'],
    ['products', 'TEXT'], ['upsell', 'TEXT'], ['opportunity_win_date', 'TEXT'],
    ['service_start', 'TEXT'], ['service_end', 'TEXT'],
    ['setup_fee', 'DOUBLE PRECISION'], ['arr', 'DOUBLE PRECISION'],
    ['client_type', 'TEXT'], ['country', 'TEXT'],
    ['general_tiering', 'TEXT'], ['adv_tiering', 'TEXT'],
    ['client_manager', 'TEXT'], ['am_owner', 'TEXT'], ['adv_owner', 'TEXT'],
    ['s_home', 'DOUBLE PRECISION DEFAULT 0'], ['s_quickwins', 'DOUBLE PRECISION DEFAULT 0'],
    ['s_sales', 'DOUBLE PRECISION DEFAULT 0'], ['s_media', 'DOUBLE PRECISION DEFAULT 0'],
    ['s_sell_in', 'DOUBLE PRECISION DEFAULT 0'], ['s_products', 'DOUBLE PRECISION DEFAULT 0'],
    ['s_category', 'DOUBLE PRECISION DEFAULT 0'], ['s_amc', 'DOUBLE PRECISION DEFAULT 0'],
    ['s_seller', 'DOUBLE PRECISION DEFAULT 0'],
  ]
  for (const [col, type] of mondayCols) {
    await sql.unsafe(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS ${col} ${type}`)
  }

  // ── Migration 5b: monday_sync_log ──────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS monday_sync_log (
      id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      sync_type       TEXT NOT NULL,
      records_synced  INTEGER DEFAULT 0,
      records_created INTEGER DEFAULT 0,
      records_updated INTEGER DEFAULT 0,
      synced_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `

  // ── Migration 6: sync_metadata ─────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS sync_metadata (
      source       TEXT PRIMARY KEY,
      sync_type    TEXT,
      last_sync_at TIMESTAMPTZ,
      records      INTEGER,
      notes        TEXT
    )
  `

  // ── Migration 7: Clerk tables ──────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS clerk_organizations (
      id                TEXT PRIMARY KEY,
      slug              TEXT, name              TEXT,
      modules_enabled   TEXT, raw_metadata      TEXT, currencies        TEXT,
      total_members     INTEGER DEFAULT 0,
      internal_members  INTEGER DEFAULT 0,
      external_members  INTEGER DEFAULT 0,
      last_synced_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_clerk_orgs_slug ON clerk_organizations(slug) WHERE slug IS NOT NULL`
  await sql`
    CREATE TABLE IF NOT EXISTS clerk_users (
      id              TEXT PRIMARY KEY,
      org_id          TEXT, org_slug        TEXT,
      email           TEXT, first_name      TEXT, last_name       TEXT,
      role            TEXT, is_internal     INTEGER DEFAULT 0,
      last_sign_in_at TIMESTAMPTZ, created_at      TIMESTAMPTZ,
      last_synced_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_clerk_users_org_id ON clerk_users(org_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_clerk_users_org_slug ON clerk_users(org_slug)`
  await sql`CREATE INDEX IF NOT EXISTS idx_clerk_users_email ON clerk_users(email)`

  // ── Migration 8: feedback_transcripts ──────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS feedback_transcripts (
      notion_page_id      TEXT PRIMARY KEY,
      client_code         TEXT, client_name         TEXT,
      session_id          TEXT, session_date        TEXT,
      status              TEXT, products            TEXT,
      transcript_text     TEXT, transcript_summary  TEXT,
      last_edited_time    TEXT,
      imported_at         TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_transcripts_client ON feedback_transcripts(client_code)`
  await sql`CREATE INDEX IF NOT EXISTS idx_transcripts_date ON feedback_transcripts(session_date)`

  console.log('✓ All migrations applied')

  const tables = await sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `
  console.log(`\n✓ Tables (${tables.length}):`)
  for (const t of tables) console.log('  -', t.tablename)

  await sql.end()
} catch (e) {
  console.error('✗ FAIL:', e.message)
  console.error(e)
  process.exit(1)
}
