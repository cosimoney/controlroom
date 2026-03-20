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

export default function UsersPage() {
  const [users, setUsers]       = useState<TopUser[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [days, setDays]         = useState(30)
  const [showInternal, setShowInternal] = useState(false)
  const [filterOrg, setFilterOrg]       = useState('')
  const [filterTier, setFilterTier]     = useState<string>('all')

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
    .filter((u) => !filterOrg || u.org.toLowerCase().includes(filterOrg.toLowerCase()))
    .filter((u) => filterTier === 'all' || String(u.tier) === filterTier)

  const internalUsers = users
    .filter((u) => u.is_internal)
    .filter((u) => !filterOrg || u.org.toLowerCase().includes(filterOrg.toLowerCase()))

  function UserTable({ data, limit = 50 }: { data: TopUser[]; limit?: number }) {
    const [showAll, setShowAll] = useState(false)
    const shown = showAll ? data : data.slice(0, limit)
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
                  <td className="px-4 py-2 font-mono text-xs text-slate-300 max-w-[200px] truncate">{u.email}</td>
                  <td className="px-3 py-2">
                    {u.client_id ? (
                      <Link href={`/clients/${u.client_id}`} className="text-indigo-400 hover:text-indigo-300 text-xs">
                        {u.client_name ?? u.org}
                      </Link>
                    ) : (
                      <span className="text-slate-500 text-xs">{u.org}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {u.tier ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold"
                        style={{ background: tierStyle.bg, color: tierStyle.text }}>T{u.tier}</span>
                    ) : <span className="text-slate-600">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-200 tabular-nums font-semibold">{u.sessions}</td>
                  <td className="px-3 py-2 text-right text-slate-400 tabular-nums">{u.pageviews}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${lastSeenColor(u.last_seen)}`}>{formatLastSeen(u.last_seen)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {data.length > limit && !showAll && (
          <button onClick={() => setShowAll(true)} className="w-full py-2 text-xs text-slate-400 hover:text-white transition-colors border-t" style={{ borderColor: '#1e293b' }}>
            Mostra tutti ({data.length})
          </button>
        )}
      </>
    )
  }

  return (
    <div className="min-h-screen p-4 md:p-6 space-y-6" style={{ background: '#020817', color: '#f1f5f9' }}>
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
          <Button onClick={fetchUsers} disabled={loading} size="sm" variant="outline" className="border-slate-700 text-slate-300">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />Aggiorna
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {/* External users */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b' }}>
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
          <h2 className="text-sm font-semibold text-slate-200">Utenti External ({externalUsers.length})</h2>
          <span className="text-xs text-slate-500">ordinati per sessioni</span>
        </div>
        <div style={{ background: '#0a0f1e' }}>
          {loading ? (
            <p className="text-slate-500 text-sm px-4 py-6 text-center">Caricamento...</p>
          ) : (
            <UserTable data={externalUsers} />
          )}
        </div>
      </div>

      {/* Internal users */}
      <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b' }}>
        <button
          className="w-full px-4 py-3 border-b flex items-center justify-between"
          style={{ borderColor: '#1e293b', background: '#0f172a' }}
          onClick={() => setShowInternal((v) => !v)}
        >
          <h2 className="text-sm font-semibold text-slate-200">Utenti Internal ({internalUsers.length})</h2>
          {showInternal ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </button>
        {showInternal && (
          <div style={{ background: '#0a0f1e' }}>
            {loading ? (
              <p className="text-slate-500 text-sm px-4 py-6 text-center">Caricamento...</p>
            ) : (
              <UserTable data={internalUsers} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
