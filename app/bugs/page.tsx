'use client'
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, Upload, RefreshCw, ExternalLink, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PRIORITY_COLORS, STATUS_COLORS, OPEN_STATUSES, CLOSED_STATUSES, TIER_STYLES } from '@/lib/health'

interface Bug {
  id: number
  bug_title: string
  status: string
  priority: string
  modulo: string | null
  tool: string | null
  reported_by: string | null
  client_tier: string | null
  assigned_to: string | null
  sprint: string | null
  date_reported: string | null
  due_date: string | null
  tags: string[]
  description: string | null
  source: string | null
  notion_url: string | null
  client_name: string | null
  client_tier_num: number | null
}

interface BugStats {
  total: number
  open: number
  inProgress: number
  testing: number
  fixed: number
  closed: number
  byCritical: number
  byHigh: number
  byMedium: number
  byLow: number
  unmatched: number
}

const PRIORITIES = ['Critical', 'High', 'Medium', 'Low']

function PriorityBadge({ priority }: { priority: string }) {
  const cls = PRIORITY_COLORS[priority] ?? 'bg-slate-500/15 text-slate-400 border-slate-500/30'
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {priority}
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? 'bg-slate-500/15 text-slate-400 border-slate-500/30'
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {status}
    </span>
  )
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

function BugTable({ bugs, showClient = true }: { bugs: Bug[]; showClient?: boolean }) {
  if (!bugs.length) {
    return <div className="py-12 text-center text-slate-500 text-sm">Nessun bug trovato</div>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
            <th className="px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider w-24">Priorità</th>
            <th className="px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Titolo</th>
            {showClient && <th className="px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider w-36">Cliente</th>}
            {showClient && <th className="px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider w-16 hidden sm:table-cell">Tier</th>}
            <th className="px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider w-28">Stato</th>
            <th className="px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider w-28 hidden md:table-cell">Modulo</th>
            <th className="px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider w-28 hidden lg:table-cell">Tool</th>
            <th className="px-3 py-2.5 text-xs font-semibold text-slate-400 uppercase tracking-wider w-28 hidden lg:table-cell">Data</th>
            <th className="px-3 py-2.5 w-8" />
          </tr>
        </thead>
        <tbody>
          {bugs.map((bug) => (
            <tr key={bug.id} className="border-b hover:bg-slate-800/30 transition-colors" style={{ borderColor: '#1e293b' }}>
              <td className="px-3 py-2.5"><PriorityBadge priority={bug.priority} /></td>
              <td className="px-3 py-2.5">
                <span className="text-slate-200 font-medium line-clamp-1">{bug.bug_title}</span>
                {bug.description && (
                  <span className="block text-xs text-slate-500 truncate max-w-xs">{bug.description}</span>
                )}
              </td>
              {showClient && (
                <td className="px-3 py-2.5">
                  {bug.client_name ? (
                    <span className="text-slate-300">{bug.client_name}</span>
                  ) : (
                    <span className="font-mono text-xs text-slate-500">{bug.reported_by ?? '—'}</span>
                  )}
                </td>
              )}
              {showClient && (
                <td className="px-3 py-2.5 hidden sm:table-cell">
                  {bug.client_tier_num != null ? (
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold"
                      style={{ background: TIER_STYLES[bug.client_tier_num]?.bg ?? TIER_STYLES[3].bg, color: TIER_STYLES[bug.client_tier_num]?.text ?? TIER_STYLES[3].text }}
                    >
                      T{bug.client_tier_num}
                    </span>
                  ) : <span className="text-slate-600">—</span>}
                </td>
              )}
              <td className="px-3 py-2.5"><StatusBadge status={bug.status} /></td>
              <td className="px-3 py-2.5 text-slate-400 text-xs hidden md:table-cell">{bug.modulo ?? '—'}</td>
              <td className="px-3 py-2.5 text-slate-400 text-xs hidden lg:table-cell">{bug.tool ?? '—'}</td>
              <td className="px-3 py-2.5 text-slate-500 text-xs hidden lg:table-cell whitespace-nowrap">{formatDate(bug.date_reported)}</td>
              <td className="px-3 py-2.5">
                {bug.notion_url && (
                  <a
                    href={bug.notion_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-600 hover:text-slate-400 transition-colors"
                    title="Apri in Notion"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function BugsPage() {
  const [tab, setTab] = useState<'open' | 'resolved'>('open')
  const [bugs, setBugs] = useState<Bug[]>([])
  const [stats, setStats] = useState<BugStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  // Filters
  const [filterPriority, setFilterPriority] = useState('')
  const [filterModulo, setFilterModulo] = useState('')
  const [filterTool, setFilterTool] = useState('')
  const [filterClient, setFilterClient] = useState('')

  // Unmatched section
  const [unmatchedOpen, setUnmatchedOpen] = useState(false)

  useEffect(() => {
    fetch('/api/bugs/stats').then((r) => r.json()).then(setStats)
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('status', tab === 'open' ? 'open' : 'resolved')
    params.set('limit', '500')
    fetch(`/api/bugs?${params}`).then((r) => r.json()).then((data) => {
      setBugs(data)
      setLoading(false)
    })
  }, [tab])

  // Derived filter options from loaded bugs
  const moduloOptions = useMemo(() => [...new Set(bugs.map((b) => b.modulo).filter(Boolean))].sort() as string[], [bugs])
  const toolOptions   = useMemo(() => [...new Set(bugs.map((b) => b.tool).filter(Boolean))].sort() as string[], [bugs])

  // Separate matched vs unmatched
  const matchedBugs   = useMemo(() => bugs.filter((b) => b.client_name), [bugs])
  const unmatchedBugs = useMemo(() => bugs.filter((b) => !b.client_name), [bugs])

  // Apply filters to matched bugs
  const filtered = useMemo(() => {
    return matchedBugs.filter((b) => {
      if (filterPriority && b.priority !== filterPriority) return false
      if (filterModulo   && b.modulo !== filterModulo)     return false
      if (filterTool     && b.tool !== filterTool)         return false
      if (filterClient) {
        const q = filterClient.toLowerCase()
        const nameMatch = b.client_name?.toLowerCase().includes(q)
        const codeMatch = b.reported_by?.toLowerCase().includes(q)
        if (!nameMatch && !codeMatch) return false
      }
      return true
    })
  }, [matchedBugs, filterPriority, filterModulo, filterTool, filterClient])

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/bugs/sync-notion', { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        alert(`Sincronizzati ${data.synced} bug da Notion`)
        window.location.reload()
      } else {
        alert(data.error ?? 'Errore sincronizzazione')
      }
    } finally {
      setSyncing(false)
    }
  }

  const openCount     = (stats?.open ?? 0) + (stats?.inProgress ?? 0) + (stats?.testing ?? 0)
  const resolvedCount = (stats?.fixed ?? 0) + (stats?.closed ?? 0)

  return (
    <div className="min-h-screen" style={{ background: '#020617' }}>
      {/* Header */}
      <header className="border-b sticky top-0 z-40" style={{ borderColor: '#1e293b', background: 'rgba(2,6,23,0.9)', backdropFilter: 'blur(8px)' }}>
        <div className="max-w-[1100px] mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/">
            <button className="h-8 w-8 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Link>
          <span className="text-slate-500 text-sm">/</span>
          <span className="text-white font-semibold">Bug Overview</span>

          <div className="ml-auto flex items-center gap-2">
            <Link href="/import/bugs">
              <Button variant="outline" className="h-8 text-xs gap-1.5">
                <Upload className="h-3.5 w-3.5" />
                Import CSV
              </Button>
            </Link>
            <Button variant="outline" className="h-8 text-xs gap-1.5" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Sync...' : 'Sync Notion'}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-4 py-6 space-y-5">

        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Aperti" value={openCount} color="text-red-400" />
            <StatCard label="Critici" value={stats.byCritical} color="text-red-500" />
            <StatCard label="In Progress" value={stats.inProgress} color="text-blue-400" />
            <StatCard label="Risolti" value={resolvedCount} color="text-green-400" />
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b" style={{ borderColor: '#1e293b' }}>
          <TabButton active={tab === 'open'} onClick={() => setTab('open')}>
            Aperti {stats ? <span className="ml-1.5 text-xs opacity-60">{openCount}</span> : null}
          </TabButton>
          <TabButton active={tab === 'resolved'} onClick={() => setTab('resolved')}>
            Risolti {stats ? <span className="ml-1.5 text-xs opacity-60">{resolvedCount}</span> : null}
          </TabButton>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <FilterSelect
            value={filterPriority}
            onChange={setFilterPriority}
            options={PRIORITIES}
            placeholder="Tutte le priorità"
          />
          <FilterSelect
            value={filterModulo}
            onChange={setFilterModulo}
            options={moduloOptions}
            placeholder="Tutti i moduli"
          />
          <FilterSelect
            value={filterTool}
            onChange={setFilterTool}
            options={toolOptions}
            placeholder="Tutti i tool"
          />
          <input
            type="text"
            placeholder="Filtra per cliente..."
            value={filterClient}
            onChange={(e) => setFilterClient(e.target.value)}
            className="h-8 px-3 text-sm rounded-md border text-slate-200 placeholder-slate-500 bg-transparent focus:outline-none focus:ring-1 focus:ring-indigo-500"
            style={{ borderColor: '#334155' }}
          />
          {(filterPriority || filterModulo || filterTool || filterClient) && (
            <button
              onClick={() => { setFilterPriority(''); setFilterModulo(''); setFilterTool(''); setFilterClient('') }}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Azzera filtri
            </button>
          )}
          {!loading && (
            <span className="ml-auto text-xs text-slate-500">
              {filtered.length} {filtered.length === 1 ? 'bug' : 'bug'} {filterPriority || filterModulo || filterTool || filterClient ? 'filtrati' : ''}
            </span>
          )}
        </div>

        {/* Main bug table */}
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b' }}>
          {loading ? (
            <div className="py-16 text-center text-slate-500 text-sm">Caricamento...</div>
          ) : (
            <BugTable bugs={filtered} showClient />
          )}
        </div>

        {/* Unmatched section */}
        {unmatchedBugs.length > 0 && (
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#334155' }}>
            <button
              className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-slate-800/30 transition-colors"
              style={{ background: '#0f172a' }}
              onClick={() => setUnmatchedOpen((v) => !v)}
            >
              {unmatchedOpen ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
              <AlertTriangle className="h-4 w-4 text-yellow-400" />
              <span className="text-sm font-medium text-yellow-400">
                {unmatchedBugs.length} bug non collegati a nessun cliente
              </span>
              <span className="text-xs text-slate-500 ml-1">
                — il campo &quot;Reported By&quot; non matcha nessun client_code
              </span>
            </button>
            {unmatchedOpen && (
              <BugTable bugs={unmatchedBugs} showClient={false} />
            )}
          </div>
        )}

        {/* No bugs at all */}
        {!loading && !bugs.length && !unmatchedBugs.length && (
          <div className="rounded-lg border p-8 text-center space-y-3" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
            <p className="text-slate-400 text-sm">Nessun bug trovato nel database.</p>
            <div className="flex justify-center gap-2">
              <Link href="/import/bugs">
                <Button variant="outline" className="gap-1.5">
                  <Upload className="h-4 w-4" />
                  Importa da Notion CSV
                </Button>
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border px-4 py-3" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center ${
        active
          ? 'border-indigo-500 text-white'
          : 'border-transparent text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

function FilterSelect({
  value, onChange, options, placeholder,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 px-2 pr-6 text-sm rounded-md border text-slate-200 bg-transparent focus:outline-none focus:ring-1 focus:ring-indigo-500 appearance-none"
      style={{ borderColor: '#334155', background: '#0f172a' }}
    >
      <option value="" style={{ background: '#0f172a' }}>{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o} style={{ background: '#0f172a' }}>{o}</option>
      ))}
    </select>
  )
}
