import { NextResponse } from 'next/server'
import { syncNotionBugs } from '@/lib/services/notion.service'

export const maxDuration = 300

export async function POST() {
  try {
    const result = await syncNotionBugs()
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }
}
