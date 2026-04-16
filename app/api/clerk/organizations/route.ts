import { NextResponse } from 'next/server'
import { getClerkOrgBySlug } from '@/lib/clerk'
import { db } from '@/lib/db'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const slug = searchParams.get('slug')

  if (slug) {
    const data = await getClerkOrgBySlug(slug)
    return NextResponse.json(data)
  }

  // Return all orgs joined with client data
  const sql = await db()
  const rows = await sql`
    SELECT co.*, c.name AS client_name, c.tier, c.arr
    FROM clerk_organizations co
    LEFT JOIN clients c ON LOWER(TRIM(c.client_code)) = LOWER(TRIM(co.slug))
    ORDER BY c.tier ASC NULLS LAST, c.arr DESC NULLS LAST
  `

  return NextResponse.json(rows)
}
