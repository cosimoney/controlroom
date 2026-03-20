'use client'
import { useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { ArrowLeft, Upload, CheckCircle2, AlertTriangle, Loader2, FileSpreadsheet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface PreviewData {
  total_rows: number
  mapped_columns: string[]
  unmapped_columns: string[]
  preview: Record<string, unknown>[]
}

interface ImportResult {
  synced: number
  created: number
  updated: number
  skipped: number
  errors: string[]
  mapped_columns: string[]
  unmapped_columns: string[]
}

export default function ImportMondayPage() {
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (f: File) => {
    setFile(f)
    setPreview(null)
    setResult(null)
    setError(null)
    setLoading(true)

    try {
      const fd = new FormData()
      fd.append('file', f)
      const res = await fetch('/api/monday/import-csv?preview=true', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Errore parsing file'); return }
      setPreview(data as PreviewData)
    } catch {
      setError('Errore di rete durante il caricamento')
    } finally {
      setLoading(false)
    }
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  const handleImport = async () => {
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/monday/import-csv', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Errore import'); return }
      setResult(data as ImportResult)
      setPreview(null)
      toast.success(`✓ Import completato — ${data.synced} clienti (${data.created} nuovi, ${data.updated} aggiornati)`)
    } catch {
      setError('Errore di rete durante import')
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setFile(null); setPreview(null); setResult(null); setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="min-h-screen" style={{ background: '#020617' }}>
      <header className="border-b sticky top-0 z-40" style={{ borderColor: '#1e293b', background: 'rgba(2,6,23,0.9)', backdropFilter: 'blur(8px)' }}>
        <div className="max-w-[900px] mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/"><button className="h-8 w-8 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"><ArrowLeft className="h-4 w-4" /></button></Link>
          <span className="text-slate-500 text-sm">/</span>
          <span className="text-white font-semibold">Import da Monday</span>
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-4 py-8 space-y-6">

        {/* Instructions */}
        <div className="rounded-lg border p-4 space-y-2" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
          <p className="text-sm font-semibold text-slate-200">Come esportare da Monday</p>
          <ol className="text-sm text-slate-400 space-y-1 list-decimal list-inside">
            <li>Apri il board clienti su Monday</li>
            <li>Clicca <code className="text-slate-300 bg-slate-800 px-1 rounded text-xs">···</code> (menu board) → <strong className="text-slate-300">Export board to Excel</strong></li>
            <li>Scarica il file .xlsx o .csv</li>
            <li>Trascinalo qui sotto o selezionalo</li>
          </ol>
          <p className="text-xs text-slate-500 mt-1">Monday è il master per l&apos;anagrafica — i dati sovrascrivono quelli locali. Touchpoints, bug e usage rimangono intatti.</p>
        </div>

        {/* Drop zone */}
        {!preview && !result && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className="rounded-lg border-2 border-dashed p-12 flex flex-col items-center justify-center gap-3 cursor-pointer transition-colors"
            style={{
              borderColor: dragging ? '#6366f1' : '#334155',
              background: dragging ? 'rgba(99,102,241,0.05)' : '#0a0f1e',
            }}
          >
            <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,.xlsm" className="hidden" onChange={onInputChange} />
            {loading ? (
              <Loader2 className="h-8 w-8 text-indigo-400 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-10 w-10 text-slate-500" />
            )}
            <div className="text-center">
              <p className="text-slate-300 font-medium">{loading ? 'Analisi in corso...' : 'Trascina il file qui'}</p>
              <p className="text-slate-500 text-sm mt-0.5">oppure clicca per selezionare · CSV o XLSX</p>
            </div>
            {file && !loading && <p className="text-xs text-indigo-400">{file.name}</p>}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Preview step */}
        {preview && !result && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-200">Anteprima — {preview.total_rows} righe rilevate</p>
                <p className="text-xs text-slate-500">{preview.mapped_columns.length} colonne mappate</p>
              </div>

              {/* Mapped columns */}
              <div>
                <p className="text-xs text-slate-500 mb-1.5">Colonne mappate su Monday</p>
                <div className="flex flex-wrap gap-1.5">
                  {preview.mapped_columns.map((c) => (
                    <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30">{c}</span>
                  ))}
                </div>
              </div>

              {/* Unmapped columns */}
              {preview.unmapped_columns.length > 0 && (
                <div>
                  <p className="text-xs text-slate-500 mb-1.5">Colonne ignorate (non presenti nel mapping)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.unmapped_columns.map((c) => (
                      <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-slate-700/50 text-slate-500 border border-slate-700">{c}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Preview table */}
            <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b' }}>
              <div className="px-4 py-2.5 border-b" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Prime {preview.preview.length} righe mappate</p>
              </div>
              <div className="overflow-x-auto" style={{ background: '#0a0f1e' }}>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b" style={{ borderColor: '#1e293b' }}>
                      {['client_code', 'name', 'tier', 'arr', 'service_end', 'monday_health', 'client_manager'].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-slate-500 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview.map((row, i) => (
                      <tr key={i} className="border-b" style={{ borderColor: '#1e293b' }}>
                        {['client_code', 'name', 'tier', 'arr', 'service_end', 'monday_health', 'client_manager'].map((h) => (
                          <td key={h} className="px-3 py-2 text-slate-300 whitespace-nowrap">
                            {row[h] !== null && row[h] !== undefined && row[h] !== '' ? String(row[h]) : <span className="text-slate-700">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={handleImport} disabled={loading}>
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Importando...</> : <><Upload className="h-4 w-4" /> Importa {preview.total_rows} clienti</>}
              </Button>
              <Button variant="ghost" onClick={reset}>Annulla</Button>
            </div>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-4">
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-5" style={{}}>
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="h-5 w-5 text-green-400" />
                <p className="text-sm font-semibold text-green-300">Import completato</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Totale processati" value={result.synced} color="text-white" />
                <Stat label="Nuovi clienti" value={result.created} color="text-green-400" />
                <Stat label="Aggiornati" value={result.updated} color="text-blue-400" />
                <Stat label="Saltati" value={result.skipped} color="text-slate-400" />
              </div>
              {result.errors.length > 0 && (
                <div className="mt-3 space-y-1">
                  {result.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-400">{e}</p>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Link href="/"><Button>Vai alla dashboard</Button></Link>
              <Button variant="outline" onClick={reset}>Importa un altro file</Button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded border p-3 text-center" style={{ borderColor: '#1e293b', background: 'rgba(0,0,0,0.3)' }}>
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  )
}
