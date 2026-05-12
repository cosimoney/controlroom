'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, TrendingDown, TrendingUp, Minus, ChevronUp, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sparkline } from '@/components/ui/sparkline'
import { TIER_STYLES } from '@/lib/health'

interface TrendRow {
  client_id: number
  client_name: string
  client_code: string
  tier: number | null
  arr: number | null
  sessions_current: number
  sessions_previous: number
  delta_pct: number | null
  weekly_sessions: number[]
}

function deltaColor(pct: number | null): string {
  if (pct === null) return 'text-slate-500'
  if (pct <= -50) return 'text-red-400'
  if (pct <= -25) return 'text-orange-400'
  if (pct <= -10) return 'text-yellow-400'
  if (pct >= 10)  return 'text-green-400'
  return 'text-slate-400'
}

function deltaBg(pct: number | null): string {
  if (pct === null) return 'bg-slate-800/40 text-slate-500'
  if (pct <= -50) return 'bg-red-500/15 text-red-400'
  if (pct <= -25) return 'bg-orange-500/15 text-orange-400'
  if (pct <= -10) return 'bg-yellow-500/15 text-yellow-400'
  if (pct >= 10)  return 'bg-green-500/15 text-green-400'
  return 'bg-slate-800/40 text-slate-400'
}

function sparklineColor(pct: number | null): string {
  if (pct === null) return '#64748b'
  if (pct <= -50) return '#f87171'
  if (pct <= -25) return '#fb923c'
  if (pct <= -10) return '#facc15'
  if (pct >= 10)  return '#4ade80'
  return '#94a3b8'
}

function DeltaIcon({ pct }: { pct: number | null }) {
  if (pct === null) return <Minus className="h-3 w-3" />
  if (pct <= -10) return <TrendingDown className="h-3 w-3" />
  if (pct >= 10) return <TrendingUp className="h-3 w-3" />
  return <Minus className="h-3 w-3" />
}

const PAGE_SIZE = 15

type KpiFilter = 'declining' | 'stable' | 'growing' | null
type SortDir = 'asc' | 'desc'

export default function TrendsPage() {
  const [data, setData]           = useState<TrendRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const [days, setDays]           = useState(30)
  const [filterTier, setFilterTier] = useState<string>('all')
  const [kpiFilter, setKpiFilter] = useState<KpiFilter>(null)
  const [sortDelta, setSortDelta] = useState<SortDir | null>(null)
  const [page, setPage]           = useState(0)

  const fetchTrends = useCallback(async () => {
    setLoading(true)
    setError(null)
    setPage(0)
    try {
      const res = await fetch(`/api/trends?days=${days}`)
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? 'Errore nel caricamento')
        return
      }
      const json = await res.json()
      setData(json.clients ?? [])
    } catch {
      setError('Errore di rete')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { fetchTrends() }, [fetchTrends])

  // Tier-filtered (drives KPI counts — independent from KPI box selection)
  const tierFiltered = data
    .filter((c) => filterTier === 'all' || String(c.tier) === filterTier)

  const declining  = tierFiltered.filter((c) => c.delta_pct !== null && c.delta_pct <= -10).length
  const stable     = tierFiltered.filter((c) => c.delta_pct !== null && c.delta_pct > -10 && c.delta_pct < 10).length
  const growing    = tierFiltered.filter((c) => c.delta_pct !== null && c.delta_pct >= 10).length

  // Table data: tier filter + KPI filter + sort
  const filtered = tierFiltered
    .filter((c) => {
      if (!kpiFilter) return true
      if (c.delta_pct === null) return false
      if (kpiFilter === 'declining') return c.delta_pct <= -10
      if (kpiFilter === 'stable')    return c.delta_pct > -10 && c.delta_pct < 10
      return c.delta_pct >= 10
    })
    .sort((a, b) => {
      if (!sortDelta) return 0
      // Nulls always at end regardless of direction
      if (a.delta_pct === null && b.delta_pct === null) return 0
      if (a.delta_pct === null) return 1
      if (b.delta_pct === null) return -1
      return sortDelta === 'desc' ? b.delta_pct - a.delta_pct : a.delta_pct - b.delta_pct
    })

  function toggleKpiFilter(id: Exclude<KpiFilter, null>) {
    setKpiFilter((cur) => (cur === id ? null : id))
    setPage(0)
  }

  function toggleSortDelta() {
    setSortDelta((cur) => (cur === 'desc' ? 'asc' : cur === 'asc' ? null : 'desc'))
    setPage(0)
  }

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const shown = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="min-h-screen p-3 md:p-4 space-y-3" style={{ background: '#020817', color: '#f1f5f9' }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white">Usage Trends</h1>
            <p className="text-xs text-slate-500 mt-0.5">Andamento sessioni external vs periodo precedente</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}
            className="h-9 rounded-md border px-3 text-sm outline-none"
            style={{ borderColor: '#334155', background: '#1e293b', color: '#f1f5f9' }}>
            <option value={30}>30 giorni</option>
            <option value={60}>60 giorni</option>
            <option value={90}>90 giorni</option>
          </select>
          <select value={filterTier} onChange={(e) => { setFilterTier(e.target.value); setPage(0) }}
            className="h-9 rounded-md border px-3 text-sm outline-none"
            style={{ borderColor: '#334155', background: '#1e293b', color: '#f1f5f9' }}>
            <option value="all">Tutti i Tier</option>
            <option value="1">Tier 1</option>
            <option value="2">Tier 2</option>
            <option value="3">Tier 3</option>
          </select>
          <Button onClick={fetchTrends} disabled={loading} size="sm" variant="outline" className="border-slate-700 text-slate-300">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />Aggiorna
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {/* Summary KPIs — clickable filters */}
      {!loading && !error && (
        <div className="grid grid-cols-3 gap-3">
          <button
            onClick={() => toggleKpiFilter('declining')}
            className="rounded-lg border p-4 bg-red-500/10 text-red-400 text-left transition-all hover:bg-red-500/15"
            style={{
              borderColor: kpiFilter === 'declining' ? 'rgba(248,113,113,0.6)' : 'rgba(255,255,255,0.1)',
              boxShadow:   kpiFilter === 'declining' ? '0 0 0 1px rgba(248,113,113,0.4)' : 'none',
            }}>
            <p className="text-2xl font-bold tabular-nums">{declining}</p>
            <p className="text-xs mt-1 opacity-80"><TrendingDown className="h-3 w-3 inline mr-1" />In calo (&gt;10%)</p>
          </button>
          <button
            onClick={() => toggleKpiFilter('stable')}
            className="rounded-lg border p-4 bg-slate-800/40 text-slate-400 text-left transition-all hover:bg-slate-800/60"
            style={{
              borderColor: kpiFilter === 'stable' ? 'rgba(148,163,184,0.6)' : 'rgba(255,255,255,0.1)',
              boxShadow:   kpiFilter === 'stable' ? '0 0 0 1px rgba(148,163,184,0.4)' : 'none',
            }}>
            <p className="text-2xl font-bold tabular-nums">{stable}</p>
            <p className="text-xs mt-1 opacity-80"><Minus className="h-3 w-3 inline mr-1" />Stabili (±10%)</p>
          </button>
          <button
            onClick={() => toggleKpiFilter('growing')}
            className="rounded-lg border p-4 bg-green-500/10 text-green-400 text-left transition-all hover:bg-green-500/15"
            style={{
              borderColor: kpiFilter === 'growing' ? 'rgba(74,222,128,0.6)' : 'rgba(255,255,255,0.1)',
              boxShadow:   kpiFilter === 'growing' ? '0 0 0 1px rgba(74,222,128,0.4)' : 'none',
            }}>
            <p className="text-2xl font-bold tabular-nums">{growing}</p>
            <p className="text-xs mt-1 opacity-80"><TrendingUp className="h-3 w-3 inline mr-1" />In crescita (&gt;10%)</p>
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b' }}>
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
          <h2 className="text-sm font-semibold text-slate-200">Clienti per variazione sessioni ({days}gg vs {days}gg precedenti)</h2>
          <span className="text-xs text-slate-500">{filtered.length} clienti</span>
        </div>
        <div style={{ background: '#0a0f1e' }}>
          {loading ? (
            <p className="text-slate-500 text-sm px-4 py-8 text-center">Caricamento...</p>
          ) : filtered.length === 0 ? (
            <p className="text-slate-500 text-sm px-4 py-8 text-center">Nessun dato disponibile</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left" style={{ borderColor: '#1e293b' }}>
                    <th className="px-4 py-2 text-slate-500 font-medium">Cliente</th>
                    <th className="px-3 py-2 text-slate-500 font-medium text-center">Tier</th>
                    <th className="px-3 py-2 text-slate-500 font-medium text-right">ARR</th>
                    <th className="px-3 py-2 text-slate-500 font-medium text-right">Sessioni</th>
                    <th className="px-3 py-2 text-slate-500 font-medium text-right">Prec.</th>
                    <th className="px-3 py-2 font-medium text-center">
                      <button onClick={toggleSortDelta} className="inline-flex items-center gap-1 text-slate-500 hover:text-white transition-colors mx-auto">
                        Delta
                        {sortDelta === 'desc' && <ChevronDown className="h-3 w-3 text-indigo-400" />}
                        {sortDelta === 'asc'  && <ChevronUp className="h-3 w-3 text-indigo-400" />}
                        {sortDelta === null   && <ChevronUp className="h-3 w-3 text-slate-700" />}
                      </button>
                    </th>
                    <th className="px-4 py-2 text-slate-500 font-medium text-center">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => {
                    const tierStyle = TIER_STYLES[c.tier ?? 3] ?? TIER_STYLES[3]
                    return (
                      <tr key={c.client_id} className="border-b hover:bg-slate-800/30 transition-colors" style={{ borderColor: '#1e293b' }}>
                        <td className="px-4 py-2">
                          <Link href={`/clients/${c.client_id}`} className="text-indigo-400 hover:text-indigo-300 font-medium text-sm">
                            {c.client_name}
                          </Link>
                          <span className="text-slate-600 text-xs ml-2">{c.client_code}</span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {c.tier ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold"
                              style={{ background: tierStyle.bg, color: tierStyle.text }}>T{c.tier}</span>
                          ) : <span className="text-slate-600">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-300 tabular-nums text-xs">
                          {c.arr ? `€${c.arr >= 1000 ? `${Math.round(c.arr / 1000)}k` : c.arr}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-200 tabular-nums font-semibold">{c.sessions_current}</td>
                        <td className="px-3 py-2 text-right text-slate-500 tabular-nums">{c.sessions_previous}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${deltaBg(c.delta_pct)}`}
                            style={{ borderColor: 'transparent' }}>
                            <DeltaIcon pct={c.delta_pct} />
                            {c.delta_pct !== null ? `${c.delta_pct > 0 ? '+' : ''}${c.delta_pct}%` : 'New'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-center">
                          <Sparkline data={c.weekly_sessions} color={sparklineColor(c.delta_pct)} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-2 border-t" style={{ borderColor: '#1e293b' }}>
                  <span className="text-xs text-slate-500">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} di {filtered.length}</span>
                  <div className="flex gap-1">
                    <button onClick={() => setPage(0)} disabled={page === 0} className="px-2 py-1 text-xs rounded text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">«</button>
                    <button onClick={() => setPage((p) => p - 1)} disabled={page === 0} className="px-2 py-1 text-xs rounded text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">‹</button>
                    {Array.from({ length: totalPages }, (_, i) => (
                      <button key={i} onClick={() => setPage(i)} className={`px-2 py-1 text-xs rounded transition-colors ${i === page ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>{i + 1}</button>
                    ))}
                    <button onClick={() => setPage((p) => p + 1)} disabled={page === totalPages - 1} className="px-2 py-1 text-xs rounded text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">›</button>
                    <button onClick={() => setPage(totalPages - 1)} disabled={page === totalPages - 1} className="px-2 py-1 text-xs rounded text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors">»</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
