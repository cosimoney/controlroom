'use client'
import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TIER_STYLES } from '@/lib/health'
import type { ClientWithStats } from '@/lib/types'

function formatArr(v: number | null): string {
  if (!v || v === 0) return '—'
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `€${Math.round(v / 1_000)}k`
  return `€${Math.round(v)}`
}

function formatDate(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  return Math.floor((new Date(dateStr).getTime() - Date.now()) / 86400000)
}

function ServiceEndCell({ dateStr }: { dateStr: string | null }) {
  if (!dateStr) return <span className="text-slate-600 text-xs">—</span>
  const days = daysUntil(dateStr)
  if (days === null) return <span className="text-slate-600 text-xs">—</span>
  const color = days < 0 ? 'text-red-400' : days <= 60 ? 'text-red-400' : days <= 90 ? 'text-yellow-400' : 'text-green-400'
  const label = days < 0 ? `Scaduto ${Math.abs(days)}gg fa` : days === 0 ? 'Scade oggi' : `${days}gg`
  return (
    <div>
      <span className={`text-xs font-semibold tabular-nums ${color}`}>{label}</span>
      <div className="text-xs text-slate-500">{formatDate(dateStr)}</div>
    </div>
  )
}

function MondayHealthBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-slate-600 text-xs">—</span>
  const lower = value.toLowerCase()
  const cls = lower.includes('good') || lower.includes('green')
    ? 'bg-green-500/15 text-green-400 border-green-500/30'
    : lower.includes('bad') || lower.includes('red') || lower.includes('risk')
    ? 'bg-red-500/15 text-red-400 border-red-500/30'
    : lower.includes('medium') || lower.includes('yellow') || lower.includes('warn')
    ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
    : 'bg-slate-500/15 text-slate-400 border-slate-500/30'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>{value}</span>
}

export default function ContractsPage() {
  const [clients, setClients] = useState<ClientWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [filterExpiry, setFilterExpiry] = useState('all')
  const [filterChurn, setFilterChurn] = useState('all')
  const [filterTier, setFilterTier] = useState('all')

  useEffect(() => {
    fetch('/api/clients').then((r) => r.json()).then((data) => {
      setClients(data)
      setLoading(false)
    })
  }, [])

  const filtered = useMemo(() => {
    return clients
      .filter((c) => filterTier === 'all' || String(c.tier ?? 3) === filterTier)
      .filter((c) => {
        if (filterChurn === 'all') return true
        const hasChurn = c.potential_churn && !['', 'no', '-'].includes(c.potential_churn.toLowerCase().trim())
        return filterChurn === 'yes' ? hasChurn : !hasChurn
      })
      .filter((c) => {
        if (filterExpiry === 'all') return true
        const days = daysUntil(c.service_end)
        if (filterExpiry === '30') return days !== null && days >= 0 && days <= 30
        if (filterExpiry === '60') return days !== null && days >= 0 && days <= 60
        if (filterExpiry === '90') return days !== null && days >= 0 && days <= 90
        if (filterExpiry === 'expired') return days !== null && days < 0
        return true
      })
      .sort((a, b) => {
        // Expired first, then by days until expiry ascending, then null last
        const da = daysUntil(a.service_end)
        const db_ = daysUntil(b.service_end)
        if (da === null && db_ === null) return 0
        if (da === null) return 1
        if (db_ === null) return -1
        return da - db_
      })
  }, [clients, filterTier, filterChurn, filterExpiry])

  // Summary stats
  const totalArr = useMemo(() => clients.filter((c) => c.status === 'active').reduce((s, c) => s + (c.arr ?? 0), 0), [clients])
  const expiring90 = useMemo(() => clients.filter((c) => { const d = daysUntil(c.service_end); return d !== null && d >= 0 && d <= 90 }).length, [clients])
  const churnCount = useMemo(() => clients.filter((c) => c.potential_churn && !['', 'no', '-'].includes(c.potential_churn.toLowerCase().trim())).length, [clients])

  return (
    <div className="min-h-screen" style={{ background: '#020617' }}>
      <header className="border-b sticky top-0 z-40" style={{ borderColor: '#1e293b', background: 'rgba(2,6,23,0.9)', backdropFilter: 'blur(8px)' }}>
        <div className="max-w-[1200px] mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/"><button className="h-8 w-8 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"><ArrowLeft className="h-4 w-4" /></button></Link>
          <span className="text-slate-500 text-sm">/</span>
          <span className="text-white font-semibold">Contract Overview</span>
          <div className="ml-auto flex gap-2">
            <Link href="/import/monday"><Button variant="outline" size="sm"><RefreshCw className="h-3.5 w-3.5" />Import Monday</Button></Link>
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-4 py-6 space-y-5">

        {/* Summary bar */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border p-4 text-center" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
            <p className="text-2xl font-bold text-indigo-400 tabular-nums">{formatArr(totalArr)}</p>
            <p className="text-xs text-slate-500 mt-0.5">ARR totale gestito</p>
          </div>
          <div className="rounded-lg border p-4 text-center" style={{ borderColor: expiring90 > 0 ? 'rgba(234,179,8,0.3)' : '#1e293b', background: '#0f172a' }}>
            <p className="text-2xl font-bold text-yellow-400 tabular-nums">{expiring90}</p>
            <p className="text-xs text-slate-500 mt-0.5">Contratti in scadenza (90gg)</p>
          </div>
          <div className="rounded-lg border p-4 text-center" style={{ borderColor: churnCount > 0 ? 'rgba(239,68,68,0.3)' : '#1e293b', background: '#0f172a' }}>
            <p className="text-2xl font-bold text-red-400 tabular-nums">{churnCount}</p>
            <p className="text-xs text-slate-500 mt-0.5">Potential Churn</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={filterTier} onValueChange={setFilterTier}>
            <SelectTrigger className="w-32"><SelectValue placeholder="Tier" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i Tier</SelectItem>
              <SelectItem value="1">Tier 1</SelectItem>
              <SelectItem value="2">Tier 2</SelectItem>
              <SelectItem value="3">Tier 3</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterExpiry} onValueChange={setFilterExpiry}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Scadenza" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutte le scadenze</SelectItem>
              <SelectItem value="expired">Scaduti</SelectItem>
              <SelectItem value="30">Scade entro 30gg</SelectItem>
              <SelectItem value="60">Scade entro 60gg</SelectItem>
              <SelectItem value="90">Scade entro 90gg</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterChurn} onValueChange={setFilterChurn}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Churn" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti</SelectItem>
              <SelectItem value="yes">⚠ Potential Churn</SelectItem>
              <SelectItem value="no">Nessun rischio churn</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-slate-500 ml-auto">{filtered.length} clienti</span>
        </div>

        {/* Table */}
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
                  <th className="px-3 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap">Cliente</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap w-14">Tier</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap">ARR</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap">Scadenza</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap hidden md:table-cell">Monday Health</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap hidden lg:table-cell">Potential Churn</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap">App Score</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-slate-400 whitespace-nowrap hidden xl:table-cell">Client Manager</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">Caricamento...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    {clients.every((c) => !c.arr && !c.service_end)
                      ? <span>Nessun dato Monday — <Link href="/import/monday" className="text-indigo-400 hover:underline">importa da Monday</Link></span>
                      : 'Nessun cliente trovato con questi filtri'}
                  </td></tr>
                ) : filtered.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b transition-colors"
                    style={{ borderColor: '#1e293b' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#0f172a')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td className="px-3 py-3">
                      <Link href={`/clients/${c.id}`} className="block hover:text-indigo-400 transition-colors">
                        <div className="font-medium text-slate-100">{c.name}</div>
                        {c.client_code && <div className="text-xs font-mono text-slate-500">{c.client_code}</div>}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      {(() => {
                        const t = c.tier ?? 3
                        const s = TIER_STYLES[t] ?? TIER_STYLES[3]
                        return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold" style={{ background: s.bg, color: s.text }}>T{t}</span>
                      })()}
                    </td>
                    <td className="px-3 py-3 text-sm font-semibold text-slate-200 tabular-nums whitespace-nowrap">{formatArr(c.arr)}</td>
                    <td className="px-3 py-3 whitespace-nowrap"><ServiceEndCell dateStr={c.service_end} /></td>
                    <td className="px-3 py-3 hidden md:table-cell"><MondayHealthBadge value={c.monday_health} /></td>
                    <td className="px-3 py-3 hidden lg:table-cell">
                      {c.potential_churn && !['', 'no', '-'].includes(c.potential_churn.toLowerCase().trim())
                        ? <span className="flex items-center gap-1 text-xs text-yellow-400"><AlertTriangle className="h-3 w-3" />{c.potential_churn}</span>
                        : <span className="text-slate-600 text-xs">—</span>}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-block h-2 w-2 rounded-full ${c.health_score >= 80 ? 'bg-green-400' : c.health_score >= 60 ? 'bg-yellow-400' : c.health_score >= 40 ? 'bg-orange-400' : 'bg-red-400'}`} />
                        <span className={`font-semibold tabular-nums text-sm ${c.health_score >= 80 ? 'text-green-400' : c.health_score >= 60 ? 'text-yellow-400' : c.health_score >= 40 ? 'text-orange-400' : 'text-red-400'}`}>{c.health_score}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-400 whitespace-nowrap hidden xl:table-cell">{c.client_manager ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* No Monday data banner */}
        {!loading && clients.length > 0 && clients.every((c) => !c.arr && !c.service_end && !c.monday_health) && (
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-sm text-slate-400">
              Nessun dato Monday presente. <Link href="/import/monday" className="text-indigo-400 hover:underline">Importa il CSV da Monday</Link> per vedere ARR, scadenze contratto e health score Monday.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
