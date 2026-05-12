/**
 * lib/clerk.ts — Clerk Backend API client (READ-ONLY)
 *
 * CRITICAL: Only GET requests are made to Clerk API.
 * All writes go to local Postgres cache only.
 *
 * Join key: clerk_organizations.slug === clients.client_code (case-insensitive)
 */

import { db, recordSync } from './db'
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

// ─── Full sync ─────────────────────────────────────────────────────────

export async function syncAllClerk(): Promise<{ orgs: number; users: number; errors: string[] }> {
  const sql      = await db()
  const errors: string[] = []
  let userCount  = 0

  const orgs = await fetchAllOrganizations()

  // Batch member fetching: 5 concurrent requests to avoid rate limiting
  const BATCH = 5
  for (let i = 0; i < orgs.length; i += BATCH) {
    const batch = orgs.slice(i, i + BATCH)
    await Promise.all(batch.map(async (org) => {
      try {
        const members = await fetchOrgMembers(org.id)
        let internal = 0, external = 0

        // postgres.js transaction: all inserts + upsert commit atomically
        await sql.begin(async (tsql) => {
          for (const m of members) {
            const pud        = m.public_user_data
            const email      = pud.identifier ?? null
            const isInternal = email ? isInternalUser(email) : false
            const lastSignIn = pud.last_sign_in_at ? new Date(pud.last_sign_in_at).toISOString() : null
            const createdAt  = pud.created_at
              ? new Date(pud.created_at).toISOString()
              : new Date(m.created_at).toISOString()

            await tsql`
              INSERT INTO clerk_users
                (id, org_id, org_slug, email, first_name, last_name, role, is_internal, last_sign_in_at, created_at, last_synced_at)
              VALUES (${pud.user_id}, ${org.id}, ${org.slug}, ${email}, ${pud.first_name ?? null},
                      ${pud.last_name ?? null}, ${m.role}, ${isInternal ? 1 : 0}, ${lastSignIn}, ${createdAt}, NOW())
              ON CONFLICT(id) DO UPDATE SET
                org_id          = EXCLUDED.org_id,
                org_slug        = EXCLUDED.org_slug,
                email           = EXCLUDED.email,
                first_name      = EXCLUDED.first_name,
                last_name       = EXCLUDED.last_name,
                role            = EXCLUDED.role,
                is_internal     = EXCLUDED.is_internal,
                last_sign_in_at = EXCLUDED.last_sign_in_at,
                last_synced_at  = EXCLUDED.last_synced_at
            `

            if (isInternalUser(email ?? '')) internal++; else external++
          }

          const modules    = parseClerkModules(org.public_metadata)
          const currencies = (org.public_metadata.currencies as unknown[] | undefined) ?? []
          await tsql`
            INSERT INTO clerk_organizations
              (id, slug, name, modules_enabled, raw_metadata, currencies, total_members, internal_members, external_members, last_synced_at)
            VALUES (${org.id}, ${org.slug ?? null}, ${org.name},
                    ${JSON.stringify(modules)}, ${JSON.stringify(org.public_metadata)}, ${JSON.stringify(currencies)},
                    ${members.length}, ${internal}, ${external}, NOW())
            ON CONFLICT(id) DO UPDATE SET
              slug             = EXCLUDED.slug,
              name             = EXCLUDED.name,
              modules_enabled  = EXCLUDED.modules_enabled,
              raw_metadata     = EXCLUDED.raw_metadata,
              currencies       = EXCLUDED.currencies,
              total_members    = EXCLUDED.total_members,
              internal_members = EXCLUDED.internal_members,
              external_members = EXCLUDED.external_members,
              last_synced_at   = EXCLUDED.last_synced_at
          `
        })

        userCount += members.length
      } catch (e) {
        errors.push(`${org.slug ?? org.id}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }))
  }

  await recordSync('clerk', 'api', orgs.length)
  return { orgs: orgs.length, users: userCount, errors }
}

// ─── Sync specific orgs by slug (sequential, no deadlocks) ───────────

export async function syncClerkBySlugs(slugs: string[]): Promise<{ synced: string[]; errors: string[] }> {
  const sql = await db()
  const synced: string[] = []
  const errors: string[] = []

  const allOrgs = await fetchAllOrganizations()
  const slugSet = new Set(slugs.map(s => s.toLowerCase()))
  const targetOrgs = allOrgs.filter(o => o.slug && slugSet.has(o.slug.toLowerCase()))

  for (const org of targetOrgs) {
    try {
      const members = await fetchOrgMembers(org.id)
      let internal = 0, external = 0

      await sql.begin(async (tsql) => {
        for (const m of members) {
          const pud = m.public_user_data
          const email = pud.identifier ?? null
          const isInt = email ? isInternalUser(email) : false
          const lastSignIn = pud.last_sign_in_at ? new Date(pud.last_sign_in_at).toISOString() : null
          const createdAt = pud.created_at
            ? new Date(pud.created_at).toISOString()
            : new Date(m.created_at).toISOString()

          await tsql`
            INSERT INTO clerk_users
              (id, org_id, org_slug, email, first_name, last_name, role, is_internal, last_sign_in_at, created_at, last_synced_at)
            VALUES (${pud.user_id}, ${org.id}, ${org.slug}, ${email}, ${pud.first_name ?? null},
                    ${pud.last_name ?? null}, ${m.role}, ${isInt ? 1 : 0}, ${lastSignIn}, ${createdAt}, NOW())
            ON CONFLICT(id) DO UPDATE SET
              org_id = EXCLUDED.org_id, org_slug = EXCLUDED.org_slug, email = EXCLUDED.email,
              first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, role = EXCLUDED.role,
              is_internal = EXCLUDED.is_internal, last_sign_in_at = EXCLUDED.last_sign_in_at,
              last_synced_at = EXCLUDED.last_synced_at
          `
          if (isInternalUser(email ?? '')) internal++; else external++
        }

        const modules = parseClerkModules(org.public_metadata)
        const currencies = (org.public_metadata.currencies as unknown[] | undefined) ?? []
        await tsql`
          INSERT INTO clerk_organizations
            (id, slug, name, modules_enabled, raw_metadata, currencies, total_members, internal_members, external_members, last_synced_at)
          VALUES (${org.id}, ${org.slug ?? null}, ${org.name},
                  ${JSON.stringify(modules)}, ${JSON.stringify(org.public_metadata)}, ${JSON.stringify(currencies)},
                  ${members.length}, ${internal}, ${external}, NOW())
          ON CONFLICT(id) DO UPDATE SET
            slug = EXCLUDED.slug, name = EXCLUDED.name, modules_enabled = EXCLUDED.modules_enabled,
            raw_metadata = EXCLUDED.raw_metadata, currencies = EXCLUDED.currencies,
            total_members = EXCLUDED.total_members, internal_members = EXCLUDED.internal_members,
            external_members = EXCLUDED.external_members, last_synced_at = EXCLUDED.last_synced_at
        `
      })
      synced.push(org.slug!)
    } catch (e) {
      errors.push(`${org.slug ?? org.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return { synced, errors }
}

// ─── Batched sync (for cron — fits in 60s) ────────────────────────────

const CLERK_BATCH_SIZE = 30

export async function syncClerkBatch(): Promise<{ batch: string; orgs: number; users: number; errors: string[] }> {
  const sql = await db()
  const errors: string[] = []
  let userCount = 0

  const allOrgs = await fetchAllOrganizations()
  const totalBatches = Math.ceil(allOrgs.length / CLERK_BATCH_SIZE)

  // Determine which batch to sync based on rotating counter
  const [meta] = await sql<{ notes: string | null }[]>`
    SELECT notes FROM sync_metadata WHERE source = 'clerk'
  `
  const lastBatch = parseInt(meta?.notes?.match(/batch:(\d+)/)?.[1] ?? '-1')
  const currentBatch = (lastBatch + 1) % totalBatches

  const start = currentBatch * CLERK_BATCH_SIZE
  const batchOrgs = allOrgs.slice(start, start + CLERK_BATCH_SIZE)

  const CONCURRENT = 5
  for (let i = 0; i < batchOrgs.length; i += CONCURRENT) {
    const chunk = batchOrgs.slice(i, i + CONCURRENT)
    await Promise.all(chunk.map(async (org) => {
      try {
        const members = await fetchOrgMembers(org.id)
        let internal = 0, external = 0

        await sql.begin(async (tsql) => {
          for (const m of members) {
            const pud = m.public_user_data
            const email = pud.identifier ?? null
            const isInternal = email ? isInternalUser(email) : false
            const lastSignIn = pud.last_sign_in_at ? new Date(pud.last_sign_in_at).toISOString() : null
            const createdAt = pud.created_at
              ? new Date(pud.created_at).toISOString()
              : new Date(m.created_at).toISOString()

            await tsql`
              INSERT INTO clerk_users
                (id, org_id, org_slug, email, first_name, last_name, role, is_internal, last_sign_in_at, created_at, last_synced_at)
              VALUES (${pud.user_id}, ${org.id}, ${org.slug}, ${email}, ${pud.first_name ?? null},
                      ${pud.last_name ?? null}, ${m.role}, ${isInternal ? 1 : 0}, ${lastSignIn}, ${createdAt}, NOW())
              ON CONFLICT(id) DO UPDATE SET
                org_id = EXCLUDED.org_id, org_slug = EXCLUDED.org_slug, email = EXCLUDED.email,
                first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, role = EXCLUDED.role,
                is_internal = EXCLUDED.is_internal, last_sign_in_at = EXCLUDED.last_sign_in_at,
                last_synced_at = EXCLUDED.last_synced_at
            `
            if (isInternalUser(email ?? '')) internal++; else external++
          }

          const modules = parseClerkModules(org.public_metadata)
          const currencies = (org.public_metadata.currencies as unknown[] | undefined) ?? []
          await tsql`
            INSERT INTO clerk_organizations
              (id, slug, name, modules_enabled, raw_metadata, currencies, total_members, internal_members, external_members, last_synced_at)
            VALUES (${org.id}, ${org.slug ?? null}, ${org.name},
                    ${JSON.stringify(modules)}, ${JSON.stringify(org.public_metadata)}, ${JSON.stringify(currencies)},
                    ${members.length}, ${internal}, ${external}, NOW())
            ON CONFLICT(id) DO UPDATE SET
              slug = EXCLUDED.slug, name = EXCLUDED.name, modules_enabled = EXCLUDED.modules_enabled,
              raw_metadata = EXCLUDED.raw_metadata, currencies = EXCLUDED.currencies,
              total_members = EXCLUDED.total_members, internal_members = EXCLUDED.internal_members,
              external_members = EXCLUDED.external_members, last_synced_at = EXCLUDED.last_synced_at
          `
        })
        userCount += members.length
      } catch (e) {
        errors.push(`${org.slug ?? org.id}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }))
  }

  await recordSync('clerk', 'cron', batchOrgs.length, `batch:${currentBatch} of ${totalBatches}`)
  return { batch: `${currentBatch + 1}/${totalBatches}`, orgs: batchOrgs.length, users: userCount, errors }
}

// ─── Read helpers ──────────────────────────────────────────────────────

export async function getClerkOrgBySlug(slug: string): Promise<{ org: ClerkOrgRow | null; users: ClerkUserRow[] }> {
  const sql = await db()
  let orgRows = await sql<ClerkOrgRow[]>`
    SELECT * FROM clerk_organizations WHERE LOWER(TRIM(slug)) = LOWER(TRIM(${slug}))
  `
  let org = orgRows[0]

  // Fallback: try prefix match (e.g. client_code DISNA → slug disn)
  if (!org) {
    orgRows = await sql<ClerkOrgRow[]>`
      SELECT * FROM clerk_organizations
      WHERE LOWER(TRIM(${slug})) LIKE LOWER(TRIM(slug)) || '%'
      ORDER BY LENGTH(slug) DESC
      LIMIT 1
    `
    org = orgRows[0]
  }

  if (!org) return { org: null, users: [] }

  const users = await sql<ClerkUserRow[]>`
    SELECT * FROM clerk_users WHERE org_id = ${org.id}
    ORDER BY is_internal ASC, last_sign_in_at DESC
  `

  return { org, users }
}

export async function getClerkStatus(): Promise<{ configured: boolean; orgCount: number; userCount: number }> {
  if (!isClerkConfigured()) return { configured: false, orgCount: 0, userCount: 0 }
  const sql = await db()
  const [{ org_count }]  = await sql<{ org_count: number }[]>`SELECT COUNT(*)::int as org_count FROM clerk_organizations`
  const [{ user_count }] = await sql<{ user_count: number }[]>`SELECT COUNT(*)::int as user_count FROM clerk_users`
  return { configured: true, orgCount: org_count, userCount: user_count }
}
