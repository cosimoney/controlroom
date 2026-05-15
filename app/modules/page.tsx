'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getModuleSignal } from '@/lib/modules'
import type { ModuleSignalType } from '@/lib/types'

interface ModuleAlert {
  client_id: number
  client_name: string
  client_code: string
  tier: number | null
  arr: number | null
  module_key: string
  module_label: string
  monday_value: number | null
  clerk_enabled: boolean | null
  posthog_views: number
  posthog_sessions: number
  signal: ModuleSignalType
}

const SIGNAL_CONFIG: Record<ModuleSignalType, { icon: string; label: string; bg: string; text: string }> = {
  green:  { icon: '✅', label: 'Attivo e usato',         bg: 'bg-green-500/10',  text: 'text-green-400' },
  yellow: { icon: '⚠️', label: 'Pagato ma non usato',    bg: 'bg-yellow-500/10', text: 'text-yellow-400' },
  red:    { icon: '🔒', label: 'Pagato ma non abilitato',bg: 'bg-red-500/10',    text: 'text-red-400' },
  upsell: { icon: '💡', label: 'Usato senza contratto',  bg: 'bg-blue-500/10',   text: 'text-blue-400' },
  grey:   { icon: '—',  label: 'Non attivo',             bg: 'bg-slate-800/40',  text: 'text-slate-600' },
}

// Suppress unused import warning — getModuleSignal is imported for potential client-side use
void getModuleSignal

type ViewMode = 'alerts' | 'adoption'

export default function ModulesPage() {
  const [alerts, setAlerts]       = useState<ModuleAlert[]>([])
  const [loading, setLoading]     = useState(true)
  const [mode, setMode]                 = useState<ViewMode>('alerts')
  const [days, setDays]                 = useState<30 | 60 | 90>(30)
  const [filterSignal, setFilterSignal] = useState<ModuleSignalType | 'all'>('all')
  const [filterTier, setFilterTier]     = useState<string>('all')
  const [filterModules, setFilterModules] = useState<Set<string>>(new Set())

  useEffect(() => {
    setLoading(true)
    fetch(`/api/modules/signals?days=${days}`)
      .then((r) => r.json())
      .then((d) => { setAlerts(d.alerts ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [days])

  // Apply signal + tier + scope filters BEFORE computing chip counts,
  // so the counts reflect what the user sees in context.
  // - alerts mode: only actionable signals (yellow/red/upsell) — exclude green/grey
  // - adoption mode: everything actionable + green — exclude only grey
  const preModuleFiltered = alerts
    .filter((a) => filterSignal === 'all' || a.signal === filterSignal)
    .filter((a) => filterTier === 'all' || String(a.tier) === filterTier)
    .filter((a) => mode === 'adoption' ? a.signal !== 'grey' : (a.signal !== 'grey' && a.signal !== 'green'))

  // Per-module chip data (sorted by count desc, then label asc for stability)
  const moduleCounts: { key: string; label: string; count: number }[] = Object.values(
    preModuleFiltered.reduce<Record<string, { key: string; label: string; count: number }>>((acc, a) => {
      if (!acc[a.module_key]) acc[a.module_key] = { key: a.module_key, label: a.module_label, count: 0 }
      acc[a.module_key].count++
      return acc
    }, {})
  ).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

  const filtered = preModuleFiltered
    .filter((a) => filterModules.size === 0 || filterModules.has(a.module_key))

  function toggleModule(key: string) {
    setFilterModules((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const counts = {
    yellow: alerts.filter((a) => a.signal === 'yellow').length,
    red:    alerts.filter((a) => a.signal === 'red').length,
    upsell: alerts.filter((a) => a.signal === 'upsell').length,
  }

  // Adoption counts computed on the in-scope set (tier + module filters applied).
  // Independent of signal filter so the 3 pillar metrics stay meaningful.
  const adoptionScope = alerts
    .filter((a) => filterTier === 'all' || String(a.tier) === filterTier)
    .filter((a) => a.signal !== 'grey')
    .filter((a) => filterModules.size === 0 || filterModules.has(a.module_key))

  const adoptionCounts = {
    subscribed: adoptionScope.filter((a) => (a.monday_value ?? 0) > 0).length,
    enabled:    adoptionScope.filter((a) => a.clerk_enabled === true).length,
    used:       adoptionScope.filter((a) => a.posthog_views > 0).length,
  }

  function switchMode(next: ViewMode) {
    if (next === mode) return
    // Switching modes: clear signal filter (semantics differ across modes).
    // Keep tier and module chip filters since they apply in both.
    setMode(next)
    setFilterSignal('all')
  }

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-6" style={{ background: '#020817', color: '#f1f5f9' }}>
      {/* Header — title + mode toggle */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white">Module Health</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {mode === 'alerts'
                ? 'Confronto contratto × Clerk × PostHog — segnali azionabili per cliente'
                : 'Esplora quali clienti hanno e usano ogni modulo'}
            </p>
          </div>
        </div>
        {/* Mode toggle (segmented control) */}
        <div className="inline-flex rounded-md border overflow-hidden" style={{ borderColor: '#334155', background: '#1e293b' }}>
          <button
            onClick={() => switchMode('alerts')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === 'alerts' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:text-white'
            }`}
          >
            ⚠ Alert
          </button>
          <button
            onClick={() => switchMode('adoption')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === 'adoption' ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400 hover:text-white'
            }`}
          >
            🔍 Adozione
          </button>
        </div>
      </div>

      {/* Summary KPIs — switch shape per mode */}
      {mode === 'alerts' ? (
        <div className="grid grid-cols-3 gap-3">
          {([
            { signal: 'yellow' as ModuleSignalType, displayLabel: 'Sottoutilizzati', count: counts.yellow },
            { signal: 'red'    as ModuleSignalType, displayLabel: 'Non abilitati',   count: counts.red },
            { signal: 'upsell' as ModuleSignalType, displayLabel: 'Opportunità',     count: counts.upsell },
          ]).map((item) => {
            const cfg = SIGNAL_CONFIG[item.signal]
            return (
              <button
                key={item.signal}
                onClick={() => setFilterSignal(filterSignal === item.signal ? 'all' : item.signal)}
                className={`rounded-lg border p-4 text-left transition-colors ${filterSignal === item.signal ? 'ring-1 ring-current' : ''} ${cfg.bg} ${cfg.text}`}
                style={{ borderColor: 'rgba(255,255,255,0.1)' }}
              >
                <p className="text-2xl font-bold tabular-nums">{item.count}</p>
                <p className="text-xs mt-1 opacity-80">{cfg.icon} {item.displayLabel}</p>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {([
            { icon: '💰', label: 'Sottoscritti', count: adoptionCounts.subscribed, bg: 'bg-indigo-500/10',  text: 'text-indigo-300' },
            { icon: '🔑', label: 'Abilitati',    count: adoptionCounts.enabled,    bg: 'bg-violet-500/10',  text: 'text-violet-300' },
            { icon: '📊', label: 'In uso',       count: adoptionCounts.used,       bg: 'bg-green-500/10',   text: 'text-green-400' },
          ]).map((item) => (
            <div
              key={item.label}
              className={`rounded-lg border p-4 ${item.bg} ${item.text}`}
              style={{ borderColor: 'rgba(255,255,255,0.1)' }}
            >
              <p className="text-2xl font-bold tabular-nums">{item.count}</p>
              <p className="text-xs mt-1 opacity-80">{item.icon} {item.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <select value={days} onChange={(e) => setDays(Number(e.target.value) as 30 | 60 | 90)}
          className="h-9 rounded-md border px-3 text-sm outline-none"
          style={{ borderColor: '#334155', background: '#1e293b', color: '#f1f5f9' }}>
          <option value={30}>Ultimi 30 giorni</option>
          <option value={60}>Ultimi 60 giorni</option>
          <option value={90}>Ultimi 90 giorni</option>
        </select>
        <select value={filterTier} onChange={(e) => setFilterTier(e.target.value)}
          className="h-9 rounded-md border px-3 text-sm outline-none"
          style={{ borderColor: '#334155', background: '#1e293b', color: '#f1f5f9' }}>
          <option value="all">Tutti i Tier</option>
          <option value="1">Tier 1</option>
          <option value="2">Tier 2</option>
          <option value="3">Tier 3</option>
        </select>
        {(filterSignal !== 'all' || filterTier !== 'all' || filterModules.size > 0) && (
          <button onClick={() => { setFilterSignal('all'); setFilterTier('all'); setFilterModules(new Set()) }}
            className="text-xs text-slate-400 hover:text-white transition-colors">
            × Reset filtri
          </button>
        )}
        <span className="text-xs text-slate-500 ml-auto">{filtered.length} {mode === 'alerts' ? 'alert' : 'righe'}</span>
      </div>

      {/* Module filter chips — multi-select, counts respect signal+tier filters */}
      {moduleCounts.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500 uppercase tracking-wider">Filtra per modulo</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilterModules(new Set())}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium border transition-colors ${
                filterModules.size === 0
                  ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                  : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-white hover:border-slate-600'
              }`}
            >
              {filterModules.size === 0 ? '× ' : ''}Tutti
              <span className="opacity-60 tabular-nums">{preModuleFiltered.length}</span>
            </button>
            {moduleCounts.map((m) => {
              const isActive = filterModules.has(m.key)
              return (
                <button
                  key={m.key}
                  onClick={() => toggleModule(m.key)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium border transition-colors ${
                    isActive
                      ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                      : 'bg-slate-800/40 border-slate-700 text-slate-400 hover:text-white hover:border-slate-600'
                  }`}
                >
                  {m.label}
                  <span className="opacity-60 tabular-nums">{m.count}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Table — header and empty state depend on mode */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b' }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
          <h2 className="text-sm font-semibold text-slate-200">
            {mode === 'alerts'
              ? 'Alert moduli — solo segnali azionabili'
              : 'Adozione moduli — copertura contratto, abilitazione e uso'}
          </h2>
        </div>
        <div style={{ background: '#0a0f1e' }}>
          {loading ? (
            <p className="text-slate-500 text-sm px-4 py-8 text-center">Caricamento...</p>
          ) : filtered.length === 0 ? (
            <p className="text-slate-500 text-sm px-4 py-8 text-center">
              {mode === 'alerts' ? 'Nessun alert trovato' : 'Nessun cliente con copertura per il filtro selezionato'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left" style={{ borderColor: '#1e293b' }}>
                  <th className="px-4 py-2 text-slate-500 font-medium">Cliente</th>
                  <th className="px-3 py-2 text-slate-500 font-medium text-center">Tier</th>
                  <th className="px-3 py-2 text-slate-500 font-medium">Modulo</th>
                  <th className="px-3 py-2 text-slate-500 font-medium text-center">💰</th>
                  <th className="px-3 py-2 text-slate-500 font-medium text-center">🔑</th>
                  <th className="px-3 py-2 text-slate-500 font-medium text-right">📊 PV</th>
                  {mode === 'adoption' && (
                    <th className="px-3 py-2 text-slate-500 font-medium text-right" title="Unique sessions in the selected period">🔄 Sess</th>
                  )}
                  <th className="px-4 py-2 text-slate-500 font-medium text-right">Segnale</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a, i) => {
                  const sig = SIGNAL_CONFIG[a.signal]
                  return (
                    <tr key={i} className="border-b hover:bg-slate-800/30 transition-colors" style={{ borderColor: '#1e293b' }}>
                      <td className="px-4 py-2">
                        <Link href={`/clients/${a.client_id}`} className="text-indigo-400 hover:text-indigo-300 font-medium">
                          {a.client_name}
                        </Link>
                        <span className="text-slate-600 text-xs ml-2">{a.client_code}</span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {a.tier ? <span className="text-xs font-bold text-slate-400">T{a.tier}</span> : '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-300">{a.module_label}</td>
                      <td className="px-3 py-2 text-center">
                        {(a.monday_value ?? 0) > 0 ? <span className="text-green-400">✓</span> : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {a.clerk_enabled === null
                          ? <span className="text-slate-600 text-xs">N/D</span>
                          : a.clerk_enabled
                            ? <span className="text-green-400">✓</span>
                            : <span className="text-red-400">✗</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-400 tabular-nums">{a.posthog_views || '—'}</td>
                      {mode === 'adoption' && (
                        <td className="px-3 py-2 text-right text-slate-400 tabular-nums">{a.posthog_sessions || '—'}</td>
                      )}
                      <td className={`px-4 py-2 text-right ${sig.text}`}>{sig.icon} {sig.label}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
