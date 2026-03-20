'use client'
import { useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Upload, FileText, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const DB_FIELDS = [
  { value: 'name',          label: 'Nome cliente' },
  { value: 'client_code',   label: 'Codice cliente (es. BARIL)' },
  { value: 'company',       label: 'Azienda' },
  { value: 'pm_assigned',   label: 'PM assegnato' },
  { value: 'contract_type', label: 'Tipo contratto' },
  { value: 'modules_active',label: 'Moduli attivi' },
  { value: 'market',        label: 'Mercato' },
  { value: 'status',        label: 'Status' },
  { value: 'notes',         label: 'Note' },
  { value: '__skip__',      label: '— Ignora colonna —' },
]

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length === 0) return { headers: [], rows: [] }
  const parse = (line: string) =>
    line.split(',').map((cell) => cell.replace(/^"|"$/g, '').trim())
  const headers = parse(lines[0])
  const rows = lines.slice(1).map(parse)
  return { headers, rows }
}

function autoMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  const normalized = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '')
  const fieldNorms: Record<string, string[]> = {
    name:           ['name', 'nome', 'cliente', 'client', 'brand'],
    company:        ['company', 'azienda', 'società', 'societa'],
    pm_assigned:    ['pm', 'pmassigned', 'pmassegnato', 'projectmanager'],
    contract_type:  ['contract', 'contratto', 'contracttype', 'tipo'],
    modules_active: ['modules', 'moduli', 'moduliattivi'],
    market:         ['market', 'mercato', 'country', 'paese'],
    status:         ['status', 'stato'],
    notes:          ['notes', 'note', 'commenti', 'comments'],
  }
  headers.forEach((h) => {
    const n = normalized(h)
    for (const [field, aliases] of Object.entries(fieldNorms)) {
      if (aliases.some((a) => n.includes(a))) { map[h] = field; return }
    }
    map[h] = '__skip__'
  })
  return map
}

export default function ImportPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][] } | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ imported: number; errors: string[] } | null>(null)

  function processFile(file: File) {
    if (!file.name.endsWith('.csv')) { toast.error('Carica un file .csv'); return }
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const data = parseCSV(text)
      if (data.headers.length === 0) { toast.error('File CSV vuoto o non valido'); return }
      setParsed(data)
      setMapping(autoMap(data.headers))
      setResult(null)
    }
    reader.readAsText(file)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [])

  async function handleImport() {
    if (!parsed) return
    setImporting(true)
    try {
      // Build rows from mapping
      const rows = parsed.rows.map((row) => {
        const obj: Record<string, string> = {}
        parsed.headers.forEach((h, i) => {
          const field = mapping[h]
          if (field && field !== '__skip__') obj[field] = row[i] ?? ''
        })
        return obj
      })
      const res = await fetch('/api/import/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setResult(data)
      if (data.imported > 0) toast.success(`${data.imported} clienti importati!`)
    } catch {
      toast.error('Errore durante l\'import')
    } finally {
      setImporting(false)
    }
  }

  const preview = parsed?.rows.slice(0, 5) ?? []

  return (
    <div className="min-h-screen" style={{ background: '#020617' }}>
      <header className="border-b sticky top-0 z-40" style={{ borderColor: '#1e293b', background: 'rgba(2,6,23,0.9)', backdropFilter: 'blur(8px)' }}>
        <div className="max-w-[900px] mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/">
            <button className="h-8 w-8 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Link>
          <span className="text-slate-500 text-sm">/</span>
          <span className="text-white font-semibold">Import CSV</span>
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-white">Importa clienti da CSV</h1>
          <p className="text-sm text-slate-400 mt-1">Carica un file CSV con i dati dei clienti. Le colonne verranno mappate automaticamente.</p>
        </div>

        {/* Drop zone */}
        <div
          className={`rounded-lg border-2 border-dashed p-12 text-center cursor-pointer transition-colors ${
            dragging ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-700 hover:border-slate-500'
          }`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <Upload className="h-10 w-10 text-slate-500 mx-auto mb-3" />
          <p className="text-slate-300 font-medium">
            {parsed ? <span className="text-green-400">✓ {parsed.rows.length} righe caricate</span> : 'Trascina il CSV qui o clicca per sfogliare'}
          </p>
          <p className="text-xs text-slate-500 mt-1">Solo file .csv</p>
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f) }} />
        </div>

        {parsed && (
          <>
            {/* Column mapping */}
            <div className="rounded-lg border p-5 space-y-4" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
              <h2 className="text-sm font-semibold text-slate-200">Mapping colonne CSV → campi database</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {parsed.headers.map((h) => (
                  <div key={h} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                        <span className="text-sm text-slate-300 truncate">{h}</span>
                      </div>
                    </div>
                    <span className="text-slate-600 shrink-0">→</span>
                    <div className="flex-1 min-w-0">
                      <Select value={mapping[h] ?? '__skip__'} onValueChange={(v) => setMapping((p) => ({ ...p, [h]: v }))}>
                        <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DB_FIELDS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </div>
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
                        <th key={h} className="text-left px-3 py-2 text-slate-500 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-b" style={{ borderColor: '#1e293b' }}>
                        {row.map((cell, j) => (
                          <td key={j} className="px-3 py-2 text-slate-300 whitespace-nowrap max-w-[200px] truncate">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Import button */}
            {!result ? (
              <div className="flex gap-3">
                <Button onClick={handleImport} disabled={importing}>
                  <Upload className="h-4 w-4" />
                  {importing ? 'Importazione...' : `Importa ${parsed.rows.length} clienti`}
                </Button>
                <Button variant="ghost" onClick={() => { setParsed(null); setMapping({}) }}>Annulla</Button>
              </div>
            ) : (
              <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
                <div className="flex items-center gap-2 text-green-400">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-semibold">{result.imported} clienti importati con successo</span>
                </div>
                {result.errors.length > 0 && (
                  <div className="space-y-1">
                    {result.errors.map((err, i) => (
                      <div key={i} className="flex items-start gap-2 text-red-400 text-sm">
                        <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>{err}</span>
                      </div>
                    ))}
                  </div>
                )}
                <Button onClick={() => router.push('/')}>Torna alla dashboard</Button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
