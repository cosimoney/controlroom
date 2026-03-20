import { NextResponse } from 'next/server'
import { isMondayConfigured, syncFromMondayApi } from '@/lib/services/monday.service'

export async function POST() {
  if (!isMondayConfigured()) {
    return NextResponse.json(
      { error: 'Monday API non configurato. Aggiungi MONDAY_API_TOKEN e MONDAY_BOARD_ID in .env.local' },
      { status: 503 },
    )
  }

  try {
    const result = await syncFromMondayApi()
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
