'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TIER_STYLES } from '@/lib/health'

interface TopUser {
  email: string
  org: string
  client_id: number | null
  client_name: string | null
  tier: number | null
  sessions: number
  pageviews: number
  last_seen: string
  is_internal: boolean
}

interface AggregatedInternalUser {
  email: string
  sessions: number
  pageviews: number
  last_seen: string
}

function formatLastSeen(isoStr: string): string {
  if (!isoStr) return '—'
  const days = Math.floor((Date.now() - new Date(isoStr).getTime()) / 86400000)
  if (days === 0) return 'oggi'
  if (days === 1) return '1gg fa'
  if (days < 30) return `${days}gg fa`
  return `${Math.floor(days / 30)}m fa`
}

function lastSeenColor(isoStr: string): string {
  if (!isoStr) return 'text-slate-600'
  const days = Math.floor((Date.now() - new Date(isoStr).getTime()) / 86400000)
  if (days <= 7) return 'text-green-400'
  if (days <= 30) return 'text-yellow-400'
  return 'text-red-400'
}

const PRODUCT_TEAM_PREFIXES = new Set([
  'cosimo.segnini', 'alessandro.patarnello', 'alexander.nemirovskiy',
  'melania.rizzuto', 'matteo.aliano', 'luca.lai', 'andrea.sciortino',
  'gjhershervine.pahati',
])

function isProductTeam(email: string): boolean {
  const prefix = email.split('@')[0].toLowerCase()
  return PRODUCT_TEAM_PREFIXES.has(prefix)
}

export default function UsersPage() {
  const [users, setUsers]       = useState<TopUser[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [days, setDays]         = useState(30)
  const [showInternal, setShowInternal]       = useState(true)
  const [excludeProduct, setExcludeProduct]   = useState(false)
  const [filterOrg, setFilterOrg]             = useState('')
  const [filterTier, setFilterTier]           = useState<string>('all')
  const [sortMetric, setSortMetric]           = useState<'sessions' | 'pageviews'>('sessions')

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/posthog/users?days=${days}`)
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? 'Errore nel caricamento')
        return
      }
      const data = await res.json()
      setUsers(data.users ?? [])
    } catch {
      setError('Errore di rete')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const externalUsers = users
    .filter((u) => !u.is_internal)
    .filter((u) => !excludeProduct || !isProductTeam(u.email))
    .filter((u) => !filterOrg || u.org.toLowerCase().includes(filterOrg.toLowerCase()))
    .filter((u) => filterTier === 'all' || String(u.tier) === filterTier)
    .sort((a, b) => b[sortMetric] - a[sortMetric])

  // Internal: aggregate by email across all orgs/clients
  const internalUsers: AggregatedInternalUser[] = Object.values(
    users
      .filter((u) => u.is_internal)
      .filter((u) => !excludeProduct || !isProductTeam(u.email))
      .reduce<Record<string, AggregatedInternalUser>>((acc, u) => {
        if (!acc[u.email]) {
          acc[u.email] = { email: u.email, sessions: 0, pageviews: 0, last_seen: u.last_seen }
        }
        acc[u.email].sessions  += u.sessions
        acc[u.email].pageviews += u.pageviews
        if (u.last_seen > acc[u.email].last_seen) acc[u.email].last_seen = u.last_seen
        return acc
      }, {})
  ).sort((a, b) => b[sortMetric] - a[sortMetric])

  const PAGE_SIZE = 10

  function UserTable({ data }: { data: TopUser[] }) {
    const [page, setPage] = useState(0)
    const totalPages = Math.ceil(data.length / PAGE_SIZE)
    const shown = data.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

    if (data.length === 0) return <p className="text-slate-500 text-sm px-4 py-6 text-center">Nessun utente trovato</p>
    return (
      <>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left" style={{ borderColor: '#1e293b' }}>
              <th className="px-4 py-2 text-slate-500 font-medium">Email</th>
              <th className="px-3 py-2 text-slate-500 font-medium">Cliente</th>
              <th className="px-3 py-2 text-slate-500 font-medium text-center">Tier</th>
              <th className="px-3 py-2 text-slate-500 font-medium text-right">Sessioni</th>
              <th className="px-3 py-2 text-slate-500 font-medium text-right">PV</th>
              <th className="px-4 py-2 text-slate-500 font-medium text-right">Ultimo accesso</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u, i) => {
              const tierStyle = TIER_STYLES[u.tier ?? 3] ?? TIER_STYLES[3]
              return (
                <tr key={i} className="border-b hover:bg-slate-800/30 transition-colors" style={{ borderColor: '#1e293b' }}>
                  <td className="px-4 py-1.5 font-mono text-xs text-slate-300 max-w-[200px] truncate">{u.email}</td>
                  <td className="px-3 py-2">
                    {u.client_id ? (
                      <Link href={`/clients/${u.client_id}`} className="text-indigo-400 hover:text-indigo-300 text-xs">
                        {u.client_name ?? u.org}
                      </Link>
                    ) : (
                      <span className="text-slate-500 text-xs">{u.org}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {u.tier ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold"
                        style={{ background: tierStyle.bg, color: tierStyle.text }}>T{u.tier}</span>
                    ) : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right text-slate-200 tabular-nums font-semibold">{u.sessions}</td>
                  <td className="px-3 py-1.5 text-right text-slate-400 tabular-nums">{u.pageviews}</td>
                  <td className={`px-4 py-1.5 text-right tabular-nums ${lastSeenColor(u.last_seen)}`}>{formatLastSeen(u.last_seen)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t" style={{ borderColor: '#1e293b' }}>
            <span className="text-xs text-slate-500">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data.length)} di {data.length}</span>
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
    )
  }

  function InternalTable({ data }: { data: AggregatedInternalUser[] }) {
    const [page, setPage] = useState(0)
    const totalPages = Math.ceil(data.length / PAGE_SIZE)
    const shown = data.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    if (data.length === 0) return <p className="text-slate-500 text-sm px-4 py-6 text-center">Nessun utente interno trovato</p>
    return (
      <>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left" style={{ borderColor: '#1e293b' }}>
              <th className="px-4 py-2 text-slate-500 font-medium">Email</th>
              <th className="px-3 py-2 text-slate-500 font-medium text-right">Sessioni</th>
              <th className="px-3 py-2 text-slate-500 font-medium text-right">PV</th>
              <th className="px-4 py-2 text-slate-500 font-medium text-right">Ultimo accesso</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.email} className="border-b hover:bg-slate-800/30 transition-colors" style={{ borderColor: '#1e293b' }}>
                <td className="px-4 py-1.5 font-mono text-xs text-slate-300">{u.email}</td>
                <td className="px-3 py-1.5 text-right text-slate-200 tabular-nums font-semibold">{u.sessions}</td>
                <td className="px-3 py-1.5 text-right text-slate-400 tabular-nums">{u.pageviews}</td>
                <td className={`px-4 py-1.5 text-right tabular-nums ${lastSeenColor(u.last_seen)}`}>{formatLastSeen(u.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2 border-t" style={{ borderColor: '#1e293b' }}>
            <span className="text-xs text-slate-500">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data.length)} di {data.length}</span>
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
    )
  }

  return (
    <div className="min-h-screen p-3 md:p-4 space-y-3" style={{ background: '#020817', color: '#f1f5f9' }}>
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white">Top Users</h1>
            <p className="text-xs text-slate-500 mt-0.5">Utenti più attivi su Witailer Studio</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period selector */}
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}
            className="h-9 rounded-md border px-3 text-sm outline-none"
            style={{ borderColor: '#334155', background: '#1e293b', color: '#f1f5f9' }}>
            <option value={30}>Ultimi 30 giorni</option>
            <option value={60}>Ultimi 60 giorni</option>
            <option value={90}>Ultimi 90 giorni</option>
          </select>
          {/* Org filter */}
          <input placeholder="Filtra per org..." value={filterOrg} onChange={(e) => setFilterOrg(e.target.value)}
            className="h-9 rounded-md border px-3 text-sm outline-none w-36"
            style={{ borderColor: '#334155', background: '#1e293b', color: '#f1f5f9' }} />
          {/* Tier filter */}
          <select value={filterTier} onChange={(e) => setFilterTier(e.target.value)}
            className="h-9 rounded-md border px-3 text-sm outline-none"
            style={{ borderColor: '#334155', background: '#1e293b', color: '#f1f5f9' }}>
            <option value="all">Tutti i Tier</option>
            <option value="1">Tier 1</option>
            <option value="2">Tier 2</option>
            <option value="3">Tier 3</option>
          </select>
          {/* Sort metric toggle */}
          <div className="h-9 flex items-center rounded-md border overflow-hidden" style={{ borderColor: '#334155' }}>
            <button
              onClick={() => setSortMetric('sessions')}
              className={`px-3 h-full text-xs font-medium transition-colors ${sortMetric === 'sessions' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              style={sortMetric !== 'sessions' ? { background: '#1e293b' } : {}}
            >Sessioni</button>
            <button
              onClick={() => setSortMetric('pageviews')}
              className={`px-3 h-full text-xs font-medium transition-colors ${sortMetric === 'pageviews' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              style={sortMetric !== 'pageviews' ? { background: '#1e293b' } : {}}
            >PageView</button>
          </div>
          <button
            onClick={() => setExcludeProduct((v) => !v)}
            className={`h-9 px-3 rounded-md border text-xs font-medium transition-colors ${excludeProduct ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-300' : 'border-slate-700 text-slate-400 hover:text-slate-200'}`}
          >
            {excludeProduct ? '✓ Escludi Product Team' : 'Escludi Product Team'}
          </button>
          <Button onClick={fetchUsers} disabled={loading} size="sm" variant="outline" className="border-slate-700 text-slate-300">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />Aggiorna
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {/* Top 5 summary boxes */}
      {!loading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Top 5 External */}
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: '#1e293b' }}>
              <h2 className="text-sm font-semibold text-slate-200">🏢 Top 5 External <span className="text-xs font-normal text-slate-500 ml-1">ultimi 30gg</span></h2>
            </div>
            <div className="divide-y" style={{ borderColor: '#1e293b' }}>
              {externalUsers.slice(0, 5).map((u, i) => (
                <div key={u.email} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-xs font-bold tabular-nums text-slate-600 w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs text-slate-300 truncate">{u.email}</div>
                    <div className="text-xs text-slate-600 truncate">{u.client_name ?? u.org}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-blue-400 tabular-nums">{sortMetric === 'sessions' ? u.sessions : u.pageviews} {sortMetric === 'sessions' ? 'sess' : 'pv'}</div>
                    <div className="text-xs text-slate-500 tabular-nums">{sortMetric === 'sessions' ? u.pageviews : u.sessions} {sortMetric === 'sessions' ? 'pv' : 'sess'}</div>
                  </div>
                </div>
              ))}
              {externalUsers.length === 0 && <p className="px-4 py-4 text-xs text-slate-600 text-center">Nessun dato</p>}
            </div>
          </div>

          {/* Top 5 Internal */}
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: '#1e293b' }}>
              <h2 className="text-sm font-semibold text-slate-200">🏠 Top 5 Internal <span className="text-xs font-normal text-slate-500 ml-1">ultimi 30gg · aggregati</span></h2>
            </div>
            <div className="divide-y" style={{ borderColor: '#1e293b' }}>
              {internalUsers.slice(0, 5).map((u, i) => (
                <div key={u.email} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-xs font-bold tabular-nums text-slate-600 w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs text-slate-300 truncate">{u.email}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-purple-400 tabular-nums">{sortMetric === 'sessions' ? u.sessions : u.pageviews} {sortMetric === 'sessions' ? 'sess' : 'pv'}</div>
                    <div className="text-xs text-slate-500 tabular-nums">{sortMetric === 'sessions' ? u.pageviews : u.sessions} {sortMetric === 'sessions' ? 'pv' : 'sess'}</div>
                  </div>
                </div>
              ))}
              {internalUsers.length === 0 && <p className="px-4 py-4 text-xs text-slate-600 text-center">Nessun dato</p>}
            </div>
          </div>
        </div>
      )}

      {/* External users */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b' }}>
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
          <h2 className="text-sm font-semibold text-slate-200">Utenti External ({externalUsers.length})</h2>
          <span className="text-xs text-slate-500">ordinati per {sortMetric === 'sessions' ? 'sessioni' : 'pageview'}</span>
        </div>
        <div style={{ background: '#0a0f1e' }}>
          {loading ? (
            <p className="text-slate-500 text-sm px-4 py-6 text-center">Caricamento...</p>
          ) : (
            <UserTable data={externalUsers} />
          )}
        </div>
      </div>

      {/* Internal users — aggregated across all clients */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b' }}>
        <button
          className="w-full px-4 py-3 border-b flex items-center justify-between"
          style={{ borderColor: '#1e293b', background: '#0f172a' }}
          onClick={() => setShowInternal((v) => !v)}
        >
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Utenti Internal ({internalUsers.length})</h2>
            <p className="text-xs text-slate-500 mt-0.5">Sessioni e PV aggregati su tutti i clienti</p>
          </div>
          {showInternal ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </button>
        {showInternal && (
          <div style={{ background: '#0a0f1e' }}>
            {loading ? (
              <p className="text-slate-500 text-sm px-4 py-6 text-center">Caricamento...</p>
            ) : <InternalTable data={internalUsers} />}
          </div>
        )}
      </div>
    </div>
  )
}
