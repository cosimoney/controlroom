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

export default function ModulesPage() {
  const [alerts, setAlerts]       = useState<ModuleAlert[]>([])
  const [loading, setLoading]     = useState(true)
  const [filterSignal, setFilterSignal] = useState<ModuleSignalType | 'all'>('all')
  const [filterTier, setFilterTier]     = useState<string>('all')

  useEffect(() => {
    fetch('/api/modules/signals')
      .then((r) => r.json())
      .then((d) => { setAlerts(d.alerts ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const filtered = alerts
    .filter((a) => filterSignal === 'all' || a.signal === filterSignal)
    .filter((a) => filterTier === 'all' || String(a.tier) === filterTier)
    .filter((a) => a.signal !== 'grey' && a.signal !== 'green')  // show only actionable signals

  const counts = {
    yellow: alerts.filter((a) => a.signal === 'yellow').length,
    red:    alerts.filter((a) => a.signal === 'red').length,
    upsell: alerts.filter((a) => a.signal === 'upsell').length,
  }

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-6" style={{ background: '#020817', color: '#f1f5f9' }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/" className="text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-white">Module Health</h1>
          <p className="text-xs text-slate-500 mt-0.5">Confronto contratto × Clerk × PostHog per tutti i clienti</p>
        </div>
      </div>

      {/* Summary KPIs */}
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

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <select value={filterTier} onChange={(e) => setFilterTier(e.target.value)}
          className="h-9 rounded-md border px-3 text-sm outline-none"
          style={{ borderColor: '#334155', background: '#1e293b', color: '#f1f5f9' }}>
          <option value="all">Tutti i Tier</option>
          <option value="1">Tier 1</option>
          <option value="2">Tier 2</option>
          <option value="3">Tier 3</option>
        </select>
        {(filterSignal !== 'all' || filterTier !== 'all') && (
          <button onClick={() => { setFilterSignal('all'); setFilterTier('all') }}
            className="text-xs text-slate-400 hover:text-white transition-colors">
            × Reset filtri
          </button>
        )}
        <span className="text-xs text-slate-500 ml-auto">{filtered.length} alert</span>
      </div>

      {/* Alerts table */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b' }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
          <h2 className="text-sm font-semibold text-slate-200">Alert moduli — solo segnali azionabili</h2>
        </div>
        <div style={{ background: '#0a0f1e' }}>
          {loading ? (
            <p className="text-slate-500 text-sm px-4 py-8 text-center">Caricamento...</p>
          ) : filtered.length === 0 ? (
            <p className="text-slate-500 text-sm px-4 py-8 text-center">Nessun alert trovato</p>
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
