/**
 * lib/clerk.ts — Clerk Backend API client (READ-ONLY)
 *
 * CRITICAL: Only GET requests are made to Clerk API.
 * All writes go to local SQLite cache only.
 *
 * Join key: clerk_organizations.slug === clients.client_code (case-insensitive)
 */

import { getDb, recordSync } from './db'
import { isInternalUser } from './posthog'
import type { ClerkOrgRow, ClerkUserRow } from './types'

const CLERK_BASE    = 'https://api.clerk.com/v1'
const CLERK_SECRET  = process.env.CLERK_SECRET_KEY

export function isClerkConfigured(): boolean {
  return !!CLERK_SECRET
}

function clerkHeaders(): HeadersInit {
  return { Authorization: `Bearer ${CLERK_SECRET}`, 'Content-Type': 'application/json' }
}

// ─── Module parsing ────────────────────────────────────────────────────

/**
 * parseClerkModules — extract enabled module names from Clerk public_metadata.
 *
 * The metadata structure uses nested objects with `.active` booleans:
 *   { sales: { active: true }, media: { active: true, dsp: { active: true } }, ... }
 *
 * Returns a normalized array of module identifier strings.
 */
export function parseClerkModules(metadata: Record<string, unknown>): string[] {
  if (!metadata) return []
  const modules: string[] = []

  function isActive(val: unknown): boolean {
    if (!val || typeof val !== 'object') return false
    return (val as Record<string, unknown>).active === true
  }

  if (isActive(metadata.sales))     { modules.push('sales'); modules.push('asins') }
  if (isActive(metadata.margin))    modules.push('margin')
  if (isActive(metadata.inventory)) modules.push('inventory')
  if (isActive(metadata.media))     modules.push('media')
  if (isActive(metadata.retail))    { modules.push('buybox'); modules.push('price'); modules.push('content'); modules.push('voice') }
  if (isActive(metadata.market))    modules.push('category')
  if (isActive(metadata.reports))   modules.push('quickwins')
  if (isActive(metadata.sellIn))    modules.push('sellin')
  if (isActive(metadata.beta))      modules.push('beta')

  const media = metadata.media as Record<string, unknown> | undefined
  if (media && isActive(media.amc)) modules.push('amc')
  if (media && isActive(media.dsp)) modules.push('dsp')

  const at = metadata.amazonAccountType as Record<string, unknown> | undefined
  if (at?.seller) modules.push('seller')
  if (at?.vendor) modules.push('vendor')

  // Currencies stored separately (not a module)
  return [...new Set(modules)]
}

// ─── Internal types for Clerk API responses ────────────────────────────

interface ClerkOrgApiRow {
  id: string
  slug: string | null
  name: string
  public_metadata: Record<string, unknown>
  members_count?: number
  created_at: number
  updated_at: number
}

interface ClerkMemberApiRow {
  id: string
  organization_id: string
  role: string
  public_user_data: {
    user_id: string
    first_name: string | null
    last_name: string | null
    identifier: string | null  // email in Clerk memberships
    last_sign_in_at?: number | null
    created_at?: number
  }
  created_at: number
}

// ─── API fetch helpers ─────────────────────────────────────────────────

async function clerkGet<T>(path: string): Promise<T> {
  const res = await fetch(`${CLERK_BASE}${path}`, { headers: clerkHeaders() })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Clerk ${path} → ${res.status}: ${txt.substring(0, 200)}`)
  }
  return res.json() as Promise<T>
}

export async function fetchAllOrganizations(): Promise<ClerkOrgApiRow[]> {
  const all: ClerkOrgApiRow[] = []
  let offset = 0
  const limit = 100
  while (true) {
    const data = await clerkGet<{ data: ClerkOrgApiRow[]; total_count: number }>(
      `/organizations?limit=${limit}&offset=${offset}&include_members_count=true`
    )
    all.push(...data.data)
    if (all.length >= data.total_count || data.data.length < limit) break
    offset += limit
  }
  return all
}

export async function fetchOrgMembers(orgId: string): Promise<ClerkMemberApiRow[]> {
  const all: ClerkMemberApiRow[] = []
  let offset = 0
  const limit = 100
  while (true) {
    const data = await clerkGet<{ data: ClerkMemberApiRow[]; total_count: number }>(
      `/organizations/${orgId}/memberships?limit=${limit}&offset=${offset}`
    )
    all.push(...data.data)
    if (all.length >= data.total_count || data.data.length < limit) break
    offset += limit
  }
  return all
}

// ─── DB upsert helpers ─────────────────────────────────────────────────

function upsertOrg(
  db: ReturnType<typeof getDb>,
  org: ClerkOrgApiRow,
  stats: { total: number; internal: number; external: number },
): void {
  const modules    = parseClerkModules(org.public_metadata)
  const currencies = (org.public_metadata.currencies as unknown[] | undefined) ?? []
  db.prepare(`
    INSERT INTO clerk_organizations
      (id, slug, name, modules_enabled, raw_metadata, currencies, total_members, internal_members, external_members, last_synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      slug             = excluded.slug,
      name             = excluded.name,
      modules_enabled  = excluded.modules_enabled,
      raw_metadata     = excluded.raw_metadata,
      currencies       = excluded.currencies,
      total_members    = excluded.total_members,
      internal_members = excluded.internal_members,
      external_members = excluded.external_members,
      last_synced_at   = excluded.last_synced_at
  `).run(
    org.id, org.slug ?? null, org.name,
    JSON.stringify(modules),
    JSON.stringify(org.public_metadata),
    JSON.stringify(currencies),
    stats.total, stats.internal, stats.external,
  )
}

function upsertUser(
  db: ReturnType<typeof getDb>,
  orgId: string,
  orgSlug: string | null,
  member: ClerkMemberApiRow,
): void {
  const pud        = member.public_user_data
  const email      = pud.identifier ?? null
  const isInternal = email ? isInternalUser(email) : false
  const lastSignIn = pud.last_sign_in_at
    ? new Date(pud.last_sign_in_at).toISOString()
    : null
  const createdAt  = pud.created_at
    ? new Date(pud.created_at).toISOString()
    : new Date(member.created_at).toISOString()

  db.prepare(`
    INSERT INTO clerk_users
      (id, org_id, org_slug, email, first_name, last_name, role, is_internal, last_sign_in_at, created_at, last_synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      org_id          = excluded.org_id,
      org_slug        = excluded.org_slug,
      email           = excluded.email,
      first_name      = excluded.first_name,
      last_name       = excluded.last_name,
      role            = excluded.role,
      is_internal     = excluded.is_internal,
      last_sign_in_at = excluded.last_sign_in_at,
      last_synced_at  = excluded.last_synced_at
  `).run(
    pud.user_id, orgId, orgSlug,
    email, pud.first_name ?? null, pud.last_name ?? null,
    member.role, isInternal ? 1 : 0, lastSignIn, createdAt,
  )
}

// ─── Full sync ─────────────────────────────────────────────────────────

export async function syncAllClerk(): Promise<{ orgs: number; users: number; errors: string[] }> {
  const db     = getDb()
  const errors: string[] = []
  let userCount = 0

  const orgs = await fetchAllOrganizations()

  // Batch member fetching: 5 concurrent requests to avoid rate limiting
  const BATCH = 5
  for (let i = 0; i < orgs.length; i += BATCH) {
    const batch = orgs.slice(i, i + BATCH)
    await Promise.all(batch.map(async (org) => {
      try {
        const members = await fetchOrgMembers(org.id)
        let internal = 0, external = 0

        db.transaction(() => {
          for (const m of members) {
            upsertUser(db, org.id, org.slug, m)
            const email = m.public_user_data.identifier ?? ''
            if (isInternalUser(email)) internal++; else external++
          }
          upsertOrg(db, org, { total: members.length, internal, external })
        })()

        userCount += members.length
      } catch (e) {
        errors.push(`${org.slug ?? org.id}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }))
  }

  recordSync('clerk', 'api', orgs.length)
  return { orgs: orgs.length, users: userCount, errors }
}

// ─── Read helpers ──────────────────────────────────────────────────────

export function getClerkOrgBySlug(slug: string): { org: ClerkOrgRow | null; users: ClerkUserRow[] } {
  const db  = getDb()
  let org = db.prepare(
    `SELECT * FROM clerk_organizations WHERE LOWER(TRIM(slug)) = LOWER(TRIM(?))`
  ).get(slug) as ClerkOrgRow | undefined

  // Fallback: try prefix match (e.g. client_code DISNA → slug disn)
  if (!org) {
    org = db.prepare(
      `SELECT * FROM clerk_organizations WHERE LOWER(TRIM(?)) LIKE LOWER(TRIM(slug)) || '%' ORDER BY LENGTH(slug) DESC LIMIT 1`
    ).get(slug) as ClerkOrgRow | undefined
  }

  if (!org) return { org: null, users: [] }

  const users = db.prepare(
    `SELECT * FROM clerk_users WHERE org_id = ? ORDER BY is_internal ASC, last_sign_in_at DESC`
  ).all(org.id) as ClerkUserRow[]

  return { org, users }
}

export function getClerkStatus(): { configured: boolean; orgCount: number; userCount: number } {
  if (!isClerkConfigured()) return { configured: false, orgCount: 0, userCount: 0 }
  const db = getDb()
  const { orgCount }  = db.prepare('SELECT COUNT(*) as orgCount FROM clerk_organizations').get() as { orgCount: number }
  const { userCount } = db.prepare('SELECT COUNT(*) as userCount FROM clerk_users').get() as { userCount: number }
  return { configured: true, orgCount, userCount }
}
