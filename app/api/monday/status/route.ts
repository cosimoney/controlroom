import { NextResponse } from 'next/server'
import { getMondayStatus } from '@/lib/services/monday.service'

export async function GET() {
  const status = getMondayStatus()
  return NextResponse.json(status)
}
