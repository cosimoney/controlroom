'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Plus, Users, AlertCircle, AlertTriangle, Search, ChevronUp, ChevronDown, RefreshCw, Bug, CheckCircle2, Activity, FileText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Combobox } from '@/components/ui/combobox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  getDaysColorClass, getScoreDotClass, getScoreTextClass,
  formatDate, formatTouchpointType, ADOPTION_COLORS, TIER_STYLES,
} from '@/lib/health'
import type { ClientWithStats, DashboardStats, AdoptionLevel } from '@/lib/types'

type SortKey = 'days_since_contact' | 'name' | 'health_score' | 'open_bugs' | 'arr' | 'tier' | 'service_end'
type SortDir = 'asc' | 'desc'

function formatArr(v: number | null): string {
  if (!v || v === 0) return '—'
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `€${Math.round(v / 1_000)}k`
  return `€${Math.round(v)}`
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  return Math.floor((new Date(dateStr).getTime() - Date.now()) / 86400000)
}

export default function DashboardPage() {
  const [clients, setClients]   = useState<ClientWithStats[]>([])
  const [stats, setStats]       = useState<DashboardStats>({
    totalActive: 0, toContact: 0, critical: 0, withCriticalBugs: 0, tier1AtRisk: 0,
    contractsExpiringSoon: 0, potentialChurnCount: 0, totalArr: 0,
    bugsResolvedThisMonth: 0, notionStatus: 'none', lastBugImport: null,
    hasBugData: false, posthogStatus: 'none', hasPostHogData: false,
    mondayStatus: 'none', hasMondayData: false, lastMondaySync: null,
    lastNotionSync: null, lastPosthogSync: null,
    clerkStatus: 'none' as const, hasClerkData: false, lastClerkSync: null,
    duplicateClients: [],
  })
  const [loading, setLoading]         = useState(true)
  const [syncingNotion, setSyncingNotion] = useState(false)
  const [syncingPH, setSyncingPH]     = useState(false)
  const [syncingMonday, setSyncingMonday] = useState(false)
  const [syncingClerk, setSyncingClerk] = useState(false)

  // Filters & sort
  const [search, setSearch]                   = useState('')
  const [filterStatus, setFilterStatus]           = useState('all')
  const [filterPm, setFilterPm]                   = useState('all')
  const [filterTier, setFilterTier]               = useState('all')
  const [filterAdoption, setFilterAdoption]       = useState('all')
  const [filterChurn, setFilterChurn]             = useState('all')
  const [filterClientManager, setFilterClientManager] = useState('all')
  const [activeKpiFilter, setActiveKpiFilter] = useState<string | null>(null)
  const [sortKey, setSortKey]           = useState<SortKey>('arr')
  const [sortDir, setSortDir]           = useState<SortDir>('desc')

  // Quick log
  const [logClientId, setLogClientId] = useState('')
  const [logType, setLogType]         = useState('')
  const [logDate, setLogDate]         = useState('')
  const [logNotes, setLogNotes]       = useState('')
  const [logLoading, setLogLoading]   = useState(false)
  const notesRef = useRef<HTMLInputElement>(null)
  const mondayAutoSynced = useRef(false)
  const today = new Date().toISOString().split('T')[0]

  const fetchAll = useCallback(async () => {
    const [cRes, sRes] = await Promise.all([fetch('/api/clients'), fetch('/api/stats')])
    if (cRes.ok) setClients(await cRes.json())
    if (sRes.ok) setStats(await sRes.json())
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Auto-sync Monday in background if API configured and data > 1 hour old
  useEffect(() => {
    if (mondayAutoSynced.current) return
    if (stats.mondayStatus !== 'api') return
    mondayAutoSynced.current = true
    const ageMs = stats.lastMondaySync
      ? Date.now() - new Date(stats.lastMondaySync).getTime()
      : Infinity
    if (ageMs > 60 * 60 * 1000) {
      fetch('/api/monday/sync', { method: 'POST' }).then((r) => { if (r.ok) fetchAll() })
    }
  }, [stats.mondayStatus, stats.lastMondaySync, fetchAll])

  const pmOptions = [...new Set(clients.map((c) => c.client_manager ?? c.pm_assigned).filter(Boolean))] as string[]
  const clientManagerOptions = [...new Set(clients.map((c) => c.client_manager).filter(Boolean))] as string[]

  const thisMonthStart = new Date(); thisMonthStart.setDate(1); thisMonthStart.setHours(0,0,0,0)

  const filtered = clients
    .filter((c) => filterStatus === 'all' || c.status === filterStatus)
    .filter((c) => filterPm === 'all' || (c.client_manager ?? c.pm_assigned) === filterPm)
    .filter((c) => filterTier === 'all' || String(c.tier ?? 3) === filterTier)
    .filter((c) => filterAdoption === 'all' || c.adoption_level === filterAdoption)
    .filter((c) => filterClientManager === 'all' || c.client_manager === filterClientManager)
    .filter((c) => {
      if (filterChurn === 'all') return true
      const hasChurn = c.potential_churn && !['', 'no', '-'].includes(c.potential_churn.toLowerCase().trim())
      return filterChurn === 'yes' ? hasChurn : !hasChurn
    })
    .filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.client_code?.toLowerCase() ?? '').includes(search.toLowerCase()))
    .filter((c) => {
      if (!activeKpiFilter) return true
      switch (activeKpiFilter) {
        case 'active':      return c.status === 'active'
        case 'to_contact':  return (c.days_since_contact ?? 9999) > 30
        case 'critical':    return (c.days_since_contact ?? 9999) > 60
        case 'tier1_risk':  return (c.tier ?? 3) === 1 && c.health_score < 60
        case 'expiring': {
          const d = daysUntil(c.service_end)
          return d !== null && d >= 0 && d <= 90
        }
        case 'churn':       return !!(c.potential_churn && !['', 'no', '-'].includes(c.potential_churn.toLowerCase().trim()))
        case 'critical_bugs': return (c.critical_bugs ?? 0) > 0 || (c.high_bugs ?? 0) > 0
        case 'bugs_resolved': return (c.resolved_bugs ?? 0) > 0 && !!c.last_touchpoint_date && new Date(c.last_touchpoint_date) >= thisMonthStart
        default:            return true
      }
    })
    .sort((a, b) => {
      if (sortKey === 'name') {
        const va = a.name.toLowerCase(), vb = b.name.toLowerCase()
        return sortDir === 'asc' ? (va < vb ? -1 : va > vb ? 1 : 0) : (vb < va ? -1 : vb > va ? 1 : 0)
      }
      const getVal = (c: ClientWithStats) => {
        if (sortKey === 'days_since_contact') return c.days_since_contact ?? 9999
        if (sortKey === 'open_bugs')   return c.open_bugs ?? 0
        if (sortKey === 'arr')         return c.arr ?? -1
        if (sortKey === 'tier')        return c.tier ?? 3
        if (sortKey === 'service_end') {
          if (!c.service_end) return sortDir === 'asc' ? 99999 : -99999
          return Math.floor((new Date(c.service_end).getTime() - Date.now()) / 86400000)
        }
        return c.health_score
      }
      const diff = sortDir === 'asc' ? getVal(a) - getVal(b) : getVal(b) - getVal(a)
      if (diff === 0) return (a.tier ?? 3) - (b.tier ?? 3)
      return diff
    })

  function toggleSort(key: SortKey) {
    if (sortKey === key) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); return }
    setSortKey(key)
    setSortDir(key === 'name' || key === 'tier' || key === 'service_end' ? 'asc' : 'desc')
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <ChevronUp className="h-3 w-3 text-slate-600" />
    return sortDir === 'asc' ? <ChevronUp className="h-3 w-3 text-indigo-400" /> : <ChevronDown className="h-3 w-3 text-indigo-400" />
  }

  async function handleQuickLog(e: React.FormEvent) {
    e.preventDefault()
    if (!logClientId || !logType) { toast.error('Seleziona cliente e tipo'); return }
    setLogLoading(true)
    try {
      const res = await fetch('/api/touchpoints/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: parseInt(logClientId), type: logType, notes: logNotes || undefined, date: logDate || undefined }),
      })
      if (!res.ok) throw new Error()
      const { client } = await res.json()
      setClients((prev) => prev.map((c) => c.id === client.id ? client : c))
      const name = clients.find((c) => c.id === parseInt(logClientId))?.name ?? ''
      toast.success(`✓ Touchpoint salvato — ${name}, ${logType}`)
      setLogClientId(''); setLogType(''); setLogDate(''); setLogNotes('')
      fetch('/api/stats').then((r) => { if (r.ok) r.json().then(setStats) })
    } catch { toast.error('Errore nel salvataggio') }
    finally { setLogLoading(false) }
  }

  async function handleNotionSync() {
    setSyncingNotion(true)
    try {
      const res = await fetch('/api/bugs/sync-notion', { method: 'POST' })
      if (!res.ok) throw new Error((await res.json()).error)
      const { synced } = await res.json()
      toast.success(`✓ Sync completato — ${synced} bug importati da Notion`)
      fetchAll()
    } catch (e) {
      toast.error(`Errore sync Notion: ${e}`)
    } finally { setSyncingNotion(false) }
  }

  async function handlePostHogSync() {
    setSyncingPH(true)
    try {
      const res = await fetch('/api/posthog/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Errore sync PostHog'); return }
      toast.success(`✓ PostHog sync — ${data.synced} clienti aggiornati`)
      fetchAll()
    } catch { toast.error('Errore sync PostHog') }
    finally { setSyncingPH(false) }
  }

  async function handleMondaySync() {
    setSyncingMonday(true)
    try {
      const res = await fetch('/api/monday/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? 'Errore sync Monday'); return }
      toast.success(`✓ Monday sync — ${data.synced} clienti aggiornati`)
      fetchAll()
    } catch { toast.error('Errore sync Monday') }
    finally { setSyncingMonday(false) }
  }

  async function handleClerkSync() {
    setSyncingClerk(true)
    try {
      const res = await fetch('/api/clerk/sync', { method: 'POST' })
      if (!res.ok) throw new Error()
      const data = await res.json()
      toast.success(`Clerk sync: ${data.orgs} org, ${data.users} utenti`)
      fetch('/api/stats').then((r) => { if (r.ok) r.json().then(setStats) })
    } catch { toast.error('Clerk sync fallito') }
    finally { setSyncingClerk(false) }
  }

  const clientOptions = clients.map((c) => ({ value: String(c.id), label: c.name, sublabel: c.client_code ?? undefined }))
  const notionEnabled = stats.notionStatus === 'live'
  const colCount = 8
    + (stats.hasBugData ? 1 : 0)
    + (stats.hasPostHogData ? 1 : 0)
    + (stats.hasMondayData ? 2 : 0)   // ARR + ServiceEnd

  return (
    <div className="min-h-screen" style={{ background: '#020617' }}>
      {/* Nav */}
      <header className="border-b sticky top-0 z-40" style={{ borderColor: '#1e293b', background: 'rgba(2,6,23,0.9)', backdropFilter: 'blur(8px)' }}>
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-lg font-bold text-white tracking-tight">CSM Command Center</span>
            <span className="text-xs text-slate-500 hidden sm:inline">· Witailer Studio</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Monday badge */}
            <MondayBadge status={stats.mondayStatus} hasMondayData={stats.hasMondayData} lastSync={stats.lastMondaySync} onSync={handleMondaySync} syncing={syncingMonday} />
            {/* Notion badge */}
            <NotionBadge status={stats.notionStatus} lastSync={stats.lastNotionSync} onSync={handleNotionSync} syncing={syncingNotion} />
            {/* PostHog badge */}
            <PostHogBadge status={stats.posthogStatus} lastSync={stats.lastPosthogSync} onSync={handlePostHogSync} syncing={syncingPH} />
            {/* Clerk badge */}
            <ClerkBadge status={stats.clerkStatus} lastSync={stats.lastClerkSync} onSync={handleClerkSync} syncing={syncingClerk} />
            <button onClick={fetchAll} title="Ricarica" className="h-9 w-9 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">
              <RefreshCw className="h-4 w-4" />
            </button>
            <Link href="/users" className="text-xs text-slate-400 hover:text-white transition-colors">Top Users</Link>
            <Link href="/modules" className="text-xs text-slate-400 hover:text-white transition-colors">Moduli</Link>
            <Link href="/contracts"><Button variant="outline" size="sm"><FileText className="h-3.5 w-3.5" />Contratti</Button></Link>
            <Link href="/bugs"><Button variant="outline" size="sm"><Bug className="h-3.5 w-3.5" />Bug</Button></Link>
            <Link href="/import"><Button variant="outline" size="sm">Import CSV</Button></Link>
            <Link href="/clients/new"><Button size="sm"><Plus className="h-4 w-4" />Nuovo cliente</Button></Link>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 py-4 space-y-4">
        {/* Stats row — cliccabili come filtri rapidi */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
          <KpiCard icon={<Users className="h-4 w-4 text-indigo-400" />}         label="Clienti attivi"        value={stats.totalActive}           color="text-white"        filterId="active"        active={activeKpiFilter} onToggle={setActiveKpiFilter} />
          <KpiCard icon={<AlertTriangle className="h-4 w-4 text-yellow-400" />} label="Da contattare (>30gg)" value={stats.toContact}             color="text-yellow-400"   filterId="to_contact"    active={activeKpiFilter} onToggle={setActiveKpiFilter} />
          <KpiCard icon={<AlertCircle className="h-4 w-4 text-red-400" />}      label="Critici (>60gg)"       value={stats.critical}              color="text-red-400"      filterId="critical"      active={activeKpiFilter} onToggle={setActiveKpiFilter} />
          <KpiCard icon={<span className="text-xs font-bold" style={{ color: '#97C459' }}>T1</span>} label="Tier 1 a rischio" value={stats.tier1AtRisk} color="text-red-400" filterId="tier1_risk"   active={activeKpiFilter} onToggle={setActiveKpiFilter} />
          {stats.hasMondayData && <>
            <KpiCard icon={<span className="text-xs text-indigo-400">ARR</span>} label="ARR totale" valueStr={formatArr(stats.totalArr)} color="text-indigo-400" filterId={null} active={activeKpiFilter} onToggle={setActiveKpiFilter} />
            <KpiCard icon={<AlertTriangle className="h-4 w-4 text-yellow-400" />} label="Scadono (90gg)"  value={stats.contractsExpiringSoon} color="text-yellow-400" filterId="expiring"  active={activeKpiFilter} onToggle={setActiveKpiFilter} />
            <KpiCard icon={<AlertCircle className="h-4 w-4 text-red-400" />}    label="Potential Churn" value={stats.potentialChurnCount}   color="text-red-400"    filterId="churn"     active={activeKpiFilter} onToggle={setActiveKpiFilter} />
          </>}
          {stats.hasBugData && <>
            <KpiCard icon={<Bug className="h-4 w-4 text-orange-400" />}         label="Con bug critici"    value={stats.withCriticalBugs}      color="text-orange-400"   filterId="critical_bugs"  active={activeKpiFilter} onToggle={setActiveKpiFilter} />
            <KpiCard icon={<CheckCircle2 className="h-4 w-4 text-green-400" />} label="Bug risolti (mese)" value={stats.bugsResolvedThisMonth} color="text-green-400"    filterId="bugs_resolved"  active={activeKpiFilter} onToggle={setActiveKpiFilter} />
          </>}
        </div>

        {/* Banners */}
        {stats.duplicateClients.length > 0 && (
          <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 px-4 py-3 flex items-start gap-3">
            <span className="text-orange-400 text-lg shrink-0">⚠️</span>
            <div className="text-sm">
              <span className="text-orange-300 font-medium">Clienti duplicati rilevati.</span>
              <span className="text-slate-400 ml-1.5">
                {stats.duplicateClients.length === 1
                  ? 'Il seguente cliente appare più volte come attivo:'
                  : `I seguenti ${stats.duplicateClients.length} clienti appaiono più volte come attivi:`}
              </span>
              <ul className="mt-1.5 space-y-0.5">
                {stats.duplicateClients.map((d) => (
                  <li key={d.name} className="text-xs text-slate-300">
                    <span className="capitalize font-medium">{d.name}</span>
                    <span className="text-slate-500 ml-1.5">({d.count}x — codici: {d.codes})</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-500 mt-1.5">Apri il cliente duplicato e cambia lo status in &quot;Churned&quot; o cancellalo.</p>
            </div>
          </div>
        )}
        {!notionEnabled && !stats.hasBugData && (
          <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 flex items-start gap-3">
            <span className="text-yellow-400 text-lg shrink-0">🔔</span>
            <div className="text-sm">
              <span className="text-yellow-300 font-medium">Bug Notion non configurati.</span>
              <span className="text-slate-400 ml-1.5">
                Importa un CSV → <Link href="/import/bugs" className="text-indigo-400 hover:underline">Import Bug CSV</Link>.
                Per sync automatico aggiungi <code className="text-slate-300 bg-slate-800 px-1 rounded text-xs">NOTION_TOKEN</code> e <code className="text-slate-300 bg-slate-800 px-1 rounded text-xs">NOTION_BUGS_DATABASE_ID</code> in <code className="text-xs text-slate-300 bg-slate-800 px-1 rounded">.env.local</code>.
              </span>
            </div>
          </div>
        )}
        {stats.posthogStatus === 'none' && (
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 flex items-start gap-3">
            <Activity className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
            <div className="text-sm">
              <span className="text-blue-300 font-medium">PostHog non configurato.</span>
              <span className="text-slate-400 ml-1.5">
                Aggiungi <code className="text-slate-300 bg-slate-800 px-1 rounded text-xs">POSTHOG_API_KEY</code> e <code className="text-slate-300 bg-slate-800 px-1 rounded text-xs">POSTHOG_PROJECT_ID</code> in <code className="text-xs text-slate-300 bg-slate-800 px-1 rounded">.env.local</code>, poi clicca <strong className="text-blue-300">Sync PostHog</strong>.
              </span>
            </div>
          </div>
        )}

        {/* Quick Log */}
        <form onSubmit={handleQuickLog} className="rounded-lg border p-3" style={{ borderColor: 'rgba(99,102,241,0.3)', background: 'rgba(49,46,129,0.15)' }}>
          <p className="text-xs font-semibold text-indigo-400 mb-2 uppercase tracking-wider">⚡ Quick Log</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="w-full sm:w-48 shrink-0 min-w-0">
              <Combobox options={clientOptions} value={logClientId} onValueChange={setLogClientId} placeholder="Cliente..." searchPlaceholder="Cerca cliente..." />
            </div>
            <div className="w-full sm:w-32 shrink-0">
              <Select value={logType} onValueChange={setLogType}>
                <SelectTrigger><SelectValue placeholder="Tipo..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="teams">🎥 Meeting Teams</SelectItem>
                  <SelectItem value="email">📧 Email</SelectItem>
                  <SelectItem value="feedback">💬 Feedback Session</SelectItem>
                  <SelectItem value="training">🎓 Training</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="shrink-0 relative" style={{ width: '152px', minWidth: '152px' }}>
              {/* Formatted display layer */}
              <div
                className="h-9 w-full rounded-md border px-3 flex items-center text-sm pointer-events-none select-none"
                style={{
                  borderColor: logDate ? 'rgba(99,102,241,0.5)' : '#334155',
                  background: '#1e293b',
                  color: logDate ? '#a5b4fc' : '#64748b',
                }}
              >
                {logDate
                  ? new Date(logDate + 'T12:00:00').toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
                  : '📅 Oggi'}
              </div>
              {/* Invisible native input on top to capture clicks and open picker */}
              <input
                type="date"
                max={today}
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer"
                style={{ width: '100%', height: '100%' }}
                title={logDate ? `Touchpoint del ${logDate}` : 'Data (default: oggi)'}
              />
            </div>
            <div className="flex-1 min-w-0">
              <input ref={notesRef} className="flex h-9 w-full rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" style={{ borderColor: '#334155', background: '#1e293b', color: '#f1f5f9' }} placeholder="Note brevi (opzionale)..." value={logNotes} onChange={(e) => setLogNotes(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleQuickLog(e as unknown as React.FormEvent)} />
            </div>
            <Button type="submit" disabled={!logClientId || !logType || logLoading} className="shrink-0">
              {logLoading ? '...' : 'Log →'}
            </Button>
          </div>
        </form>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input className="pl-9" placeholder="Cerca cliente o codice..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti gli status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="onboarding">Onboarding</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="churned">Churned</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterPm} onValueChange={setFilterPm}>
            <SelectTrigger className="w-44"><SelectValue placeholder="PM" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i PM</SelectItem>
              {pmOptions.map((pm) => <SelectItem key={pm} value={pm}>{pm}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterTier} onValueChange={setFilterTier}>
            <SelectTrigger className="w-32"><SelectValue placeholder="Tier" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i Tier</SelectItem>
              <SelectItem value="1">Tier 1</SelectItem>
              <SelectItem value="2">Tier 2</SelectItem>
              <SelectItem value="3">Tier 3</SelectItem>
            </SelectContent>
          </Select>
          {stats.hasMondayData && clientManagerOptions.length > 0 && (
            <Select value={filterClientManager} onValueChange={setFilterClientManager}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Client Manager" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti i CM</SelectItem>
                {clientManagerOptions.map((cm) => <SelectItem key={cm} value={cm}>{cm}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {stats.hasMondayData && (
            <Select value={filterChurn} onValueChange={setFilterChurn}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Churn" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti</SelectItem>
                <SelectItem value="yes">⚠ Potential Churn</SelectItem>
                <SelectItem value="no">Nessun rischio</SelectItem>
              </SelectContent>
            </Select>
          )}
          {stats.hasPostHogData && (
            <Select value={filterAdoption} onValueChange={setFilterAdoption}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Adoption" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutti adoption</SelectItem>
                <SelectItem value="Self-serve">Self-serve</SelectItem>
                <SelectItem value="Supported">Supported</SelectItem>
                <SelectItem value="PM-driven">PM-driven</SelectItem>
                <SelectItem value="Dormant">Dormant</SelectItem>
                <SelectItem value="New">New</SelectItem>
              </SelectContent>
            </Select>
          )}
          <span className="text-xs text-slate-500 ml-auto">{filtered.length} clienti</span>
        </div>

        {/* Active KPI filter chip */}
        {activeKpiFilter && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              <span>Filtro: {KPI_LABELS[activeKpiFilter]}</span>
              <span className="text-indigo-500">— {filtered.length} clienti</span>
              <button onClick={() => setActiveKpiFilter(null)} className="ml-0.5 text-indigo-400 hover:text-white transition-colors">
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}

        {/* Table */}
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
                  <th className="text-left px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap w-16 text-xs">Code</th>
                  <th className="text-left px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap w-16 hidden sm:table-cell">
                    <button onClick={() => toggleSort('tier')} className="flex items-center gap-1 hover:text-white transition-colors">Tier <SortIcon col="tier" /></button>
                  </th>
                  <th className="text-left px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap">
                    <button onClick={() => toggleSort('name')} className="flex items-center gap-1 hover:text-white transition-colors">Cliente <SortIcon col="name" /></button>
                  </th>
                  <th className="text-left px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap hidden md:table-cell">PM</th>
                  <th className="text-left px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap">Status</th>
                  {stats.hasMondayData && (
                    <th className="text-left px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap hidden md:table-cell">
                      <button onClick={() => toggleSort('arr')} className="flex items-center gap-1 hover:text-white transition-colors">ARR <SortIcon col="arr" /></button>
                    </th>
                  )}
                  {stats.hasMondayData && (
                    <th className="text-left px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap hidden lg:table-cell">
                      <button onClick={() => toggleSort('service_end')} className="flex items-center gap-1 hover:text-white transition-colors">Scadenza <SortIcon col="service_end" /></button>
                    </th>
                  )}
                  <th className="text-left px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap hidden lg:table-cell">Ultimo touchpoint</th>
                  <th className="text-left px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap">
                    <button onClick={() => toggleSort('days_since_contact')} className="flex items-center gap-1 hover:text-white transition-colors">Giorni <SortIcon col="days_since_contact" /></button>
                  </th>
                  {stats.hasBugData && (
                    <th className="text-left px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap">
                      <button onClick={() => toggleSort('open_bugs')} className="flex items-center gap-1 hover:text-white transition-colors">Bug <SortIcon col="open_bugs" /></button>
                    </th>
                  )}
                  {stats.hasPostHogData && (
                    <th className="text-left px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap hidden xl:table-cell">
                      Accesso
                    </th>
                  )}
                  <th className="text-left px-3 py-2.5 font-medium text-slate-400 whitespace-nowrap">
                    <button onClick={() => toggleSort('health_score')} className="flex items-center gap-1 hover:text-white transition-colors">Score <SortIcon col="health_score" /></button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={colCount} className="px-4 py-10 text-center text-slate-500">Caricamento...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={colCount} className="px-4 py-10 text-center text-slate-500">Nessun cliente trovato</td></tr>
                ) : (
                  filtered.map((client) => <ClientRow key={client.id} client={client} hasBugData={stats.hasBugData} hasPostHogData={stats.hasPostHogData} hasMondayData={stats.hasMondayData} />)
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────

const KPI_LABELS: Record<string, string> = {
  active:         'Clienti attivi',
  to_contact:     'Da contattare (>30gg)',
  critical:       'Critici (>60gg)',
  tier1_risk:     'Tier 1 a rischio',
  expiring:       'Scadono (90gg)',
  churn:          'Potential Churn',
  critical_bugs:  'Con bug critici',
  bugs_resolved:  'Bug risolti (mese)',
}

function KpiCard({ icon, label, value, valueStr, color, filterId, active, onToggle }: {
  icon: React.ReactNode
  label: string
  value?: number
  valueStr?: string
  color: string
  filterId: string | null        // null = non filtrabile (es. ARR totale)
  active: string | null
  onToggle: (id: string | null) => void
}) {
  const isActive = filterId !== null && active === filterId
  const clickable = filterId !== null

  return (
    <div
      onClick={clickable ? () => onToggle(isActive ? null : filterId) : undefined}
      className="rounded-lg border p-3 sm:p-4 transition-all"
      style={{
        borderColor: isActive ? 'rgba(99,102,241,0.6)' : '#1e293b',
        background: isActive ? 'rgba(49,46,129,0.25)' : '#0f172a',
        cursor: clickable ? 'pointer' : 'default',
        boxShadow: isActive ? '0 0 0 1px rgba(99,102,241,0.4)' : 'none',
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">{icon}<span className="text-xs text-slate-400 hidden sm:inline">{label}</span></div>
      <p className={`text-2xl sm:text-3xl font-bold tabular-nums ${color}`}>{valueStr ?? value}</p>
      <p className="text-xs text-slate-500 sm:hidden mt-0.5">{label}</p>
    </div>
  )
}

// Format "20 Mar, 14:32" for CSV/import timestamps
function fmtSync(iso: string | null): string {
  if (!iso) return 'Mai sincronizzato'
  return new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// Format relative time for live syncs ("5 min fa", "2 ore fa")
function fmtRelative(iso: string | null): string {
  if (!iso) return 'Mai sincronizzato'
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'Ora'
  if (mins < 60) return `${mins} min fa`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} ora fa`
  return fmtSync(iso)
}

function SyncLabel({ ts, relative = false }: { ts: string | null; relative?: boolean }) {
  const label = relative ? fmtRelative(ts) : fmtSync(ts)
  return <span className="opacity-60 text-[10px] ml-0.5 tabular-nums">{label}</span>
}

function MondayBadge({ status, hasMondayData, lastSync, onSync, syncing }: {
  status: 'api' | 'csv' | 'none'; hasMondayData: boolean; lastSync: string | null; onSync: () => void; syncing: boolean
}) {
  if (status === 'api') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/30">
          <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />Monday: live<SyncLabel ts={lastSync} relative />
        </span>
        <button onClick={onSync} disabled={syncing} className="text-xs text-slate-400 hover:text-white transition-colors" title="Sync Monday">
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
        </button>
      </div>
    )
  }
  if (hasMondayData) {
    return (
      <div className="flex items-center gap-1.5">
        <Link href="/import/monday">
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/20 transition-colors cursor-pointer">
            <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />Monday: CSV<SyncLabel ts={lastSync} />
          </span>
        </Link>
        <button onClick={onSync} disabled={syncing} className="text-xs text-slate-400 hover:text-white transition-colors" title="Sync Monday">
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
        </button>
      </div>
    )
  }
  return (
    <Link href="/import/monday">
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-slate-800 text-slate-500 border border-slate-700 hover:text-slate-300 transition-colors cursor-pointer">
        Monday
      </span>
    </Link>
  )
}

function NotionBadge({ status, lastSync, onSync, syncing }: {
  status: 'live' | 'csv' | 'none'; lastSync: string | null; onSync: () => void; syncing: boolean
}) {
  if (status === 'live') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/30">
          <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />Notion: live<SyncLabel ts={lastSync} relative />
        </span>
        <button onClick={onSync} disabled={syncing} className="text-xs text-slate-400 hover:text-white transition-colors" title="Sync ora">
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
        </button>
      </div>
    )
  }
  if (status === 'csv') {
    return (
      <div className="flex items-center gap-1.5">
        <Link href="/import/bugs">
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/20 transition-colors cursor-pointer">
            <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />Notion: CSV<SyncLabel ts={lastSync} />
          </span>
        </Link>
      </div>
    )
  }
  return (
    <Link href="/import/bugs">
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors cursor-pointer">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />Notion: off
      </span>
    </Link>
  )
}

function PostHogBadge({ status, lastSync, onSync, syncing }: {
  status: 'live' | 'synced' | 'ready' | 'none'; lastSync: string | null; onSync: () => void; syncing: boolean
}) {
  if (status === 'live') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-blue-500/15 text-blue-400 border border-blue-500/30">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />PostHog: live<SyncLabel ts={lastSync} relative />
        </span>
        <button onClick={onSync} disabled={syncing} className="text-xs text-slate-400 hover:text-white transition-colors" title="Sync PostHog">
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
        </button>
      </div>
    )
  }
  if (status === 'synced') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-slate-500/15 text-slate-400 border border-slate-500/30">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />PostHog: cache<SyncLabel ts={lastSync} relative />
        </span>
        <button onClick={onSync} disabled={syncing} className="text-xs text-slate-400 hover:text-white transition-colors" title="Sync PostHog">
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
        </button>
      </div>
    )
  }
  if (status === 'ready') {
    return (
      <button
        onClick={onSync}
        disabled={syncing}
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
      >
        <Activity className="h-3 w-3" />
        {syncing ? 'Syncing...' : 'Sync PostHog'}
      </button>
    )
  }
  return null
}

function ClerkBadge({ status, lastSync, onSync, syncing }: {
  status: 'live' | 'synced' | 'ready' | 'none'; lastSync: string | null; onSync: () => void; syncing: boolean
}) {
  if (status === 'live') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-violet-500/15 text-violet-400 border border-violet-500/30">
          <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />Clerk: live<SyncLabel ts={lastSync} relative />
        </span>
        <button onClick={onSync} disabled={syncing} className="text-xs text-slate-400 hover:text-white transition-colors" title="Sync Clerk">
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
        </button>
      </div>
    )
  }
  if (status === 'synced') {
    return (
      <div className="flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-slate-500/15 text-slate-400 border border-slate-500/30">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />Clerk: cache<SyncLabel ts={lastSync} relative />
        </span>
        <button onClick={onSync} disabled={syncing} className="text-xs text-slate-400 hover:text-white transition-colors" title="Sync Clerk">
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
        </button>
      </div>
    )
  }
  if (status === 'ready') {
    return (
      <button onClick={onSync} disabled={syncing}
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500/20 transition-colors">
        <Users className="h-3 w-3" />
        {syncing ? 'Syncing...' : 'Sync Clerk'}
      </button>
    )
  }
  return null
}

function TierBadge({ tier }: { tier: number | null }) {
  const t = tier ?? 3
  const style = TIER_STYLES[t] ?? TIER_STYLES[3]
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold"
      style={{ background: style.bg, color: style.text }}
    >
      T{t}
    </span>
  )
}

function AdoptionBadge({ level }: { level: AdoptionLevel }) {
  const cls = ADOPTION_COLORS[level] ?? ADOPTION_COLORS['New']
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {level}
    </span>
  )
}

function BugCell({ client }: { client: ClientWithStats }) {
  const open = client.open_bugs ?? 0
  const resolved = client.resolved_bugs ?? 0
  const hasCritical = (client.critical_bugs ?? 0) > 0
  const hasHigh = (client.high_bugs ?? 0) > 0
  const openColor = hasCritical ? 'text-red-400' : hasHigh ? 'text-orange-400' : open > 0 ? 'text-yellow-400' : 'text-green-400'
  return (
    <Link href={`/clients/${client.id}#bugs`} className="flex items-center gap-1 whitespace-nowrap">
      <span className={`font-semibold tabular-nums ${openColor}`}>{open}</span>
      {resolved > 0 && <span className="text-slate-600 text-xs tabular-nums">/ {resolved}</span>}
    </Link>
  )
}

function LastSeenCell({ client }: { client: ClientWithStats }) {
  const extDays = client.last_seen_external_days
  const intDays = client.last_seen_internal_days
  const ext = client.active_external ?? 0
  const int = client.active_internal ?? 0

  if (!client.has_posthog_data) {
    return <span className="text-slate-600 text-xs">—</span>
  }

  function daysColor(d: number | null) {
    if (d === null) return 'text-slate-600'
    if (d <= 7) return 'text-green-400'
    if (d <= 30) return 'text-yellow-400'
    return 'text-red-400'
  }

  return (
    <div className="space-y-0.5">
      {extDays !== null ? (
        <div className={`text-xs tabular-nums ${daysColor(extDays)}`}>
          🏢 {extDays === 0 ? 'oggi' : `${extDays}gg fa`}
        </div>
      ) : (
        <div className="text-xs text-yellow-500">⚠ solo internal</div>
      )}
      {intDays !== null && (
        <div className={`text-xs tabular-nums ${daysColor(intDays)}`}>
          🏠 {intDays === 0 ? 'oggi' : `${intDays}gg fa`}
        </div>
      )}
      <div className="text-xs text-slate-500 tabular-nums">{ext} ext / {int} int</div>
    </div>
  )
}

function ServiceEndCompact({ dateStr }: { dateStr: string | null }) {
  if (!dateStr) return <span className="text-slate-600 text-xs">—</span>
  const days = daysUntil(dateStr)
  if (days === null) return <span className="text-slate-600 text-xs">—</span>
  const color = days < 0 ? 'text-red-400' : days <= 60 ? 'text-red-400' : days <= 90 ? 'text-yellow-400' : 'text-slate-400'
  const label = days < 0 ? 'Scad.' : `${days}gg`
  return (
    <div>
      <span className={`text-xs font-semibold tabular-nums ${color}`}>{label}</span>
      <div className="text-xs text-slate-600">{new Date(dateStr).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}</div>
    </div>
  )
}

function ClientRow({ client, hasBugData, hasPostHogData, hasMondayData }: {
  client: ClientWithStats; hasBugData: boolean; hasPostHogData: boolean; hasMondayData: boolean
}) {
  return (
    <tr className="border-b transition-colors group" style={{ borderColor: '#1e293b' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = '#0f172a')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <td className="px-3 py-3">
        {client.client_code
          ? <span className="font-mono text-xs font-semibold text-slate-500 bg-slate-800/60 px-1.5 py-0.5 rounded">{client.client_code}</span>
          : <span className="text-slate-700">—</span>}
      </td>
      <td className="px-3 py-3 hidden sm:table-cell">
        <TierBadge tier={client.tier} />
      </td>
      <td className="px-3 py-3">
        <Link href={`/clients/${client.id}`} className="block group-hover:text-indigo-400 transition-colors">
          <div className="font-medium text-slate-100">{client.name}</div>
          {client.company && client.company !== client.name && (
            <div className="text-xs text-slate-500 truncate max-w-[200px]">{client.company}</div>
          )}
        </Link>
      </td>
      <td className="px-3 py-3 text-xs text-slate-400 hidden md:table-cell whitespace-nowrap">{client.client_manager ?? client.pm_assigned ?? '—'}</td>
      <td className="px-3 py-3"><Badge status={client.status} /></td>
      {hasMondayData && (
        <td className="px-3 py-3 text-sm font-semibold text-slate-200 tabular-nums whitespace-nowrap hidden md:table-cell">
          {formatArr(client.arr)}
        </td>
      )}
      {hasMondayData && (
        <td className="px-3 py-3 whitespace-nowrap hidden lg:table-cell">
          <ServiceEndCompact dateStr={client.service_end} />
        </td>
      )}
      <td className="px-3 py-3 text-xs text-slate-400 hidden lg:table-cell whitespace-nowrap">
        {client.last_touchpoint_date ? (
          <span>{formatDate(client.last_touchpoint_date)}{client.last_touchpoint_type && <span className="ml-1.5 text-slate-500">· {formatTouchpointType(client.last_touchpoint_type)}</span>}</span>
        ) : <span className="text-slate-600 italic">Mai contattato</span>}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <span className={`font-semibold tabular-nums text-sm ${getDaysColorClass(client.days_since_contact)}`}>
          {client.days_since_contact !== null ? `${client.days_since_contact}gg` : '—'}
        </span>
      </td>
      {hasBugData && (
        <td className="px-3 py-3 whitespace-nowrap"><BugCell client={client} /></td>
      )}
      {hasPostHogData && (
        <td className="px-3 py-3 hidden xl:table-cell"><LastSeenCell client={client} /></td>
      )}
      <td className="px-3 py-3 whitespace-nowrap">
        <div className="flex flex-col gap-1 items-start">
          <div
            className="flex items-center gap-1.5 cursor-help"
            title={client.tier_penalty > 0
              ? `Raw score: ${client.raw_score} | Tier ${client.tier ?? 3} penalty: -${client.tier_penalty} | Priority score: ${client.health_score}`
              : `Score: ${client.health_score}`}
          >
            <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${getScoreDotClass(client.health_score)}`} />
            <span className={`font-semibold tabular-nums text-sm ${getScoreTextClass(client.health_score)}`}>{client.health_score}</span>
            {client.tier_penalty > 0 && (
              <span className="text-xs text-red-400 tabular-nums">-{client.tier_penalty}</span>
            )}
          </div>
          {client.has_posthog_data && (
            <AdoptionBadge level={client.adoption_level} />
          )}
        </div>
      </td>
    </tr>
  )
}
