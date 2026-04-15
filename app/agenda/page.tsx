'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, Calendar, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TIER_STYLES } from '@/lib/health'

interface AgendaItem {
  client_id: number
  client_name: string
  client_code: string
  tier: number
  arr: number | null
  last_touchpoint_date: string | null
  days_since_contact: number | null
  next_due_date: string
  weeks_from_now: number
  reasons: string[]
  priority: 'high' | 'medium' | 'low'
  contacted_this_week: boolean
  rolled_over: boolean
}

interface AgendaWeek {
  week_offset: number
  start_date: string
  end_date: string
  capacity: number
  items: AgendaItem[]
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start)
  const e = new Date(end)
  const sameMonth = s.getMonth() === e.getMonth()
  const fmt = (d: Date, withMonth: boolean) =>
    withMonth ? d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : `${d.getDate()}`
  return `${fmt(s, !sameMonth)} – ${fmt(e, true)}`
}

function weekLabel(offset: number): string {
  if (offset === 0) return 'Questa settimana'
  if (offset === 1) return 'Prossima settimana'
  return `Tra ${offset} settimane`
}

const PRIORITY_BADGE: Record<AgendaItem['priority'], { bg: string; text: string; icon: React.ReactNode; label: string }> = {
  high:   { bg: 'bg-red-500/15',    text: 'text-red-400',    icon: <AlertTriangle className="h-3 w-3" />, label: 'High' },
  medium: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', icon: <Calendar className="h-3 w-3" />,      label: 'Medium' },
  low:    { bg: 'bg-slate-800/40',  text: 'text-slate-400',  icon: <CheckCircle2 className="h-3 w-3" />,  label: 'Routine' },
}

export default function AgendaPage() {
  const [weeks, setWeeks]     = useState<AgendaWeek[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [filterTier, setFilterTier] = useState<string>('all')
  const [filterPriority, setFilterPriority] = useState<string>('all')
  const [toggling, setToggling] = useState<number | null>(null)

  const fetchAgenda = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/agenda')
      if (!res.ok) { setError('Errore nel caricamento'); return }
      const data = await res.json()
      setWeeks(data.weeks ?? [])
    } catch {
      setError('Errore di rete')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAgenda() }, [fetchAgenda])

  async function handleToggle(item: AgendaItem) {
    if (item.contacted_this_week || toggling !== null) return
    setToggling(item.client_id)
    try {
      const res = await fetch('/api/touchpoints/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: item.client_id, type: 'feedback', notes: 'Contatto da agenda settimanale' }),
      })
      if (res.ok) {
        await fetchAgenda()
      } else {
        setError('Errore nel salvataggio del contatto')
      }
    } catch {
      setError('Errore di rete nel salvataggio')
    } finally {
      setToggling(null)
    }
  }

  const filteredWeeks = weeks.map((w) => ({
    ...w,
    items: w.items
      .filter((i) => filterTier === 'all' || String(i.tier) === filterTier)
      .filter((i) => filterPriority === 'all' || i.priority === filterPriority),
  }))

  const totalItems = filteredWeeks.reduce((sum, w) => sum + w.items.length, 0)

  return (
    <div className="min-h-screen p-3 md:p-4 space-y-3" style={{ background: '#020817', color: '#f1f5f9' }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white">Agenda contatti</h1>
            <p className="text-xs text-slate-500 mt-0.5">Chi sentire settimana per settimana, basato su cadenza, scadenze e segnali</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={filterTier} onChange={(e) => setFilterTier(e.target.value)}
            className="h-9 rounded-md border px-3 text-sm outline-none"
            style={{ borderColor: '#334155', background: '#1e293b', color: '#f1f5f9' }}>
            <option value="all">Tutti i Tier</option>
            <option value="1">Tier 1</option>
            <option value="2">Tier 2</option>
            <option value="3">Tier 3</option>
          </select>
          <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}
            className="h-9 rounded-md border px-3 text-sm outline-none"
            style={{ borderColor: '#334155', background: '#1e293b', color: '#f1f5f9' }}>
            <option value="all">Tutte le priorità</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Routine</option>
          </select>
          <Button onClick={fetchAgenda} disabled={loading} size="sm" variant="outline" className="border-slate-700 text-slate-300">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />Aggiorna
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {loading ? (
        <p className="text-slate-500 text-sm px-4 py-8 text-center">Caricamento...</p>
      ) : totalItems === 0 ? (
        <p className="text-slate-500 text-sm px-4 py-8 text-center">Nessun contatto suggerito</p>
      ) : (
        <div className="space-y-3">
          {filteredWeeks.map((week) => {
            if (week.items.length === 0) return null
            const pending = week.items.filter((i) => !i.contacted_this_week)
            const done = week.items.filter((i) => i.contacted_this_week)
            const highCount = pending.filter((i) => i.priority === 'high').length
            const capacityUsed = done.length
            const isCurrentWeek = week.week_offset === 0
            return (
              <div key={week.week_offset} className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b' }}>
                <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
                  <div>
                    <h2 className="text-sm font-semibold text-slate-200">
                      {weekLabel(week.week_offset)}
                      <span className="text-xs font-normal text-slate-500 ml-2">{formatDateRange(week.start_date, week.end_date)}</span>
                    </h2>
                  </div>
                  <div className="flex items-center gap-3">
                    {highCount > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded bg-red-500/15 text-red-400 font-medium">
                        {highCount} high
                      </span>
                    )}
                    {isCurrentWeek && (
                      <span className="text-xs text-slate-500 tabular-nums">
                        {capacityUsed}/{week.capacity} fatti
                      </span>
                    )}
                    <span className="text-xs text-slate-500">{week.items.length} clienti</span>
                  </div>
                </div>
                <div style={{ background: '#0a0f1e' }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left" style={{ borderColor: '#1e293b' }}>
                        <th className="px-4 py-2 text-slate-500 font-medium text-xs w-10">Fatto</th>
                        <th className="px-4 py-2 text-slate-500 font-medium text-xs">Cliente</th>
                        <th className="px-3 py-2 text-slate-500 font-medium text-xs text-center">Tier</th>
                        <th className="px-3 py-2 text-slate-500 font-medium text-xs text-right">ARR</th>
                        <th className="px-3 py-2 text-slate-500 font-medium text-xs text-right">Ultimo contatto</th>
                        <th className="px-3 py-2 text-slate-500 font-medium text-xs">Motivi</th>
                        <th className="px-4 py-2 text-slate-500 font-medium text-xs text-right">Priorità</th>
                      </tr>
                    </thead>
                    <tbody>
                      {week.items.map((item) => {
                        const tierStyle = TIER_STYLES[item.tier] ?? TIER_STYLES[3]
                        const badge = PRIORITY_BADGE[item.priority]
                        const isBusy = toggling === item.client_id
                        return (
                          <tr key={item.client_id}
                              className={`border-b hover:bg-slate-800/30 transition-colors ${item.contacted_this_week ? 'opacity-50' : ''}`}
                              style={{ borderColor: '#1e293b' }}>
                            <td className="px-4 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={item.contacted_this_week}
                                disabled={item.contacted_this_week || isBusy || !isCurrentWeek}
                                onChange={() => handleToggle(item)}
                                className="h-4 w-4 rounded border-slate-600 cursor-pointer disabled:cursor-not-allowed accent-indigo-500"
                                title={!isCurrentWeek ? 'Checkable solo nella settimana corrente' : item.contacted_this_week ? 'Già contattato' : 'Segna come contattato (crea touchpoint feedback)'}
                              />
                            </td>
                            <td className="px-4 py-2">
                              <Link href={`/clients/${item.client_id}`} className={`font-medium text-sm ${item.contacted_this_week ? 'text-slate-500 line-through' : 'text-indigo-400 hover:text-indigo-300'}`}>
                                {item.client_name}
                              </Link>
                              <span className="text-slate-600 text-xs ml-2">{item.client_code}</span>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold"
                                style={{ background: tierStyle.bg, color: tierStyle.text }}>T{item.tier}</span>
                            </td>
                            <td className="px-3 py-2 text-right text-slate-300 tabular-nums text-xs">
                              {item.arr ? `€${item.arr >= 1000 ? `${Math.round(item.arr / 1000)}k` : item.arr}` : '—'}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-400 text-xs tabular-nums">
                              {item.days_since_contact !== null ? `${item.days_since_contact}gg fa` : <span className="text-red-400">mai</span>}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1">
                                {item.reasons.map((r, i) => (
                                  <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-400">{r}</span>
                                ))}
                              </div>
                            </td>
                            <td className="px-4 py-2 text-right">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${badge.bg} ${badge.text}`}>
                                {badge.icon}{badge.label}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
