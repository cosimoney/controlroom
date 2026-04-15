import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = path.join(process.cwd(), 'data', 'csm.db')

declare global {
  // eslint-disable-next-line no-var
  var __db: Database.Database | undefined
}

export function getDb(): Database.Database {
  if (!global.__db) {
    const dataDir = path.dirname(DB_PATH)
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })

    global.__db = new Database(DB_PATH)
    global.__db.pragma('journal_mode = WAL')
    global.__db.pragma('foreign_keys = ON')
    initializeSchema(global.__db)
  }
  return global.__db
}

function initializeSchema(db: Database.Database) {
  // Base schema — intentionally WITHOUT client_code so existing DBs are safe
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company TEXT,
      pm_assigned TEXT,
      contract_type TEXT,
      modules_active TEXT,
      market TEXT,
      status TEXT DEFAULT 'active',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS touchpoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      date DATE NOT NULL,
      type TEXT NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );
  `)

  // Run incremental migrations
  runMigrations(db)

  // Seed disabled — use Monday CSV import to populate clients
}

// ─────────────────────────── MIGRATIONS ────────────────────────────

function runMigrations(db: Database.Database) {
  // Migration 1: Add client_code to clients
  const cols = (db.prepare('PRAGMA table_info(clients)').all() as { name: string }[]).map((c) => c.name)
  if (!cols.includes('client_code')) {
    db.exec('ALTER TABLE clients ADD COLUMN client_code TEXT')
    // Non-unique index: multiple rows can share the same client_code (e.g. De'Longhi + De'Longhi_US)
    db.exec('DROP INDEX IF EXISTS idx_clients_client_code')
    db.exec('CREATE INDEX IF NOT EXISTS idx_clients_client_code ON clients(client_code)')
    // If migrating an existing Phase-1 DB, populate known seed codes
    const existing = db.prepare('SELECT id, name FROM clients').all() as { id: number; name: string }[]
    if (existing.length > 0) {
      const codeMap: Record<string, string> = {
        'Barilla': 'BARIL', 'Lavazza': 'LAVAZ', "De'Longhi": 'DLONG',
        'Ferrero': 'FERRE', 'Bialetti': 'BIALE', 'Mulino Bianco': 'MULIN',
        'Parmigiano Reggiano': 'PARMI', 'Illy': 'ILLY', 'Chicco': 'CHICCO',
        'Granarolo': 'GRANA',
      }
      const upd = db.prepare('UPDATE clients SET client_code = ? WHERE id = ?')
      for (const c of existing) { if (codeMap[c.name]) upd.run(codeMap[c.name], c.id) }
    }
  }

  // Migration 2: Create bugs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS bugs (
      id TEXT PRIMARY KEY,
      bug_title TEXT NOT NULL,
      status TEXT,
      priority TEXT,
      modulo TEXT,
      tool TEXT,
      reported_by TEXT,
      client_tier TEXT,
      assigned_to TEXT,
      sprint TEXT,
      date_reported TEXT,
      due_date TEXT,
      tags TEXT,
      description TEXT,
      notion_url TEXT,
      source TEXT DEFAULT 'csv',
      imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_bugs_reported_by ON bugs(reported_by);
    CREATE INDEX IF NOT EXISTS idx_bugs_status ON bugs(status);
  `)

  // Migration 3: PostHog usage cache
  db.exec(`
    CREATE TABLE IF NOT EXISTS posthog_usage_cache (
      client_code  TEXT    NOT NULL,
      metric_type  TEXT    NOT NULL,
      user_type    TEXT    NOT NULL,
      value        TEXT    NOT NULL,
      period_days  INTEGER DEFAULT 30,
      last_synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (client_code, metric_type, user_type, period_days)
    );
    CREATE INDEX IF NOT EXISTS idx_phcache_code ON posthog_usage_cache(client_code);
  `)

  // Migration 4: Add tier to clients
  const clientCols4 = (db.prepare('PRAGMA table_info(clients)').all() as { name: string }[]).map((c) => c.name)
  if (!clientCols4.includes('tier')) {
    db.exec('ALTER TABLE clients ADD COLUMN tier INTEGER DEFAULT 3')
    const tierMap: Record<string, number> = {
      'BARIL': 1, 'LAVAZ': 1, 'FERRE': 1,
      'DLONG': 2, 'MULIN': 2, 'PARMI': 2, 'ILLY': 2, 'GRANA': 2,
      'BIALE': 3, 'CHICCO': 3,
    }
    const upd = db.prepare('UPDATE clients SET tier = ? WHERE client_code = ?')
    for (const [code, tier] of Object.entries(tierMap)) upd.run(tier, code)
  }

  // Migration 5: Monday integration columns
  const clientCols5 = (db.prepare('PRAGMA table_info(clients)').all() as { name: string }[]).map((c) => c.name)
  const monday5Cols: [string, string][] = [
    ['prio',                  'TEXT'],
    ['monday_health',         'TEXT'],
    ['potential_churn',       'TEXT'],
    ['contract_item',         'TEXT'],
    ['is_renew',              'TEXT'],
    ['is_closed',             'TEXT'],
    ['is_churn',              'TEXT'],
    ['total_contract_value',  'REAL'],
    ['products',              'TEXT'],
    ['upsell',                'TEXT'],
    ['opportunity_win_date',  'TEXT'],
    ['service_start',         'TEXT'],
    ['service_end',           'TEXT'],
    ['setup_fee',             'REAL'],
    ['arr',                   'REAL'],
    ['client_type',           'TEXT'],
    ['country',               'TEXT'],
    ['general_tiering',       'TEXT'],
    ['adv_tiering',           'TEXT'],
    ['client_manager',        'TEXT'],
    ['am_owner',              'TEXT'],
    ['adv_owner',             'TEXT'],
    ['s_home',                'REAL DEFAULT 0'],
    ['s_quickwins',           'REAL DEFAULT 0'],
    ['s_sales',               'REAL DEFAULT 0'],
    ['s_media',               'REAL DEFAULT 0'],
    ['s_sell_in',             'REAL DEFAULT 0'],
    ['s_products',            'REAL DEFAULT 0'],
    ['s_category',            'REAL DEFAULT 0'],
    ['s_amc',                 'REAL DEFAULT 0'],
    ['s_seller',              'REAL DEFAULT 0'],
  ]
  for (const [col, type] of monday5Cols) {
    if (!clientCols5.includes(col)) {
      db.exec(`ALTER TABLE clients ADD COLUMN ${col} ${type}`)
    }
  }

  // Migration 5b: Monday sync log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS monday_sync_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_type     TEXT NOT NULL,
      records_synced  INTEGER DEFAULT 0,
      records_created INTEGER DEFAULT 0,
      records_updated INTEGER DEFAULT 0,
      synced_at     DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)

  // Migration 6: Unified sync metadata (last update timestamp per source)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_metadata (
      source       TEXT PRIMARY KEY,
      sync_type    TEXT,
      last_sync_at DATETIME,
      records      INTEGER,
      notes        TEXT
    );
  `)

  // Migration 7: Clerk organizations + users cache
  db.exec(`
    CREATE TABLE IF NOT EXISTS clerk_organizations (
      id               TEXT PRIMARY KEY,
      slug             TEXT,
      name             TEXT,
      modules_enabled  TEXT,
      raw_metadata     TEXT,
      currencies       TEXT,
      total_members    INTEGER DEFAULT 0,
      internal_members INTEGER DEFAULT 0,
      external_members INTEGER DEFAULT 0,
      last_synced_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_clerk_orgs_slug
      ON clerk_organizations(slug) WHERE slug IS NOT NULL;

    CREATE TABLE IF NOT EXISTS clerk_users (
      id              TEXT PRIMARY KEY,
      org_id          TEXT,
      org_slug        TEXT,
      email           TEXT,
      first_name      TEXT,
      last_name       TEXT,
      role            TEXT,
      is_internal     INTEGER DEFAULT 0,
      last_sign_in_at DATETIME,
      created_at      DATETIME,
      last_synced_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_clerk_users_org_id   ON clerk_users(org_id);
    CREATE INDEX IF NOT EXISTS idx_clerk_users_org_slug ON clerk_users(org_slug);
    CREATE INDEX IF NOT EXISTS idx_clerk_users_email    ON clerk_users(email);
  `)

  // Migration 8: Feedback session transcripts from Notion
  db.exec(`
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
      imported_at         DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_transcripts_client ON feedback_transcripts(client_code);
    CREATE INDEX IF NOT EXISTS idx_transcripts_date   ON feedback_transcripts(session_date);
  `)

  // Migration 8b: Add transcript_summary column if missing (backfill for existing DBs)
  const transcriptCols = (db.prepare('PRAGMA table_info(feedback_transcripts)').all() as { name: string }[]).map((c) => c.name)
  if (!transcriptCols.includes('transcript_summary')) {
    db.exec('ALTER TABLE feedback_transcripts ADD COLUMN transcript_summary TEXT')
  }
}

// ─────────────────────────── SYNC METADATA ────────────────────────────

/** Upsert last-sync timestamp for a data source ('monday' | 'notion' | 'posthog' | 'clerk') */
export function recordSync(source: 'monday' | 'notion' | 'posthog' | 'clerk', syncType: string, records: number, notes?: string) {
  const db = getDb()
  db.prepare(`
    INSERT INTO sync_metadata (source, sync_type, last_sync_at, records, notes)
    VALUES (?, ?, datetime('now'), ?, ?)
    ON CONFLICT(source) DO UPDATE SET
      sync_type    = excluded.sync_type,
      last_sync_at = excluded.last_sync_at,
      records      = excluded.records,
      notes        = excluded.notes
  `).run(source, syncType, records, notes ?? null)
}

export function getSyncMetadata(source: 'monday' | 'notion' | 'posthog' | 'clerk'): { last_sync_at: string | null; records: number | null; sync_type: string | null } {
  const db = getDb()
  const row = db.prepare('SELECT last_sync_at, records, sync_type FROM sync_metadata WHERE source = ?').get(source) as { last_sync_at: string | null; records: number | null; sync_type: string | null } | undefined
  return row ?? { last_sync_at: null, records: null, sync_type: null }
}

// ─────────────────────────── HELPERS ────────────────────────────

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// ─────────────────────────── SEED CLIENTS ────────────────────────────

function seedClients(db: Database.Database) {
  const insertClient = db.prepare(`
    INSERT INTO clients (name, company, pm_assigned, contract_type, modules_active, market, status, notes, client_code, tier)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertTouchpoint = db.prepare(`
    INSERT INTO touchpoints (client_id, date, type, notes) VALUES (?, ?, ?, ?)
  `)

  const seed = db.transaction(() => {
    // 1. Barilla — Tier 1, 3 days ago call → recency 100
    const barilla = insertClient.run(
      'Barilla', 'Barilla G. e R. Fratelli', 'Sara Conti',
      'Full service', JSON.stringify(['Sales', 'Media', 'DSP']), 'IT', 'active',
      'Key account strategico. Revisione budget Q3 in programma.', 'BARIL', 1
    )
    insertTouchpoint.run(barilla.lastInsertRowid, daysAgo(3),  'call',    'Review performance Q2 e roadmap Q3')
    insertTouchpoint.run(barilla.lastInsertRowid, daysAgo(17), 'meeting', 'QBR trimestrale con marketing lead')
    insertTouchpoint.run(barilla.lastInsertRowid, daysAgo(32), 'mail',    'Invio report mensile + slide stakeholders')

    // 2. Lavazza — Tier 1, 10 days ago call → recency 100
    const lavazza = insertClient.run(
      'Lavazza', 'Luigi Lavazza S.p.A.', 'Marco Rossi',
      'Full service', JSON.stringify(['Sales', 'Media']), 'IT', 'active',
      'Espansione nel mercato tedesco prevista per Q4. Interesse per modulo DSP.', 'LAVAZ', 1
    )
    insertTouchpoint.run(lavazza.lastInsertRowid, daysAgo(10), 'call', 'Discusso performance Black Friday campaign')
    insertTouchpoint.run(lavazza.lastInsertRowid, daysAgo(28), 'mail', 'Invio analisi competitor Amazon.de')

    // 3. De'Longhi — Tier 2, 22 days ago meeting → recency 80
    const delonghi = insertClient.run(
      "De'Longhi", "De'Longhi Group", 'Sara Conti',
      'Studio only', JSON.stringify(['Sales']), 'DE', 'active',
      "Focus su small appliances. Potenziale upsell su modulo Media nel Q4.", 'DLONG', 2
    )
    insertTouchpoint.run(delonghi.lastInsertRowid, daysAgo(22), 'meeting', 'Presentazione nuova strategia contenuti PDP')
    insertTouchpoint.run(delonghi.lastInsertRowid, daysAgo(48), 'call',   'Check-in mensile routine')

    // 4. Ferrero — Tier 1, 35 days ago call → recency 60
    const ferrero = insertClient.run(
      'Ferrero', 'Ferrero International S.A.', 'Luca Ferrari',
      'Full service', JSON.stringify(['Sales', 'Media', 'DSP', 'Analytics']), 'IT', 'active',
      'Cliente top tier. Meeting mensili fissi con il C-suite. Rinnovo contratto a marzo.', 'FERRE', 1
    )
    insertTouchpoint.run(ferrero.lastInsertRowid, daysAgo(35), 'call',    'Allineamento budget Q4 e previsioni periodo natalizio')
    insertTouchpoint.run(ferrero.lastInsertRowid, daysAgo(65), 'meeting', 'QBR Q3 con CMO e team marketing')

    // 5. Bialetti — Tier 3, 50 days ago mail → effective 100 → recency 20
    const bialetti = insertClient.run(
      'Bialetti', 'Bialetti Industrie S.p.A.', 'Marco Rossi',
      'Add-on', JSON.stringify(['Sales']), 'IT', 'paused',
      'Pausa servizi fino a febbraio per ristrutturazione interna.', 'BIALE', 3
    )
    insertTouchpoint.run(bialetti.lastInsertRowid, daysAgo(50), 'mail', 'Aggiornamento su stato servizi sospesi e timeline riattivazione')

    // 6. Mulino Bianco — Tier 2, 5 days ago meeting → recency 100
    const mulinobianco = insertClient.run(
      'Mulino Bianco', 'Barilla G. e R. Fratelli', 'Luca Ferrari',
      'Studio only', JSON.stringify(['Sales', 'Media']), 'FR', 'onboarding',
      'Fase di onboarding. Primo kickoff eseguito.', 'MULIN', 2
    )
    insertTouchpoint.run(mulinobianco.lastInsertRowid, daysAgo(5), 'meeting', 'Kickoff meeting — presentazione team, tool e workflow')

    // 7. Parmigiano Reggiano — Tier 2, 8 days ago call → recency 100
    const parmigiano = insertClient.run(
      'Parmigiano Reggiano', 'Consorzio del Parmigiano Reggiano', 'Sara Conti',
      'Full service', JSON.stringify(['Sales', 'DSP']), 'IT', 'active',
      'Account storico dal 2021. Alta soddisfazione.', 'PARMI', 2
    )
    insertTouchpoint.run(parmigiano.lastInsertRowid, daysAgo(8),  'call', 'Update performance estiva — ottimi risultati DSP +34% ROAS')
    insertTouchpoint.run(parmigiano.lastInsertRowid, daysAgo(22), 'mail', 'Invio slide presentazione per stakeholders interni')

    // 8. Illy — Tier 2, 42 days ago mail → effective 84 → recency 20
    const illy = insertClient.run(
      'Illy', 'illycaffè S.p.A.', 'Marco Rossi',
      'Full service', JSON.stringify(['Sales', 'Media']), 'IT', 'active',
      'Interesse per integrazione nuovi marketplace. Da seguire per upsell DSP.', 'ILLY', 2
    )
    insertTouchpoint.run(illy.lastInsertRowid, daysAgo(42), 'mail',    'Invio piano media semestrale e proposta budget')
    insertTouchpoint.run(illy.lastInsertRowid, daysAgo(85), 'meeting', 'Riunione annuale pianificazione — presente anche il CFO')

    // 9. Chicco — Tier 3, churned, 90 days ago
    const chicco = insertClient.run(
      'Chicco', 'Artsana Group', 'Luca Ferrari',
      'Studio only', JSON.stringify(['Sales']), 'DE', 'churned',
      'Churned a luglio 2025. Motivo: cambio strategia digital interna.', 'CHICCO', 3
    )
    insertTouchpoint.run(chicco.lastInsertRowid, daysAgo(90), 'call', 'Ultima call prima del churn — nessun accordo trovato')

    // 10. Granarolo — Tier 2, 55 days ago call → recency 40
    const granarolo = insertClient.run(
      'Granarolo', 'Granarolo S.p.A.', 'Sara Conti',
      'Add-on', JSON.stringify(['Sales', 'Analytics']), 'IT', 'active',
      'Potenziale upsell su modulo Media nel prossimo rinnovo.', 'GRANA', 2
    )
    insertTouchpoint.run(granarolo.lastInsertRowid, daysAgo(55), 'call',    'Review semestrale contratto e piano attività H2')
    insertTouchpoint.run(granarolo.lastInsertRowid, daysAgo(72), 'meeting', 'Presentazione proposta upsell modulo Media')
  })

  seed()
}

// ─────────────────────────── SEED BUGS ────────────────────────────

function seedBugs(db: Database.Database) {
  const insertBug = db.prepare(`
    INSERT OR IGNORE INTO bugs
      (id, bug_title, status, priority, modulo, tool, reported_by, client_tier, assigned_to, sprint, date_reported, due_date, tags, description, notion_url, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'seed')
  `)

  const seed = db.transaction(() => {
    // ── BARIL (Barilla) ── 0 open, 4 resolved → bug_score 100
    insertBug.run(uuid(), 'Errore nel calcolo ROAS su Sales report', 'Fixed', 'High', 'Sales', 'Studio', 'BARIL', '1', 'Mario Bianchi', 'Sprint 10', daysAgo(45), daysAgo(40), JSON.stringify(['Backend']), null, null)
    insertBug.run(uuid(), 'Dashboard non carica su Safari mobile', 'Fixed', 'Medium', 'Sales', 'Studio', 'BARIL', '1', 'Luigi Verdi', 'Sprint 10', daysAgo(50), daysAgo(44), JSON.stringify(['Frontend', 'Mobile']), null, null)
    insertBug.run(uuid(), 'Export CSV mancante intestazione colonne', 'Closed', 'Low', 'Sales', 'Studio', 'BARIL', '1', 'Mario Bianchi', 'Sprint 9', daysAgo(60), daysAgo(55), JSON.stringify(['Backend']), null, null)
    insertBug.run(uuid(), 'Filtro data non funziona per date future', 'Closed', 'Medium', 'Media', 'AMC', 'BARIL', '1', 'Luigi Verdi', 'Sprint 9', daysAgo(65), daysAgo(60), JSON.stringify(['Frontend']), null, null)

    // ── LAVAZ (Lavazza) ── 1 High open (In Progress), 2 resolved → bug_score 85
    insertBug.run(uuid(), 'AMC Audience overlap non corretto per Sponsored Brands', 'In Progress', 'High', 'Media', 'AMC', 'LAVAZ', '1', 'Anna Russo', 'Sprint 12', daysAgo(12), daysAgo(5), JSON.stringify(['Backend', 'Database']), 'Le audience overlap mostrano dati discordanti rispetto a Campaign Manager.', null)
    insertBug.run(uuid(), 'Sync prodotti lenta oltre 500 ASIN', 'Fixed', 'Medium', 'Sales', 'Studio', 'LAVAZ', '1', 'Mario Bianchi', 'Sprint 11', daysAgo(30), daysAgo(25), JSON.stringify(['Performance', 'Backend']), null, null)
    insertBug.run(uuid(), 'Errore 403 su API refresh token', 'Fixed', 'High', 'Sales', 'Studio', 'LAVAZ', '1', 'Anna Russo', 'Sprint 11', daysAgo(35), daysAgo(28), JSON.stringify(['Backend']), null, null)

    // ── DLONG (De'Longhi) ── 1 Medium open → bug_score 80
    insertBug.run(uuid(), 'Colonna "Share of Voice" mostra N/A per categoria Caffettiere', 'Open', 'Medium', 'Sales', 'Studio', 'DLONG', '2', 'Luigi Verdi', 'Sprint 12', daysAgo(8), null, JSON.stringify(['Backend', 'Database']), 'La colonna SoV non si popola per specifiche categorie Amazon.de.', null)

    // ── FERRE (Ferrero) ── 1 Critical + 1 High open, 2 resolved → bug_score 40 (weighted 3.5)
    insertBug.run(uuid(), 'BuyBox monitor non aggiorna prezzi in real-time per Nutella', 'Open', 'Critical', 'Sales', 'Studio', 'FERRE', '1', 'Anna Russo', 'Sprint 12', daysAgo(5), daysAgo(2), JSON.stringify(['Backend', 'Performance']), 'Il monitor BuyBox mostra dati con ritardo di 4+ ore su Amazon.it. Impatta operatività quotidiana.', null)
    insertBug.run(uuid(), 'DSP report: impression count negativo per retargeting campaign', 'In Progress', 'High', 'Media', 'AMC', 'FERRE', '1', 'Mario Bianchi', 'Sprint 12', daysAgo(10), daysAgo(5), JSON.stringify(['Backend']), 'Valori negativi nel conteggio impression su campagne retargeting DSP.', null)
    insertBug.run(uuid(), 'Errore importazione catalogo >10.000 SKU', 'Fixed', 'High', 'Sales', 'Studio', 'FERRE', '1', 'Anna Russo', 'Sprint 11', daysAgo(25), daysAgo(20), JSON.stringify(['Backend', 'Performance']), null, null)
    insertBug.run(uuid(), 'Widget "Top performers" vuoto per mercato FR', 'Fixed', 'Medium', 'Sales', 'Studio', 'FERRE', '1', 'Luigi Verdi', 'Sprint 10', daysAgo(40), daysAgo(35), JSON.stringify(['Frontend']), null, null)

    // ── ILLY ── 1 Critical open, 1 resolved → bug_score 60 (weighted 2)
    insertBug.run(uuid(), 'Invoice generator produce PDF corrotto per ordini >50 righe', 'Open', 'Critical', 'Sales', 'Invoice', 'ILLY', '2', 'Anna Russo', 'Sprint 12', daysAgo(7), daysAgo(3), JSON.stringify(['Backend', 'Documentation']), 'Il generatore PDF fallisce silenziosamente su ordini con molte righe.', null)
    insertBug.run(uuid(), 'Filtro categoria "Capsule" non mostra sotto-categorie', 'Fixed', 'Medium', 'Sales', 'Studio', 'ILLY', '2', 'Mario Bianchi', 'Sprint 11', daysAgo(20), daysAgo(15), JSON.stringify(['Frontend']), null, null)

    // ── GRANA (Granarolo) ── 1 High + 2 Medium open → bug_score 40 (weighted 3.5), 1 resolved
    insertBug.run(uuid(), 'Analytics: trend a 52 settimane non carica per categorie Latticini', 'Open', 'High', 'Sales', 'Studio', 'GRANA', '2', 'Luigi Verdi', 'Sprint 12', daysAgo(14), daysAgo(7), JSON.stringify(['Backend', 'Performance']), null, null)
    insertBug.run(uuid(), 'SMR report: comparazione YoY errata per promozioni Q4', 'In Progress', 'Medium', 'Sales', 'SMR', 'GRANA', '2', 'Mario Bianchi', 'Sprint 12', daysAgo(9), null, JSON.stringify(['Backend']), null, null)
    insertBug.run(uuid(), 'Notifiche email non inviate per alert stock out', 'Open', 'Medium', 'Sales', 'Studio', 'GRANA', '2', 'Luigi Verdi', 'Sprint 11', daysAgo(18), null, JSON.stringify(['Backend']), null, null)
    insertBug.run(uuid(), 'Icone categorie non visualizzate su Firefox', 'Fixed', 'Low', 'Sales', 'Studio', 'GRANA', '2', 'Anna Russo', 'Sprint 10', daysAgo(30), daysAgo(25), JSON.stringify(['Frontend', 'Compatibility']), null, null)

    // ── PARMI (Parmigiano Reggiano) ── 0 open, 3 resolved → bug_score 100
    insertBug.run(uuid(), 'Mappa geografica delle vendite non responsive su tablet', 'Fixed', 'Low', 'Sales', 'Studio', 'PARMI', '1', 'Mario Bianchi', 'Sprint 11', daysAgo(35), daysAgo(28), JSON.stringify(['Frontend', 'Mobile']), null, null)
    insertBug.run(uuid(), 'Errore calcolo margine per bundle prodotti', 'Closed', 'Medium', 'Sales', 'Studio', 'PARMI', '1', 'Anna Russo', 'Sprint 10', daysAgo(50), daysAgo(45), JSON.stringify(['Backend']), null, null)
    insertBug.run(uuid(), 'Filtro per ASIN non salva preferenza utente', 'Closed', 'Low', 'Sales', 'Studio', 'PARMI', '1', 'Luigi Verdi', 'Sprint 9', daysAgo(65), daysAgo(60), JSON.stringify(['Frontend']), null, null)

    // ── MULIN (Mulino Bianco) ── 1 Low open → bug_score 80 (weighted 1)
    insertBug.run(uuid(), 'Onboarding: wizard step 3 non procede su Chrome 120', 'Open', 'Low', 'Sales', 'Studio', 'MULIN', '2', 'Mario Bianchi', 'Sprint 12', daysAgo(3), null, JSON.stringify(['Frontend', 'Compatibility']), 'Il pulsante "Avanti" nel wizard di onboarding non risponde su Chrome versione 120.', null)

    // ── CAME (unmatched — simula un cliente reale non ancora in anagrafica) ──
    insertBug.run(uuid(), 'Price tracker: alert soglia non si attiva su marketplace UK', 'Open', 'High', 'Sales', 'Studio', 'CAME', '1', 'Anna Russo', 'Sprint 12', daysAgo(6), daysAgo(3), JSON.stringify(['Backend']), null, null)
    insertBug.run(uuid(), 'DP report: grafico trend vuoto per nuovo account', 'In Progress', 'Medium', 'Sales', 'DP', 'CAME', '1', 'Mario Bianchi', 'Sprint 12', daysAgo(4), null, JSON.stringify(['Frontend', 'Backend']), null, null)

    // ── LUXO (unmatched — altro cliente non in anagrafica) ──
    insertBug.run(uuid(), 'AMC: query custom restituisce timeout dopo 30s', 'Open', 'Critical', 'Media', 'AMC', 'LUXO', '2', 'Anna Russo', 'Sprint 12', daysAgo(2), null, JSON.stringify(['Backend', 'Performance']), 'Le query AMC personalizzate vanno in timeout su database >5M eventi.', null)
  })

  seed()
}
