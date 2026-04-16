import { NextResponse } from 'next/server'
import { parseFileToRows, mapMondayRow, upsertMondayRows, analyzeColumns } from '@/lib/services/monday.service'

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const previewOnly = searchParams.get('preview') === 'true'

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Richiesta non valida — invia un file via multipart/form-data' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Nessun file ricevuto' }, { status: 400 })

  const allowedExt = /\.(csv|xlsx|xls|xlsm)$/i
  if (!allowedExt.test(file.name)) {
    return NextResponse.json({ error: 'Formato file non supportato. Usa CSV o XLSX.' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  let rows: Record<string, unknown>[]
  try {
    rows = parseFileToRows(buffer, file.name)
  } catch (e) {
    return NextResponse.json({ error: `Errore parsing file: ${e}` }, { status: 422 })
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Il file non contiene righe' }, { status: 422 })
  }

  // Validate: must have CLIENT ID column
  const hasClientId = rows.some((r) => 'CLIENT ID' in r)
  if (!hasClientId) {
    return NextResponse.json({
      error: 'Colonna "CLIENT ID" non trovata — è obbligatoria per identificare i clienti',
    }, { status: 422 })
  }

  const { mapped: mappedCols, unmapped: unmappedCols } = analyzeColumns(rows)

  if (previewOnly) {
    // Return first 5 rows mapped for preview
    const preview = rows.slice(0, 5).map((r) => {
      const { mapped, clientCode } = mapMondayRow(r)
      return { clientCode, ...mapped }
    })
    return NextResponse.json({
      total_rows: rows.length,
      mapped_columns: mappedCols,
      unmapped_columns: unmappedCols,
      preview,
    })
  }

  // Full import
  const result = await upsertMondayRows(rows)
  return NextResponse.json({
    ...result,
    mapped_columns: mappedCols,
    unmapped_columns: unmappedCols,
  })
}
