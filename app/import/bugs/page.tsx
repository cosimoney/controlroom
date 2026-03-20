'use client'
import { useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Upload, FileText, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Automatic column mapping for Notion CSV export
const NOTION_AUTO_MAP: Record<string, string> = {
  'Bug Title':   'bug_title',
  'Status':      'status',
  'Priority':    'priority',
  'Modulo':      'modulo',
  'Tool':        'tool',
  'Reported By': 'reported_by',
  'Client Tier': 'client_tier',
  'Assigned To': 'assigned_to',
  'Sprint':      'sprint',
  'Date Reported': 'date_reported',
  'Due Date':    'due_date',
  'Tags':        'tags',
  'Description': 'description',
}

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split(/\r?\n/)
  if (!lines.length) return { headers: [], rows: [] }

  // Handle quoted fields with commas inside
  function parseLine(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    result.push(current.trim())
    return result
  }

  const headers = parseLine(lines[0])
  const rows = lines.slice(1).map(parseLine)
  return { headers, rows }
}

const STATUS_COUNTS: Record<string, string> = {
  'Open': 'text-red-400', 'In Progress': 'text-blue-400',
  'Testing': 'text-purple-400', 'Fixed': 'text-green-400', 'Closed': 'text-slate-400',
}

export default function ImportBugsPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][] } | null>(null)
  const [importing, setImporting] = useState(false)
  const [overwrite, setOverwrite] = useState(true)
  const [result, setResult] = useState<{ imported: number; errors: string[]; breakdown: { status: string; cnt: number }[] } | null>(null)

  function processFile(file: File) {
    if (!file.name.endsWith('.csv')) { toast.error('Carica un file .csv'); return }
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const data = parseCSV(text)
      if (!data.headers.length) { toast.error('File CSV vuoto o non valido'); return }
      setParsed(data)
      setResult(null)
    }
    reader.readAsText(file)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [])

  // Check how well this CSV maps to the expected Notion columns
  const mappedCount = parsed ? parsed.headers.filter((h) => NOTION_AUTO_MAP[h]).length : 0
  const hasBugTitle = parsed?.headers.includes('Bug Title') ?? false
  const hasReportedBy = parsed?.headers.includes('Reported By') ?? false

  async function handleImport() {
    if (!parsed) return
    setImporting(true)
    try {
      // Build rows as key→value objects using auto-map
      const rows = parsed.rows.map((row) => {
        const obj: Record<string, string> = {}
        parsed.headers.forEach((h, i) => {
          const field = NOTION_AUTO_MAP[h]
          if (field) obj[field] = row[i] ?? ''
        })
        return obj
      }).filter((r) => r.bug_title?.trim()) // skip empty rows

      const res = await fetch('/api/bugs/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, overwrite }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setResult(data)
      if (data.imported > 0) toast.success(`${data.imported} bug importati!`)
    } catch {
      toast.error("Errore durante l'import")
    } finally { setImporting(false) }
  }

  const preview = parsed?.rows.slice(0, 5) ?? []
  const reportedByCol = parsed?.headers.indexOf('Reported By') ?? -1

  // Find unique "Reported By" values in the data to show preview
  const uniqueReportedBy = parsed
    ? [...new Set(parsed.rows.map((r) => r[reportedByCol] ?? '').filter(Boolean))].slice(0, 8)
    : []

  return (
    <div className="min-h-screen" style={{ background: '#020617' }}>
      <header className="border-b sticky top-0 z-40" style={{ borderColor: '#1e293b', background: 'rgba(2,6,23,0.9)', backdropFilter: 'blur(8px)' }}>
        <div className="max-w-[900px] mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/"><button className="h-8 w-8 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"><ArrowLeft className="h-4 w-4" /></button></Link>
          <span className="text-slate-500 text-sm">/</span>
          <span className="text-white font-semibold">Import Bug CSV (Notion)</span>
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-white">Importa bug da Notion</h1>
          <p className="text-sm text-slate-400 mt-1">
            Esporta il database "Bug Tracker" da Notion (menu → Export → CSV) e carica il file qui sotto.
            Le colonne vengono mappate automaticamente dai nomi delle proprietà Notion.
          </p>
        </div>

        {/* Instructions */}
        <div className="rounded-lg border p-4 space-y-2" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Come esportare da Notion</p>
          <ol className="text-sm text-slate-400 space-y-1 list-decimal list-inside">
            <li>Apri il database "Bug Tracker" su Notion</li>
            <li>Clicca <kbd className="text-xs bg-slate-700 px-1.5 py-0.5 rounded">...</kbd> (menu in alto a destra)</li>
            <li>Scegli <strong className="text-slate-300">Export</strong> → formato <strong className="text-slate-300">CSV</strong></li>
            <li>Scarica il file e trascinalo qui sotto</li>
          </ol>
          <p className="text-xs text-slate-500 mt-2">
            Colonne riconosciute automaticamente: {Object.keys(NOTION_AUTO_MAP).join(', ')}
          </p>
        </div>

        {/* Drop zone */}
        <div
          className={`rounded-lg border-2 border-dashed p-12 text-center cursor-pointer transition-colors ${dragging ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 hover:border-slate-500'}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <Upload className="h-10 w-10 text-slate-500 mx-auto mb-3" />
          <p className="text-slate-300 font-medium">
            {parsed
              ? <span className="text-green-400">✓ {parsed.rows.length} righe caricate — {mappedCount}/{parsed.headers.length} colonne riconosciute</span>
              : 'Trascina il CSV di Notion qui o clicca per sfogliare'}
          </p>
          <p className="text-xs text-slate-500 mt-1">Solo file .csv</p>
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f) }} />
        </div>

        {parsed && !result && (
          <>
            {/* Validation warnings */}
            <div className="space-y-2">
              {!hasBugTitle && (
                <div className="flex items-center gap-2 text-sm text-red-400 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
                  <XCircle className="h-4 w-4 shrink-0" />
                  <span>Colonna "Bug Title" non trovata. Verifica che stai usando il CSV esportato da Notion.</span>
                </div>
              )}
              {!hasReportedBy && (
                <div className="flex items-center gap-2 text-sm text-yellow-400 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Colonna "Reported By" non trovata. I bug non saranno collegati ai clienti.</span>
                </div>
              )}
              {hasReportedBy && uniqueReportedBy.length > 0 && (
                <div className="flex items-start gap-2 text-sm text-slate-400 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-400 mt-0.5" />
                  <span>Codici cliente trovati: <span className="font-mono text-slate-300">{uniqueReportedBy.join(', ')}</span></span>
                </div>
              )}
            </div>

            {/* Preview table */}
            <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b' }}>
              <div className="px-4 py-2.5 border-b text-xs font-semibold text-slate-400 uppercase tracking-wider" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
                Anteprima prime {preview.length} righe
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
                      {parsed.headers.map((h) => (
                        <th key={h} className="text-left px-3 py-2 whitespace-nowrap">
                          <span className={NOTION_AUTO_MAP[h] ? 'text-green-400' : 'text-slate-600'}>{h}</span>
                          {NOTION_AUTO_MAP[h] && <span className="ml-1 text-slate-600">→ {NOTION_AUTO_MAP[h]}</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-b" style={{ borderColor: '#1e293b' }}>
                        {row.map((cell, j) => (
                          <td key={j} className="px-3 py-2 text-slate-300 whitespace-nowrap max-w-[200px] truncate">{cell || <span className="text-slate-600">—</span>}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Options & import */}
            <div className="rounded-lg border p-4 space-y-4" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(e) => setOverwrite(e.target.checked)}
                  className="w-4 h-4 rounded accent-indigo-500"
                />
                <div>
                  <p className="text-sm text-slate-200 font-medium">Sovrascrivi bug esistenti (import CSV)</p>
                  <p className="text-xs text-slate-500">Elimina tutti i bug precedentemente importati via CSV prima di importare. Consigliato per re-import settimanale.</p>
                </div>
              </label>

              <div className="flex gap-3">
                <Button onClick={handleImport} disabled={importing || !hasBugTitle}>
                  <Upload className="h-4 w-4" />
                  {importing ? 'Importazione...' : `Importa ${parsed.rows.length} bug`}
                </Button>
                <Button variant="ghost" onClick={() => setParsed(null)}>Annulla</Button>
              </div>
            </div>
          </>
        )}

        {/* Result */}
        {result && (
          <div className="rounded-lg border p-5 space-y-4" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
            <div className="flex items-center gap-2 text-green-400">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-semibold text-lg">{result.imported} bug importati con successo</span>
            </div>

            {/* Breakdown by status */}
            {result.breakdown.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {result.breakdown.map((b) => (
                  <span key={b.status} className={`text-sm font-medium tabular-nums ${STATUS_COUNTS[b.status] ?? 'text-slate-400'}`}>
                    {b.cnt} {b.status}
                  </span>
                )).reduce((acc, el, i) => i === 0 ? [el] : [...acc, <span key={`sep-${i}`} className="text-slate-600">·</span>, el], [] as React.ReactNode[])}
              </div>
            )}

            {result.errors.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Errori ({result.errors.length})</p>
                {result.errors.slice(0, 10).map((err, i) => (
                  <div key={i} className="flex items-start gap-2 text-red-400 text-sm"><XCircle className="h-4 w-4 shrink-0 mt-0.5" /><span>{err}</span></div>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              <Button onClick={() => router.push('/')}>Torna alla dashboard</Button>
              <Button variant="outline" onClick={() => router.push('/bugs')}>Vedi tutti i bug</Button>
              <Button variant="ghost" onClick={() => { setResult(null); setParsed(null) }}>Importa un altro file</Button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
