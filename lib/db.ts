/**
 * lib/db-pg.ts — Postgres (Supabase) database layer
 *
 * Uses postgres.js (tagged template literals, async) to replace better-sqlite3.
 * All queries are written as raw SQL via `await sql\`...\``.
 *
 * Connection: Supabase transaction pooler (port 6543) for serverless compatibility.
 * Set DATABASE_URL in env: postgresql://postgres.xxx:password@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
 */

import postgresLib from 'postgres'

declare global {
  // eslint-disable-next-line no-var
  var __sql: ReturnType<typeof postgresLib> | undefined
  // eslint-disable-next-line no-var
  var __schemaReady: Promise<void> | undefined
}

function createClient() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set. Expected a Supabase pooler connection string.')
  }
  return postgresLib(url, {
    // Supabase transaction pooler requires prepare: false
    prepare: false,
    // Reasonable serverless defaults
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    // Allow SSL in production (Supabase enforces it)
    ssl: 'require',
  })
}

/**
 * Returns the shared postgres client (tagged template function).
 * Lazily initializes on first call and runs schema migrations once.
 *
 * Usage:
 *   const sql = getSql()
 *   const rows = await sql`SELECT * FROM clients WHERE id = ${id}`
 */
export function getSql() {
  if (!global.__sql) {
    global.__sql = createClient()
  }
  return global.__sql
}

/**
 * Ensures the schema migrations have run. Call this at the top of any API route
 * that touches the DB, or wrap with `await ensureSchema()` before queries.
 *
 * Idempotent: subsequent calls return the cached promise.
 */
export function ensureSchema(): Promise<void> {
  if (!global.__schemaReady) {
    global.__schemaReady = runMigrations().catch((err) => {
      // Reset so a retry can re-attempt on next request
      global.__schemaReady = undefined
      throw err
    })
  }
  return global.__schemaReady
}

/**
 * Convenience export: a wrapper that ensures schema before running any query.
 * Use this in API routes: `const sql = await db()`
 */
export async function db() {
  await ensureSchema()
  return getSql()
}

// ─────────────────────────── MIGRATIONS ────────────────────────────

async function runMigrations(): Promise<void> {
  const sql = getSql()

  // ── Base tables (clients + touchpoints) ────────────────────────────
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

  // ── Migration 1: client_code column + non-unique index ─────────────
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_code TEXT`
  await sql`CREATE INDEX IF NOT EXISTS idx_clients_client_code ON clients(client_code)`

  // ── Migration 2: bugs table ────────────────────────────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS bugs (
      id            TEXT PRIMARY KEY,
      bug_title     TEXT NOT NULL,
      status        TEXT,
      priority      TEXT,
      modulo        TEXT,
      tool          TEXT,
      reported_by   TEXT,
      client_tier   TEXT,
      assigned_to   TEXT,
      sprint        TEXT,
      date_reported TEXT,
      due_date      TEXT,
      tags          TEXT,
      description   TEXT,
      notion_url    TEXT,
      source        TEXT DEFAULT 'csv',
      imported_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_bugs_reported_by ON bugs(reported_by)`
  await sql`CREATE INDEX IF NOT EXISTS idx_bugs_status ON bugs(status)`

  // ── Migration 3: PostHog usage cache ───────────────────────────────
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

  // ── Migration 4: tier column on clients ────────────────────────────
  await sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS tier INTEGER DEFAULT 3`

  // ── Migration 5: Monday integration columns ────────────────────────
  // Add all Monday columns idempotently
  const mondayCols: [string, string][] = [
    ['prio', 'TEXT'],
    ['monday_health', 'TEXT'],
    ['potential_churn', 'TEXT'],
    ['contract_item', 'TEXT'],
    ['is_renew', 'TEXT'],
    ['is_closed', 'TEXT'],
    ['is_churn', 'TEXT'],
    ['total_contract_value', 'DOUBLE PRECISION'],
    ['products', 'TEXT'],
    ['upsell', 'TEXT'],
    ['opportunity_win_date', 'TEXT'],
    ['service_start', 'TEXT'],
    ['service_end', 'TEXT'],
    ['setup_fee', 'DOUBLE PRECISION'],
    ['arr', 'DOUBLE PRECISION'],
    ['client_type', 'TEXT'],
    ['country', 'TEXT'],
    ['general_tiering', 'TEXT'],
    ['adv_tiering', 'TEXT'],
    ['client_manager', 'TEXT'],
    ['am_owner', 'TEXT'],
    ['adv_owner', 'TEXT'],
    ['s_home', 'DOUBLE PRECISION DEFAULT 0'],
    ['s_quickwins', 'DOUBLE PRECISION DEFAULT 0'],
    ['s_sales', 'DOUBLE PRECISION DEFAULT 0'],
    ['s_media', 'DOUBLE PRECISION DEFAULT 0'],
    ['s_sell_in', 'DOUBLE PRECISION DEFAULT 0'],
    ['s_products', 'DOUBLE PRECISION DEFAULT 0'],
    ['s_category', 'DOUBLE PRECISION DEFAULT 0'],
    ['s_amc', 'DOUBLE PRECISION DEFAULT 0'],
    ['s_seller', 'DOUBLE PRECISION DEFAULT 0'],
  ]
  for (const [col, type] of mondayCols) {
    // `sql.unsafe` is required because column names/types can't be parameterized
    await sql.unsafe(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS ${col} ${type}`)
  }

  // ── Migration 5b: Monday sync log ──────────────────────────────────
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

  // ── Migration 6: sync_metadata (unified sync timestamps) ───────────
  await sql`
    CREATE TABLE IF NOT EXISTS sync_metadata (
      source       TEXT PRIMARY KEY,
      sync_type    TEXT,
      last_sync_at TIMESTAMPTZ,
      records      INTEGER,
      notes        TEXT
    )
  `

  // ── Migration 7: Clerk organizations + users cache ─────────────────
  await sql`
    CREATE TABLE IF NOT EXISTS clerk_organizations (
      id                TEXT PRIMARY KEY,
      slug              TEXT,
      name              TEXT,
      modules_enabled   TEXT,
      raw_metadata      TEXT,
      currencies        TEXT,
      total_members     INTEGER DEFAULT 0,
      internal_members  INTEGER DEFAULT 0,
      external_members  INTEGER DEFAULT 0,
      last_synced_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_clerk_orgs_slug
      ON clerk_organizations(slug) WHERE slug IS NOT NULL
  `

  await sql`
    CREATE TABLE IF NOT EXISTS clerk_users (
      id              TEXT PRIMARY KEY,
      org_id          TEXT,
      org_slug        TEXT,
      email           TEXT,
      first_name      TEXT,
      last_name       TEXT,
      role            TEXT,
      is_internal     INTEGER DEFAULT 0,
      last_sign_in_at TIMESTAMPTZ,
      created_at      TIMESTAMPTZ,
      last_synced_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_clerk_users_org_id ON clerk_users(org_id)`
  await sql`CREATE INDEX IF NOT EXISTS idx_clerk_users_org_slug ON clerk_users(org_slug)`
  await sql`CREATE INDEX IF NOT EXISTS idx_clerk_users_email ON clerk_users(email)`

  // ── Migration 8: Feedback session transcripts from Notion ──────────
  await sql`
    CREATE TABLE IF NOT EXISTS feedback_transcripts (
      notion_page_id      TEXT PRIMARY KEY,
      client_code         TEXT,
      client_name         TEXT,
      session_id          TEXT,
      session_date        TEXT,
      status              TEXT,
      products            TEXT,
      transcript_text     TEXT,
      transcript_summary  TEXT,
      last_edited_time    TEXT,
      imported_at         TIMESTAMPTZ DEFAULT NOW()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_transcripts_client ON feedback_transcripts(client_code)`
  await sql`CREATE INDEX IF NOT EXISTS idx_transcripts_date ON feedback_transcripts(session_date)`
}

// ─────────────────────────── SYNC METADATA HELPERS ────────────────────

export async function recordSync(
  source: 'monday' | 'notion' | 'posthog' | 'clerk',
  syncType: string,
  records: number,
  notes?: string,
): Promise<void> {
  const sql = await db()
  await sql`
    INSERT INTO sync_metadata (source, sync_type, last_sync_at, records, notes)
    VALUES (${source}, ${syncType}, NOW(), ${records}, ${notes ?? null})
    ON CONFLICT (source) DO UPDATE SET
      sync_type    = EXCLUDED.sync_type,
      last_sync_at = EXCLUDED.last_sync_at,
      records      = EXCLUDED.records,
      notes        = EXCLUDED.notes
  `
}

export async function getSyncMetadata(
  source: 'monday' | 'notion' | 'posthog' | 'clerk',
): Promise<{ last_sync_at: string | null; records: number | null; sync_type: string | null }> {
  const sql = await db()
  const rows = await sql<
    { last_sync_at: string | null; records: number | null; sync_type: string | null }[]
  >`SELECT last_sync_at, records, sync_type FROM sync_metadata WHERE source = ${source}`
  return rows[0] ?? { last_sync_at: null, records: null, sync_type: null }
}
