import { NextResponse } from 'next/server'
import { isClerkConfigured, getClerkStatus } from '@/lib/clerk'
import { getSyncMetadata } from '@/lib/db'

export async function GET() {
  const status    = await getClerkStatus()
  const syncMeta  = await getSyncMetadata('clerk')
  return NextResponse.json({
    configured:  status.configured,
    orgCount:    status.orgCount,
    userCount:   status.userCount,
    lastSync:    syncMeta.last_sync_at,
    isConfigured: isClerkConfigured(),
  })
}
