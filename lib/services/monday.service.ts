/**
 * lib/services/monday.service.ts — Monday.com integration
 *
 * Supports two modes:
 *   - API mode: MONDAY_API_TOKEN + MONDAY_BOARD_ID set in .env.local
 *   - CSV mode: import from Monday-exported XLSX/CSV file
 *
 * Monday is the MASTER for client registry data. On sync, Monday fields
 * overwrite local values — but touchpoints, bugs, PostHog data, notes,
 * and our computed health score are never touched.
 */

import * as XLSX from 'xlsx'
import { db, recordSync } from '../db'
import type { MondaySyncResult } from '../types'

// ─── Config ──────────────────────────────────────────────────────────

export function isMondayConfigured(): boolean {
  return !!(process.env.MONDAY_API_TOKEN && process.env.MONDAY_BOARD_ID)
}

// ─── Column mapping (Monday header → DB field) ────────────────────────

export const MONDAY_COLUMN_MAP: Record<string, string> = {
  'Name':                  'name',
  'CLIENT_ID_TEXT':        'client_code',
  'CLIENT ID':             'client_code',   // legacy fallback (old CSV exports)
  'General Tiering':       'general_tiering',
  'Country':               'country',
  'Client Manager':        'client_manager',
  'AM Owner':              'am_owner',
  'ADV Owner':             'adv_owner',
  'Prio':                  'prio',
  'Health':                'monday_health',
  'Potential Churn':       'potential_churn',
  'Contract Item':         'contract_item',
  'ISRenew':               'is_renew',
  'Closed':                'is_closed',
  'Churn':                 'is_churn',
  'Total Contract Value':  'total_contract_value',
  'Products':              'products',
  'Upsell':                'upsell',
  'Opportunity Win Date':  'opportunity_win_date',
  'Service Start':         'service_start',
  'Service End date':      'service_end',
  'Setup Fee':             'setup_fee',
  'ARR':                   'arr',
  'Type':                  'client_type',
  'Client Type':           'client_type',
  'ADV Tiering':           'adv_tiering',
  'S-Home':                's_home',
  'S-Quickwins':           's_quickwins',
  'S-Sales':               's_sales',
  'S-Media':               's_media',
  'S-Sell-In':             's_sell_in',
  'S-Products':            's_products',
  'S-Category':            's_category',
  'S-AMC':                 's_amc',
  'S-Seller':              's_seller',
}

// Columns explicitly ignored from Monday export
const IGNORED_COLUMNS = new Set([
  'Subitems', 'Contract Doc', 'Last Updated', 'Formula', 'Formula 1',
  '%2021', 'link to WIP 2023', 'Check Totale Competenze',
  'Competenza 2022', 'Competenza 2023', 'Competenza 2024',
  'Competenza 2025', 'Competenza 2026',
])

// ─── Value parsers ────────────────────────────────────────────────────

export function parseMoneyValue(str: unknown): number {
  if (str === null || str === undefined || str === '' || str === '-') return 0
  if (typeof str === 'number') return str
  let clean = String(str).replace(/[€$£\s]/g, '')
  if (clean.includes('.') && clean.includes(',')) {
    if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
      // Format: 15.000,00 → 15000.00
      clean = clean.replace(/\./g, '').replace(',', '.')
    } else {
      // Format: 15,000.00 → 15000.00
      clean = clean.replace(/,/g, '')
    }
  } else if (clean.includes(',')) {
    // Only comma: if 2 digits after comma it's decimal, else thousands separator
    if (/,\d{2}$/.test(clean)) {
      clean = clean.replace(',', '.')
    } else {
      clean = clean.replace(/,/g, '')
    }
  }
  return parseFloat(clean) || 0
}

/** Normalize tier from Monday string (e.g. "Tier 1", "1", "T1") to integer */
function normalizeTier(value: string | null | undefined): number | null {
  if (!value) return null
  const match = value.match(/\d+/)
  const t = match ? parseInt(match[0]) : null
  return t && t >= 1 && t <= 3 ? t : null
}

/** Normalize date string from various Monday formats to ISO date (YYYY-MM-DD) */
function normalizeDate(value: string | null | undefined): string | null {
  if (!value || value === '' || value === '-') return null
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10)
  // DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`
  // Excel serial number (number of days since 1900-01-01)
  const num = parseFloat(value)
  if (!isNaN(num) && num > 1000) {
    const date = XLSX.SSF.parse_date_code(num)
    if (date) return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
  }
  return null
}

// ─── Row mapping ──────────────────────────────────────────────────────

const MONEY_FIELDS = new Set([
  'total_contract_value', 'setup_fee', 'arr',
  's_home', 's_quickwins', 's_sales', 's_media', 's_sell_in',
  's_products', 's_category', 's_amc', 's_seller',
])
const DATE_FIELDS = new Set(['service_start', 'service_end', 'opportunity_win_date'])

export function mapMondayRow(row: Record<string, unknown>): {
  mapped: Record<string, unknown>
  unmapped: string[]
  clientCode: string | null
} {
  const mapped: Record<string, unknown> = {}
  const unmapped: string[] = []

  for (const [col, value] of Object.entries(row)) {
    const dbField = MONDAY_COLUMN_MAP[col]
    if (dbField) {
      if (MONEY_FIELDS.has(dbField)) {
        mapped[dbField] = parseMoneyValue(value)
      } else if (DATE_FIELDS.has(dbField)) {
        mapped[dbField] = normalizeDate(String(value ?? ''))
      } else {
        const str = value !== undefined ? String(value).trim() : ''
        mapped[dbField] = str !== '' && str.toLowerCase() !== 'null' ? str : null
      }
    } else if (!IGNORED_COLUMNS.has(col)) {
      unmapped.push(col)
    }
  }

  // Derive tier from ARR (primary: economic definition T1>30k, T2 15-30k, T3<15k)
  // Falls back to general_tiering string from Monday if ARR not available
  const arr = mapped.arr as number | null | undefined
  if (arr && arr > 0) {
    mapped.tier = arr > 30_000 ? 1 : arr >= 15_000 ? 2 : 3
  } else if (mapped.general_tiering) {
    const t = normalizeTier(mapped.general_tiering as string)
    if (t !== null) mapped.tier = t
  }

  const clientCode = mapped.client_code
    ? String(mapped.client_code).trim().toUpperCase()
    : null

  return { mapped, unmapped, clientCode }
}

// ─── File parsing ─────────────────────────────────────────────────────

export function parseFileToRows(buffer: Buffer, filename: string): Record<string, unknown>[] {
  const isXlsx = /\.(xlsx|xls|xlsm)$/i.test(filename)
  let workbook: XLSX.WorkBook

  if (isXlsx) {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  } else {
    // CSV: parse as text
    workbook = XLSX.read(buffer, { type: 'buffer', raw: false })
  }

  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
}

// ─── Upsert logic ─────────────────────────────────────────────────────

const MONDAY_WRITABLE_FIELDS = [
  // NOTE: 'client_code' intentionally excluded — it's the lookup key, never overwritten by sync
  'name', 'country', 'client_manager', 'am_owner', 'adv_owner',
  'prio', 'monday_health', 'potential_churn', 'contract_item', 'is_renew',
  'is_closed', 'is_churn', 'total_contract_value', 'products', 'upsell',
  'opportunity_win_date', 'service_start', 'service_end', 'setup_fee', 'arr',
  'client_type', 'general_tiering', 'adv_tiering', 'tier',
  's_home', 's_quickwins', 's_sales', 's_media', 's_sell_in',
  's_products', 's_category', 's_amc', 's_seller',
] as const


export async function upsertMondayRows(rows: Record<string, unknown>[]): Promise<MondaySyncResult> {
  const sql = await db()
  const result: MondaySyncResult = { synced: 0, created: 0, updated: 0, skipped: 0, errors: [] }

  try {
    await sql.begin(async (tsql) => {
      for (const rawRow of rows) {
        const { mapped, clientCode } = mapMondayRow(rawRow)
        const itemName = String(rawRow.Name ?? mapped.name ?? '').trim()

        // Skip closed or churned rows — only sync active contracts
        const isClosed = String(mapped.is_closed ?? '').trim().toLowerCase()
        const isChurn  = String(mapped.is_churn  ?? '').trim().toLowerCase()
        if (isClosed && !['', 'no', '-', 'null'].includes(isClosed)) { result.skipped++; continue }
        if (isChurn  && !['', 'no', '-', 'null'].includes(isChurn))  { result.skipped++; continue }

        const resolvedCode = clientCode
        if (!resolvedCode) { result.skipped++; continue }

        // Filter to only writable fields that are present in the mapped row
        const fields = MONDAY_WRITABLE_FIELDS.filter((f) => f in mapped)
        if (fields.length === 0) { result.skipped++; continue }

        // Find existing client by (client_code + name) exact match.
        // - If found → UPDATE
        // - If not found → INSERT new client
        // This correctly handles the De'Longhi/De'Longhi_US case where two clients share
        // the same client_code but have different names (treated as separate rows).
        const existingRows = await tsql<{ id: number }[]>`
          SELECT id FROM clients
          WHERE LOWER(TRIM(client_code)) = ${resolvedCode.toLowerCase()}
            AND LOWER(TRIM(name)) = ${itemName.toLowerCase()}
          LIMIT 1
        `
        const existing = existingRows[0]

        // Build the data object with only the fields present in the mapped row
        const fieldData: Record<string, unknown> = {}
        for (const f of fields) fieldData[f] = mapped[f] ?? null

        if (existing) {
          // UPDATE existing client
          fieldData.updated_at = new Date().toISOString()
          await tsql`UPDATE clients SET ${tsql(fieldData)} WHERE id = ${existing.id}`
          result.updated++
        } else {
          // INSERT new client — set name + client_code + status if not already in fieldData
          const insertData: Record<string, unknown> = {
            name: itemName || (mapped.name as string) || resolvedCode,
            client_code: resolvedCode.toUpperCase(),
            status: 'active',
            ...fieldData,
          }
          await tsql`INSERT INTO clients ${tsql(insertData)}`
          result.created++
        }
        result.synced++
      }
    })

    await sql`
      INSERT INTO monday_sync_log (sync_type, records_synced, records_created, records_updated)
      VALUES ('csv', ${result.synced}, ${result.created}, ${result.updated})
    `
    await recordSync('monday', 'csv', result.synced)
  } catch (e) {
    result.errors.push(String(e))
  }

  return result
}

// ─── Monday API ───────────────────────────────────────────────────────

interface MondayItem {
  id: string
  name: string
  column_values: { id: string; text: string; display_value?: string }[]
}

interface MondayBoardPage {
  columns: { id: string; title: string; type: string }[]
  items_page: { cursor?: string; items: MondayItem[] }
}

async function fetchMondayFirstPage(): Promise<{
  colMap: Map<string, string>
  items: MondayItem[]
  nextCursor: string | null
}> {
  const query = `query {
    boards(ids: [${process.env.MONDAY_BOARD_ID}]) {
      columns { id title type }
      items_page(limit: 500) {
        cursor
        items {
          id
          name
          column_values { id text ... on MirrorValue { display_value } }
        }
      }
    }
  }`

  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      Authorization: process.env.MONDAY_API_TOKEN!,
      'Content-Type': 'application/json',
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query }),
  })

  if (!res.ok) throw new Error(`Monday API error: ${res.status} ${res.statusText}`)
  const json = await res.json() as {
    data?: { boards?: MondayBoardPage[] }
    errors?: { message: string }[]
  }
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '))

  const board = json.data?.boards?.[0]
  const colMap = new Map((board?.columns ?? []).map((c) => [c.id, c.title]))
  const page = board?.items_page
  return { colMap, items: page?.items ?? [], nextCursor: page?.cursor ?? null }
}

async function fetchMondayNextPage(cursor: string): Promise<{ items: MondayItem[]; nextCursor: string | null }> {
  const query = `query {
    next_items_page(cursor: "${cursor}", limit: 500) {
      cursor
      items {
        id
        name
        column_values { id text ... on MirrorValue { display_value } }
      }
    }
  }`

  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      Authorization: process.env.MONDAY_API_TOKEN!,
      'Content-Type': 'application/json',
      'API-Version': '2024-01',
    },
    body: JSON.stringify({ query }),
  })

  if (!res.ok) throw new Error(`Monday API error: ${res.status} ${res.statusText}`)
  const json = await res.json() as {
    data?: { next_items_page?: { cursor?: string; items: MondayItem[] } }
    errors?: { message: string }[]
  }
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join('; '))

  const page = json.data?.next_items_page
  return { items: page?.items ?? [], nextCursor: page?.cursor ?? null }
}

function mondayItemToRow(item: MondayItem, colMap: Map<string, string>): Record<string, unknown> {
  const row: Record<string, unknown> = { Name: item.name }
  for (const col of item.column_values) {
    const title = colMap.get(col.id)
    if (!title) continue
    // Mirror columns return text=null but have display_value
    const value = col.text ?? col.display_value ?? null
    if (value !== undefined) row[title] = value
  }
  return row
}

export async function syncFromMondayApi(): Promise<MondaySyncResult> {
  // First page also returns column definitions (id → title mapping)
  const { colMap, items: firstItems, nextCursor: firstCursor } = await fetchMondayFirstPage()

  const allRows: Record<string, unknown>[] = firstItems.map((i) => mondayItemToRow(i, colMap))

  let cursor = firstCursor
  while (cursor) {
    const { items, nextCursor } = await fetchMondayNextPage(cursor)
    allRows.push(...items.map((i) => mondayItemToRow(i, colMap)))
    if (!nextCursor || items.length === 0) break
    cursor = nextCursor
  }

  const result = await upsertMondayRows(allRows)

  // Update sync log with 'api' type
  const sql = await db()
  await sql`
    INSERT INTO monday_sync_log (sync_type, records_synced, records_created, records_updated)
    VALUES ('api', ${result.synced}, ${result.created}, ${result.updated})
  `
  await recordSync('monday', 'api', result.synced)

  return result
}

// ─── Status helpers ───────────────────────────────────────────────────

export async function getMondayStatus(): Promise<{
  status: 'api' | 'csv' | 'none'
  lastSync: string | null
  lastSyncType: string | null
  recordCount: number
}> {
  const sql = await db()
  const logRows = await sql<{ sync_type: string; synced_at: string }[]>`
    SELECT sync_type, synced_at::text FROM monday_sync_log ORDER BY id DESC LIMIT 1
  `
  const lastLog = logRows[0]

  const [{ count }] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int as count FROM clients WHERE arr IS NOT NULL OR monday_health IS NOT NULL
  `

  const apiConfigured = isMondayConfigured()
  let status: 'api' | 'csv' | 'none' = 'none'
  if (apiConfigured && count > 0) status = 'api'
  else if (apiConfigured) status = 'api'  // configured but not synced yet
  else if (count > 0) status = 'csv'

  return {
    status,
    lastSync: lastLog?.synced_at ?? null,
    lastSyncType: lastLog?.sync_type ?? null,
    recordCount: count,
  }
}

// ─── Utility ──────────────────────────────────────────────────────────

/** Detect which columns in a set of rows are mapped vs unmapped */
export function analyzeColumns(rows: Record<string, unknown>[]): {
  mapped: string[]
  unmapped: string[]
} {
  const allCols = new Set<string>()
  for (const row of rows.slice(0, 5)) Object.keys(row).forEach((k) => allCols.add(k))
  const mapped: string[] = []
  const unmapped: string[] = []
  for (const col of allCols) {
    if (MONDAY_COLUMN_MAP[col]) mapped.push(col)
    else if (!IGNORED_COLUMNS.has(col)) unmapped.push(col)
  }
  return { mapped, unmapped }
}
