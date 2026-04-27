/**
 * One-shot Clerk bootstrap from local machine to Supabase.
 * Bypasses Vercel's 60s function timeout for the initial heavy sync.
 *
 * Run: node scripts/bootstrap-clerk.mjs
 */

import postgres from 'postgres'
import fs from 'node:fs'

const env = fs.readFileSync('.env.local', 'utf8')
const url = env.match(/DATABASE_URL=(.+)/)[1].trim()
const CLERK_SECRET = env.match(/CLERK_SECRET_KEY=(.+)/)[1].trim()
const CLERK_BASE = 'https://api.clerk.com/v1'

if (!CLERK_SECRET) { console.error('✗ CLERK_SECRET_KEY missing'); process.exit(1) }

const sql = postgres(url, { prepare: false, ssl: 'require', max: 5, connect_timeout: 15 })

const headers = { Authorization: `Bearer ${CLERK_SECRET}`, 'Content-Type': 'application/json' }

// ─── Internal email check (mirrors lib/posthog.ts isInternalUser) ───
function isInternal(email) {
  if (!email) return false
  const domain = email.toLowerCase().split('@')[1] || ''
  return domain.includes('witailer') || domain.includes('retex') || domain.includes('alkemy')
}

function parseModules(metadata) {
  if (!metadata) return []
  const m = []
  const isActive = (v) => v && typeof v === 'object' && v.active === true

  if (isActive(metadata.sales))     { m.push('sales'); m.push('asins') }
  if (isActive(metadata.margin))    m.push('margin')
  if (isActive(metadata.inventory)) m.push('inventory')
  if (isActive(metadata.media))     m.push('media')
  if (isActive(metadata.retail))    { m.push('buybox'); m.push('price'); m.push('content'); m.push('voice') }
  if (isActive(metadata.market))    m.push('category')
  if (isActive(metadata.reports))   m.push('quickwins')
  if (isActive(metadata.sellIn))    m.push('sellin')
  if (isActive(metadata.beta))      m.push('beta')

  const media = metadata.media
  if (media && isActive(media.amc)) m.push('amc')
  if (media && isActive(media.dsp)) m.push('dsp')

  const at = metadata.amazonAccountType
  if (at?.seller) m.push('seller')
  if (at?.vendor) m.push('vendor')

  return [...new Set(m)]
}

async function fetchAllOrgs() {
  const all = []
  let offset = 0
  while (true) {
    const res = await fetch(`${CLERK_BASE}/organizations?limit=100&offset=${offset}&include_members_count=true`, { headers })
    if (!res.ok) throw new Error(`Clerk orgs ${res.status}: ${await res.text()}`)
    const data = await res.json()
    all.push(...data.data)
    if (all.length >= data.total_count || data.data.length < 100) break
    offset += 100
  }
  return all
}

async function fetchOrgMembers(orgId) {
  const all = []
  let offset = 0
  while (true) {
    const res = await fetch(`${CLERK_BASE}/organizations/${orgId}/memberships?limit=100&offset=${offset}`, { headers })
    if (!res.ok) throw new Error(`Clerk members ${res.status}: ${await res.text()}`)
    const data = await res.json()
    all.push(...data.data)
    if (all.length >= data.total_count || data.data.length < 100) break
    offset += 100
  }
  return all
}

console.log('Step 1/3 — Fetching organizations from Clerk...')
const orgs = await fetchAllOrgs()
console.log(`  → Found ${orgs.length} organizations`)

console.log('\nStep 2/3 — Fetching members and upserting (batches of 8 in parallel)...')
let totalMembers = 0
let processed = 0
const BATCH = 1 // serialize to avoid deadlocks on shared users across orgs
const errors = []

for (let i = 0; i < orgs.length; i += BATCH) {
  const batch = orgs.slice(i, i + BATCH)
  await Promise.all(batch.map(async (org) => {
    try {
      const members = await fetchOrgMembers(org.id)
      let internal = 0, external = 0

      await sql.begin(async (tsql) => {
        for (const m of members) {
          const pud = m.public_user_data
          const email = pud.identifier ?? null
          const isInt = email ? isInternal(email) : false
          const lastSignIn = pud.last_sign_in_at ? new Date(pud.last_sign_in_at).toISOString() : null
          const createdAt = pud.created_at
            ? new Date(pud.created_at).toISOString()
            : new Date(m.created_at).toISOString()

          await tsql`
            INSERT INTO clerk_users
              (id, org_id, org_slug, email, first_name, last_name, role, is_internal, last_sign_in_at, created_at, last_synced_at)
            VALUES (${pud.user_id}, ${org.id}, ${org.slug}, ${email},
                    ${pud.first_name ?? null}, ${pud.last_name ?? null}, ${m.role},
                    ${isInt ? 1 : 0}, ${lastSignIn}, ${createdAt}, NOW())
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
          if (isInt) internal++; else external++
        }

        const modules    = parseModules(org.public_metadata)
        const currencies = org.public_metadata?.currencies ?? []
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

      totalMembers += members.length
      processed++
      if (processed % 10 === 0) console.log(`  → Processed ${processed}/${orgs.length} orgs (${totalMembers} members so far)`)
    } catch (e) {
      errors.push(`${org.slug ?? org.id}: ${e.message}`)
    }
  }))
}

console.log(`\nStep 3/3 — Recording sync metadata...`)
await sql`
  INSERT INTO sync_metadata (source, sync_type, last_sync_at, records, notes)
  VALUES ('clerk', 'api', NOW(), ${orgs.length}, ${`bootstrap from local: ${totalMembers} members`})
  ON CONFLICT (source) DO UPDATE SET
    sync_type    = EXCLUDED.sync_type,
    last_sync_at = EXCLUDED.last_sync_at,
    records      = EXCLUDED.records,
    notes        = EXCLUDED.notes
`

console.log(`\n✓ Bootstrap complete`)
console.log(`  Orgs:    ${orgs.length}`)
console.log(`  Members: ${totalMembers}`)
console.log(`  Errors:  ${errors.length}`)
if (errors.length > 0) {
  console.log('\nErrors:')
  for (const e of errors) console.log('  -', e)
}

await sql.end()
