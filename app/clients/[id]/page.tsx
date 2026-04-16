'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Edit2, Save, X, Plus, Trash2, Phone, Mail, Users, ExternalLink, ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle, BookOpen, Sparkles, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  getDaysColorClass, getScoreDotClass, getScoreTextClass, formatDate,
  PRIORITY_COLORS, STATUS_COLORS, ADOPTION_COLORS, TIER_STYLES,
} from '@/lib/health'
import type { ClientWithStats, Touchpoint, Bug, UsageSummary, AdoptionLevel, ClerkOrgRow, ClerkUserRow } from '@/lib/types'

const TOUCHPOINT_ICONS: Record<string, React.ReactNode> = {
  teams:    <Users className="h-3.5 w-3.5" />,
  email:    <Mail className="h-3.5 w-3.5" />,
  feedback: <Phone className="h-3.5 w-3.5" />,
  training: <BookOpen className="h-3.5 w-3.5" />,
}

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [client, setClient]             = useState<ClientWithStats | null>(null)
  const [touchpoints, setTouchpoints]   = useState<Touchpoint[]>([])
  const [openBugs, setOpenBugs]         = useState<Bug[]>([])
  const [resolvedBugs, setResolvedBugs] = useState<Bug[]>([])
  const [usage, setUsage]               = useState<UsageSummary | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [clerkOrg, setClerkOrg]         = useState<ClerkOrgRow | null>(null)
  const [clerkUsers, setClerkUsers]     = useState<ClerkUserRow[]>([])
  const [clerkLoading, setClerkLoading] = useState(false)
  const [loading, setLoading]           = useState(true)
  const [editing, setEditing]           = useState(false)
  const [editForm, setEditForm]         = useState<Partial<ClientWithStats>>({})
  const [resolvedExpanded, setResolvedExpanded] = useState(false)
  const [priorityFilter, setPriorityFilter]     = useState<string>('all')
  const [internalExpanded, setInternalExpanded] = useState(false)

  const [tpDate, setTpDate]   = useState(() => new Date().toISOString().split('T')[0])
  const [tpType, setTpType]   = useState('')
  const [tpNotes, setTpNotes] = useState('')
  const [tpLoading, setTpLoading] = useState(false)

  const fetchClient = useCallback(async () => {
    const [cRes, tRes] = await Promise.all([
      fetch(`/api/clients/${id}`),
      fetch(`/api/clients/${id}/touchpoints`),
    ])
    if (cRes.ok) {
      const data = await cRes.json()
      setClient(data)
      setEditForm(data)
      if (data.client_code) {
        const code = encodeURIComponent(data.client_code.toLowerCase())
        const [obRes, rbRes] = await Promise.all([
          fetch(`/api/bugs?client=${code}&status=open`),
          fetch(`/api/bugs?client=${code}&status=resolved`),
        ])
        if (obRes.ok) setOpenBugs(await obRes.json())
        if (rbRes.ok) setResolvedBugs(await rbRes.json())
      }
    } else { router.push('/') }
    if (tRes.ok) setTouchpoints(await tRes.json())
    setLoading(false)
  }, [id, router])

  const fetchUsage = useCallback(async (clientCode: string) => {
    setUsageLoading(true)
    try {
      const res = await fetch(`/api/posthog/usage?client=${encodeURIComponent(clientCode)}`)
      if (res.ok) {
        const data = await res.json()
        if (data.users_external !== undefined) setUsage(data as UsageSummary)
        // if only { adoption_level: 'New' }, leave usage null
      }
    } finally {
      setUsageLoading(false)
    }
  }, [])

  const fetchClerk = useCallback(async (clientCode: string) => {
    setClerkLoading(true)
    try {
      const res = await fetch(`/api/clerk/organizations?slug=${encodeURIComponent(clientCode)}`)
      if (res.ok) {
        const data = await res.json()
        setClerkOrg(data.org ?? null)
        setClerkUsers(data.users ?? [])
      }
    } finally { setClerkLoading(false) }
  }, [])

  useEffect(() => { fetchClient() }, [fetchClient])

  useEffect(() => {
    if (client?.posthog_configured && client.client_code) {
      fetchUsage(client.client_code)
    }
  }, [client?.posthog_configured, client?.client_code, fetchUsage])

  useEffect(() => {
    if (client?.client_code) {
      fetchClerk(client.client_code)
    }
  }, [client?.client_code, fetchClerk])

  async function handleSave() {
    const res = await fetch(`/api/clients/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...editForm,
        modules_active: typeof editForm.modules_active === 'string'
          ? (editForm.modules_active as string).split(',').map((s: string) => s.trim()).filter(Boolean)
          : editForm.modules_active,
        client_code: typeof editForm.client_code === 'string'
          ? editForm.client_code.trim().toUpperCase() || null
          : editForm.client_code,
      }),
    })
    if (res.ok) { setClient(await res.json()); setEditing(false); toast.success('Cliente aggiornato') }
    else toast.error('Errore nel salvataggio')
  }

  async function handleDelete() {
    if (!confirm(`Eliminare ${client?.name}? Questa azione è irreversibile.`)) return
    const res = await fetch(`/api/clients/${id}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Cliente eliminato'); router.push('/') }
    else toast.error('Errore')
  }

  async function handleAddTouchpoint(e: React.FormEvent) {
    e.preventDefault()
    if (!tpType) { toast.error('Seleziona tipo'); return }
    setTpLoading(true)
    try {
      const res = await fetch(`/api/clients/${id}/touchpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: tpDate, type: tpType, notes: tpNotes || undefined }),
      })
      if (!res.ok) throw new Error()
      const newTp = await res.json()
      setTouchpoints((prev) => [newTp, ...prev])
      toast.success('Touchpoint aggiunto')
      setTpType(''); setTpNotes(''); setTpDate(new Date().toISOString().split('T')[0])
      fetchClient()
    } catch { toast.error('Errore') }
    finally { setTpLoading(false) }
  }

  async function handleDeleteTouchpoint(tpId: number) {
    const res = await fetch(`/api/touchpoints/${tpId}`, { method: 'DELETE' })
    if (res.ok) { setTouchpoints((prev) => prev.filter((t) => t.id !== tpId)); toast.success('Touchpoint rimosso'); fetchClient() }
    else toast.error('Errore nella rimozione')
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ background: '#020617' }}><p className="text-slate-500">Caricamento...</p></div>
  if (!client) return null

  const modulesDisplay = Array.isArray(client.modules_active) ? client.modules_active.join(', ') : client.modules_active ?? ''
  const totalBugs   = openBugs.length + resolvedBugs.length
  const criticalCnt = openBugs.filter((b) => b.priority === 'Critical').length
  const highCnt     = openBugs.filter((b) => b.priority === 'High').length
  const filteredOpen = priorityFilter === 'all' ? openBugs : openBugs.filter((b) => b.priority === priorityFilter)

  return (
    <div className="min-h-screen" style={{ background: '#020617' }}>
      <header className="border-b sticky top-0 z-40" style={{ borderColor: '#1e293b', background: 'rgba(2,6,23,0.9)', backdropFilter: 'blur(8px)' }}>
        <div className="max-w-[1200px] mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/"><button className="h-8 w-8 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"><ArrowLeft className="h-4 w-4" /></button></Link>
          <span className="text-slate-500 text-sm">/</span>
          {client.client_code && <span className="font-mono text-xs font-semibold text-slate-500 bg-slate-800 px-2 py-0.5 rounded">{client.client_code}</span>}
          <span className="text-white font-semibold">{client.name}</span>
          <Badge status={client.status} className="ml-1" />
          <TierBadge tier={client.tier} />
          <div className="ml-auto flex gap-2">
            {editing ? (
              <>
                <Button size="sm" onClick={handleSave}><Save className="h-3.5 w-3.5" />Salva</Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setEditForm(client) }}><X className="h-3.5 w-3.5" /></Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Edit2 className="h-3.5 w-3.5" />Modifica</Button>
                <Button size="sm" variant="destructive" onClick={handleDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-1 space-y-4">
          {/* Health score */}
          <div className="rounded-lg border p-4" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Health Score</p>
            <div
              className="flex items-center gap-3 cursor-help"
              title={client.tier_penalty > 0
                ? `Raw score: ${client.raw_score} | Tier ${client.tier ?? 3} penalty: -${client.tier_penalty} | Priority score: ${client.health_score}`
                : `Score: ${client.health_score}`}
            >
              <span className={`inline-block h-3 w-3 rounded-full ${getScoreDotClass(client.health_score)}`} />
              <span className={`text-4xl font-bold tabular-nums ${getScoreTextClass(client.health_score)}`}>{client.health_score}</span>
              <span className="text-slate-500 text-sm">/100</span>
              {client.tier_penalty > 0 && (
                <span className="text-sm text-red-400">(-{client.tier_penalty} T{client.tier})</span>
              )}
            </div>
            {client.days_since_contact !== null && <p className={`text-sm mt-2 ${getDaysColorClass(client.days_since_contact)}`}>Ultimo contatto {client.days_since_contact}gg fa</p>}
            {client.days_since_contact === null && <p className="text-sm mt-2 text-slate-600 italic">Mai contattato</p>}
            {/* Monday health */}
            {client.monday_health && (
              <div className="mt-2 flex items-center gap-1.5">
                <span className="text-xs text-slate-500">Monday:</span>
                <MondayHealthBadge value={client.monday_health} />
              </div>
            )}
            {/* Adoption badge */}
            {client.has_posthog_data && (
              <div className="mt-2">
                <AdoptionBadge level={client.adoption_level} />
              </div>
            )}
            {/* Potential churn warning */}
            {client.potential_churn && !['', 'no', '-'].includes(client.potential_churn.toLowerCase().trim()) && (
              <div className="mt-2 flex items-center gap-1.5 text-yellow-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="text-xs">{client.potential_churn}</span>
              </div>
            )}
          </div>

          {/* Contract card */}
          <ContractCard client={client} />

          {/* Client info */}
          <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
            <p className="text-xs text-slate-500 uppercase tracking-wider">Info cliente</p>
            {editing ? (
              <div className="space-y-3">
                <Field label="Codice cliente (es. BARIL)">
                  <Input value={editForm.client_code ?? ''} onChange={(e) => setEditForm((p) => ({ ...p, client_code: e.target.value.toUpperCase() }))} placeholder="CODICE" className="font-mono uppercase" />
                </Field>
                <Field label="Nome"><Input value={editForm.name ?? ''} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} /></Field>
                <Field label="Azienda"><Input value={editForm.company ?? ''} onChange={(e) => setEditForm((p) => ({ ...p, company: e.target.value }))} /></Field>
                <Field label="PM Assegnato"><Input value={editForm.pm_assigned ?? ''} onChange={(e) => setEditForm((p) => ({ ...p, pm_assigned: e.target.value }))} /></Field>
                <Field label="Contratto"><Input value={editForm.contract_type ?? ''} onChange={(e) => setEditForm((p) => ({ ...p, contract_type: e.target.value }))} /></Field>
                <Field label="Moduli (virgola)"><Input value={Array.isArray(editForm.modules_active) ? editForm.modules_active.join(', ') : editForm.modules_active ?? ''} onChange={(e) => setEditForm((p) => ({ ...p, modules_active: e.target.value as unknown as string[] }))} /></Field>
                <Field label="Mercato"><Input value={editForm.market ?? ''} onChange={(e) => setEditForm((p) => ({ ...p, market: e.target.value }))} placeholder="IT, DE, FR..." /></Field>
                <Field label="Status">
                  <Select value={editForm.status ?? 'active'} onValueChange={(v) => setEditForm((p) => ({ ...p, status: v as ClientWithStats['status'] }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="onboarding">Onboarding</SelectItem>
                      <SelectItem value="paused">Paused</SelectItem>
                      <SelectItem value="churned">Churned</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Tier (ARR: T1 >30k€, T2 15-30k€, T3 <15k€)">
                  <Select value={String(editForm.tier ?? 3)} onValueChange={(v) => setEditForm((p) => ({ ...p, tier: parseInt(v) }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Tier 1 — ARR &gt;30.000€</SelectItem>
                      <SelectItem value="2">Tier 2 — ARR 15-30.000€</SelectItem>
                      <SelectItem value="3">Tier 3 — ARR &lt;15.000€</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Note"><Textarea rows={3} value={editForm.notes ?? ''} onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))} /></Field>
              </div>
            ) : (
              <div className="space-y-2.5">
                <InfoRow label="Codice" value={client.client_code ? <code className="font-mono text-xs bg-slate-800 px-1.5 py-0.5 rounded text-slate-300">{client.client_code}</code> : null} />
                <InfoRow label="Tier" value={<TierBadge tier={client.tier} />} />
                <InfoRow label="Azienda" value={client.company} />
                <InfoRowAlways label="Client Manager" value={client.client_manager} />
                <InfoRowAlways label="AM Owner" value={client.am_owner} />
                <InfoRowAlways label="ADV Owner" value={client.adv_owner} />
                <InfoRow label="PM" value={client.pm_assigned} />
                <InfoRow label="Paese" value={client.country} />
                <InfoRow label="Contratto" value={client.contract_type} />
                <InfoRow label="Moduli" value={modulesDisplay || null} />
                <InfoRow label="Mercato" value={client.market} />
                {client.notes && <div><p className="text-xs text-slate-500 mb-0.5">Note</p><p className="text-sm text-slate-300 leading-relaxed">{client.notes}</p></div>}
              </div>
            )}
          </div>

          {/* Bug summary card */}
          {totalBugs > 0 && (
            <div className="rounded-lg border p-4" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Bug summary</p>
              <div className="flex items-center gap-2 text-sm mb-2">
                <span className="text-red-400 font-semibold">{openBugs.length} aperti</span>
                <span className="text-slate-600">|</span>
                <span className="text-green-400 font-semibold">{resolvedBugs.length} risolti</span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">{totalBugs} totali</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1e293b' }}>
                <div className="h-full" style={{ background: '#ef4444', width: `${totalBugs > 0 ? (openBugs.length / totalBugs) * 100 : 0}%` }} />
              </div>
              <div className="flex justify-between text-xs text-slate-500 mt-1">
                <span>{totalBugs > 0 ? Math.round((openBugs.length / totalBugs) * 100) : 0}% aperti</span>
                <span>{totalBugs > 0 ? Math.round((resolvedBugs.length / totalBugs) * 100) : 0}% risolti</span>
              </div>
              {criticalCnt > 0 && <p className="text-xs text-red-400 mt-2">{criticalCnt} Critical{highCnt > 0 ? `, ${highCnt} High` : ''} aperti</p>}
            </div>
          )}

          {/* PostHog Usage Overview */}
          <PostHogUsageCard
            clientCode={client.client_code}
            usage={usage}
            loading={usageLoading}
            posthogConfigured={!!client.posthog_configured}
            onRefresh={() => client.client_code ? fetchUsage(client.client_code) : undefined}
          />
        </div>

        {/* Right column */}
        <div className="lg:col-span-2 space-y-4" id="bugs">
          {/* Module comparison: Monday × Clerk × PostHog */}
          <ModuleComparisonCard
            client={client}
            clerkRawMetadata={clerkOrg ? JSON.parse(clerkOrg.raw_metadata || '{}') : null}
            posthogModules={usage?.modules ?? {}}
            clerkLoading={clerkLoading}
          />

          {/* AI-generated session script */}
          <PrepareSessionCard clientId={client.id} />

          {/* PostHog modules + users (only when data available) */}
          {usage && (
            <>
              <ModulesCard usage={usage} />
              <UsersCard
                usage={usage}
                internalExpanded={internalExpanded}
                onToggleInternal={() => setInternalExpanded((v) => !v)}
              />
            </>
          )}

          {/* Open bugs section */}
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: client.open_bugs > 0 ? 'rgba(239,68,68,0.3)' : '#1e293b' }}>
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-200">Bug aperti</h3>
                {openBugs.length > 0 && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">{openBugs.length}</span>
                )}
                {criticalCnt > 0 && <span className="text-xs text-red-400">{criticalCnt} Critical</span>}
                {highCnt > 0 && <span className="text-xs text-orange-400">{highCnt} High</span>}
              </div>
              <div className="flex gap-1">
                {['all', 'Critical', 'High', 'Medium', 'Low'].map((p) => (
                  <button key={p} onClick={() => setPriorityFilter(p)} className={`text-xs px-2 py-0.5 rounded transition-colors ${priorityFilter === p ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}>{p === 'all' ? 'Tutti' : p}</button>
                ))}
              </div>
            </div>
            {openBugs.length === 0 ? (
              !client.client_code
                ? <div className="px-4 py-6 text-center text-slate-500 text-sm">Nessun codice cliente impostato — imposta un <strong>client_code</strong> per vedere i bug</div>
                : <div className="px-4 py-6 text-center text-slate-500 text-sm">Nessun bug aperto 🎉</div>
            ) : (
              <BugTable bugs={filteredOpen} />
            )}
          </div>

          {/* Resolved bugs (collapsible) */}
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b' }}>
            <button className="w-full px-4 py-3 border-b flex items-center justify-between hover:bg-slate-900/40 transition-colors" style={{ borderColor: '#1e293b', background: '#0f172a' }} onClick={() => setResolvedExpanded((v) => !v)}>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-200">Bug risolti</h3>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">{resolvedBugs.length}</span>
              </div>
              {resolvedExpanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
            </button>
            {resolvedExpanded && (
              resolvedBugs.length === 0
                ? <div className="px-4 py-6 text-center text-slate-500 text-sm">Nessun bug risolto</div>
                : <BugTable bugs={resolvedBugs} showResolved />
            )}
          </div>

          {/* Add touchpoint */}
          <div className="rounded-lg border p-4" style={{ borderColor: 'rgba(99,102,241,0.3)', background: 'rgba(49,46,129,0.12)' }}>
            <p className="text-xs font-semibold text-indigo-400 mb-3 uppercase tracking-wider">+ Nuovo touchpoint</p>
            <form onSubmit={handleAddTouchpoint} className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <input type="date" max={new Date().toISOString().split('T')[0]} className="flex h-9 shrink-0 rounded-md border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" style={{ borderColor: '#334155', background: '#1e293b', color: '#f1f5f9' }} value={tpDate} onChange={(e) => setTpDate(e.target.value)} />
                <div className="w-full sm:w-40 shrink-0">
                  <Select value={tpType} onValueChange={setTpType}>
                    <SelectTrigger><SelectValue placeholder="Tipo..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="teams">🎥 Meeting Teams</SelectItem>
                      <SelectItem value="email">📧 Email</SelectItem>
                      <SelectItem value="feedback">💬 Feedback Session</SelectItem>
                      <SelectItem value="training">🎓 Training</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" disabled={!tpType || tpLoading} className="shrink-0"><Plus className="h-4 w-4" />{tpLoading ? '...' : 'Aggiungi'}</Button>
              </div>
              <Textarea rows={2} placeholder="Note sul touchpoint (opzionale)..." value={tpNotes} onChange={(e) => setTpNotes(e.target.value)} />
            </form>
          </div>

          {/* Touchpoint timeline */}
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
            <div className="px-4 py-3 border-b" style={{ borderColor: '#1e293b' }}>
              <h3 className="text-sm font-semibold text-slate-200">Timeline touchpoints <span className="ml-2 text-xs font-normal text-slate-500">({touchpoints.length})</span></h3>
            </div>
            {touchpoints.length === 0
              ? <div className="px-4 py-8 text-center text-slate-500 text-sm italic">Nessun touchpoint registrato</div>
              : <div className="divide-y" style={{ borderColor: '#1e293b' }}>
                  {touchpoints.map((tp) => (
                    <div key={tp.id} className="flex items-start gap-3 px-4 py-3 group hover:bg-slate-900/50 transition-colors">
                      <div className={`mt-0.5 shrink-0 rounded-full p-1.5 ${tp.type === 'teams' ? 'bg-blue-500/15 text-blue-400' : tp.type === 'email' ? 'bg-green-500/15 text-green-400' : 'bg-purple-500/15 text-purple-400'}`}>
                        {TOUCHPOINT_ICONS[tp.type]}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium text-slate-200 capitalize">{tp.type}</span>
                          <span className="text-xs text-slate-500">{formatDate(tp.date)}</span>
                        </div>
                        {tp.notes && <p className="text-sm text-slate-400 mt-0.5 leading-relaxed">{tp.notes}</p>}
                      </div>
                      <button onClick={() => handleDeleteTouchpoint(tp.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-red-400 p-1"><X className="h-3.5 w-3.5" /></button>
                    </div>
                  ))}
                </div>
            }
          </div>
        </div>
      </main>
    </div>
  )
}

// ─── Tier badge ────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: number | null }) {
  const t = tier ?? 3
  const style = TIER_STYLES[t] ?? TIER_STYLES[3]
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold"
      style={{ background: style.bg, color: style.text }}
    >
      {style.label}
    </span>
  )
}

// ─── Monday cards ──────────────────────────────────────────────────

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

function formatArrFull(v: number | null): string {
  if (!v || v === 0) return '—'
  return v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

function ServiceEndCountdown({ dateStr }: { dateStr: string | null }) {
  if (!dateStr) return <span className="text-slate-600 text-xs">—</span>
  const days = Math.floor((new Date(dateStr).getTime() - Date.now()) / 86400000)
  const color = days < 0 ? 'text-red-400' : days <= 60 ? 'text-red-400' : days <= 90 ? 'text-yellow-400' : 'text-green-400'
  const label = days < 0 ? `Scaduto ${Math.abs(days)}gg fa` : days === 0 ? 'Scade oggi' : `${days}gg`
  const dateLabel = new Date(dateStr).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
  return (
    <div>
      <span className={`text-sm font-semibold tabular-nums ${color}`}>{label}</span>
      <span className="text-xs text-slate-500 ml-1.5">{dateLabel}</span>
    </div>
  )
}

function ContractCard({ client }: { client: ClientWithStats }) {
  const hasContractData = client.arr || client.service_end || client.service_start || client.total_contract_value
  if (!hasContractData) return null

  const flags: { label: string; color: string }[] = []
  if (client.is_renew && !['', 'no', '-', 'false'].includes(client.is_renew.toLowerCase())) flags.push({ label: 'Rinnovo', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' })
  if (client.is_closed && !['', 'no', '-', 'false'].includes(client.is_closed.toLowerCase())) flags.push({ label: 'Closed', color: 'bg-slate-500/15 text-slate-400 border-slate-500/30' })
  if (client.is_churn && !['', 'no', '-', 'false'].includes(client.is_churn.toLowerCase())) flags.push({ label: 'Churn', color: 'bg-red-500/15 text-red-400 border-red-500/30' })

  return (
    <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
      <p className="text-xs text-slate-500 uppercase tracking-wider">Contratto</p>

      {client.arr && (
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold text-indigo-400 tabular-nums">{formatArrFull(client.arr)}</span>
          <span className="text-xs text-slate-500">ARR</span>
        </div>
      )}

      {client.total_contract_value && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 text-xs">TCV</span>
          <span className="text-slate-300 font-medium tabular-nums">{formatArrFull(client.total_contract_value)}</span>
        </div>
      )}

      {client.service_start && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 text-xs">Inizio</span>
          <span className="text-slate-400 text-xs">{new Date(client.service_start).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
        </div>
      )}

      {client.service_end && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 text-xs shrink-0">Scadenza</span>
          <ServiceEndCountdown dateStr={client.service_end} />
        </div>
      )}

      {client.upsell && !['', 'no', '-'].includes(client.upsell.toLowerCase().trim()) && (
        <div className="rounded border border-green-500/20 bg-green-500/5 px-2.5 py-1.5 text-xs text-green-400">
          💡 Upsell: {client.upsell}
        </div>
      )}

      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {flags.map((f) => (
            <span key={f.label} className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${f.color}`}>{f.label}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Modules (products tag subscriptions) ───────────────────────────────────

const PRODUCTS_MODULE_TAGS: { key: string; label: string; tags: string[] }[] = [
  { key: 'home',        label: 'Home',              tags: ['S-Home'] },
  { key: 'quickwins',   label: 'Quick Wins',        tags: ['S-QuickWins'] },
  { key: 'sales',       label: 'Sales',             tags: ['S-Sales'] },
  { key: 'media',       label: 'Media',             tags: ['S-Media', 'S-AMC'] },
  { key: 'amc',         label: 'AMC',               tags: ['S-AMC'] },
  { key: 'category',    label: 'Category',          tags: ['S-Category', 'S-Category+MS'] },
  { key: 'seller',      label: 'Seller',            tags: ['S-Seller'] },
  { key: 'sell_in',     label: 'Sell-In',           tags: ['S-Sell-In'] },
  { key: 'product',     label: 'BuyBox/Content/Voice/Price', tags: ['S-Product'] },
  { key: 'multiretail', label: 'Studio Multiretail',tags: ['SMR'] },
]

function SModulesCard({ client }: { client: ClientWithStats }) {
  const parts = (client.products ?? '').split(',').map((t) => t.trim().toLowerCase())
  const entries = PRODUCTS_MODULE_TAGS.map(({ key, label, tags }) => ({
    key, label, subscribed: tags.some((tag) => parts.includes(tag.toLowerCase())),
  }))
  const hasAny = entries.some((e) => e.subscribed)
  if (!hasAny) return null

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b' }}>
      <div className="px-4 py-3 border-b" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
        <h3 className="text-sm font-semibold text-slate-200">Moduli sottoscritti</h3>
      </div>
      <div className="px-4 py-3 flex flex-wrap gap-1.5" style={{ background: '#0a0f1e' }}>
        {entries.map(({ key, label, subscribed }) => (
          <span
            key={key}
            className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-medium border ${
              subscribed
                ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
                : 'bg-slate-800/40 text-slate-600 border-slate-700/40'
            }`}
          >
            {subscribed ? '✓' : '—'} {label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Module comparison card ────────────────────────────────────────

type ModuleEntryDef = {
  key: string
  label: string
  productsTags: string[]
  clerkCheck: ((m: Record<string, unknown>) => boolean) | null
  posthogPath: string | null
}

const MODULE_ENTRIES: ModuleEntryDef[] = [
  { key: 'sales',       label: 'Sales',              productsTags: ['S-Sales'],                      clerkCheck: (m) => (m.sales as Record<string,unknown>)?.active === true,                                               posthogPath: 'Sales' },
  { key: 'media',       label: 'Media',              productsTags: ['S-Media', 'S-AMC'],             clerkCheck: (m) => (m.media as Record<string,unknown>)?.active === true,                                               posthogPath: 'Media' },
  { key: 'dsp',         label: 'DSP',                productsTags: [],                               clerkCheck: (m) => ((m.media as Record<string,unknown>)?.dsp as Record<string,unknown>)?.active === true,              posthogPath: 'DSP' },
  { key: 'amc',         label: 'AMC',                productsTags: ['S-AMC'],                        clerkCheck: (m) => ((m.media as Record<string,unknown>)?.amc as Record<string,unknown>)?.active === true,              posthogPath: 'AMC' },
  { key: 'category',    label: 'Category',           productsTags: ['S-Category', 'S-Category+MS'],  clerkCheck: (m) => (m.market as Record<string,unknown>)?.active === true,                                             posthogPath: 'Category Explorer' },
  { key: 'seller',      label: 'Seller',             productsTags: ['S-Seller'],                     clerkCheck: (m) => (m.amazonAccountType as Record<string,unknown>)?.seller === true,                                  posthogPath: 'Seller' },
  { key: 'buybox',      label: 'BuyBox',             productsTags: ['S-Product'],                    clerkCheck: (m) => (m.retail as Record<string,unknown>)?.active === true,                                             posthogPath: 'BuyBox' },
  { key: 'price',       label: 'Price & Deals',      productsTags: ['S-Product'],                    clerkCheck: (m) => (m.retail as Record<string,unknown>)?.active === true,                                             posthogPath: 'Price & Deals' },
  { key: 'content',     label: 'Content & SEO',      productsTags: ['S-Product'],                    clerkCheck: (m) => (m.retail as Record<string,unknown>)?.active === true,                                             posthogPath: 'Content & SEO' },
  { key: 'voice',       label: 'Customer Voice',     productsTags: ['S-Product'],                    clerkCheck: (m) => (m.retail as Record<string,unknown>)?.active === true,                                             posthogPath: 'Customer Voice' },
  { key: 'quickwins',   label: 'Quick Wins',         productsTags: ['S-QuickWins'],                  clerkCheck: (m) => (m.reports as Record<string,unknown>)?.active === true,                                             posthogPath: 'Quick Wins' },
  { key: 'sell_in',     label: 'Sell-In',            productsTags: ['S-Sell-In'],                    clerkCheck: (m) => (m.sellIn as Record<string,unknown>)?.active === true,                                              posthogPath: 'Sell-In' },
  { key: 'multiretail', label: 'Studio Multiretail', productsTags: ['SMR'],                          clerkCheck: null,                                                                                                     posthogPath: null },
  { key: 'home',        label: 'Home',               productsTags: ['__ALWAYS__'],                   clerkCheck: () => true,                                                                                               posthogPath: 'Home' },
]

function getModuleSignal(paid: boolean, clerkEnabled: boolean | null, views: number): { label: string; color: string; icon: string } {
  const used = views > 0
  if (paid  && clerkEnabled === true  && used)  return { label: 'Attivo e usato',          color: 'text-green-400',  icon: '✅' }
  if (paid  && clerkEnabled === true  && !used) return { label: 'Pagato ma non usato',     color: 'text-yellow-400', icon: '⚠️' }
  if (paid  && clerkEnabled === false && !used) return { label: 'Pagato ma non abilitato', color: 'text-red-400',    icon: '🔒' }
  if (paid  && clerkEnabled === null  && used)  return { label: 'Attivo (Clerk N/D)',       color: 'text-green-400',  icon: '✅' }
  if (paid  && clerkEnabled === null  && !used) return { label: 'Pagato (Clerk N/D)',       color: 'text-yellow-400', icon: '💰' }
  if (!paid && clerkEnabled === true  && used)  return { label: 'Upsell',                  color: 'text-blue-400',   icon: '💡' }
  if (!paid && clerkEnabled === true  && !used) return { label: 'Abilitato non usato',     color: 'text-yellow-400', icon: '😴' }
  if (!paid && clerkEnabled === false && used)  return { label: 'Usato senza accesso?',    color: 'text-orange-400', icon: '❓' }
  return { label: 'Non attivo', color: 'text-slate-600', icon: '—' }
}

function ModuleComparisonCard({ client, clerkRawMetadata, posthogModules, clerkLoading }: {
  client: ClientWithStats
  clerkRawMetadata: Record<string, unknown> | null
  posthogModules: Record<string, number>
  clerkLoading: boolean
}) {
  const entries = MODULE_ENTRIES.map((e) => {
    const paid = e.productsTags.includes('__ALWAYS__')
      ? true
      : e.productsTags.length > 0
        ? e.productsTags.some((tag) => (client.products ?? '').split(',').map((t) => t.trim().toLowerCase()).includes(tag.toLowerCase()))
        : false
    const clerkEnabled: boolean | null =
      clerkRawMetadata === null || e.clerkCheck === null
        ? null
        : e.clerkCheck(clerkRawMetadata)
    const views = e.posthogPath ? (posthogModules[e.posthogPath] ?? 0) : 0
    return { ...e, paid, clerkEnabled, views }
  }).filter((e) => e.paid || e.clerkEnabled === true || e.views > 0)

  if (entries.length === 0) return null

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b' }}>
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
        <h3 className="text-sm font-semibold text-slate-200">Moduli — confronto 3 livelli</h3>
        {clerkLoading && <span className="text-xs text-slate-500">Caricamento Clerk...</span>}
      </div>
      <div style={{ background: '#0a0f1e' }}>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b" style={{ borderColor: '#1e293b' }}>
              <th className="text-left px-4 py-2 text-slate-500 font-medium">Modulo</th>
              <th className="text-center px-3 py-2 text-slate-500 font-medium">💰 Contratto</th>
              <th className="text-center px-3 py-2 text-slate-500 font-medium">🔑 Clerk</th>
              <th className="text-center px-3 py-2 text-slate-500 font-medium">📊 PostHog</th>
              <th className="text-right px-4 py-2 text-slate-500 font-medium">Stato</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const sig = getModuleSignal(e.paid, e.clerkEnabled, e.views)
              return (
                <tr key={e.key} className="border-b hover:bg-slate-800/30 transition-colors" style={{ borderColor: '#1e293b' }}>
                  <td className="px-4 py-2 text-slate-300 font-medium">{e.label}</td>
                  <td className="px-3 py-2 text-center">
                    {e.productsTags.length === 0
                      ? <span className="text-slate-600">—</span>
                      : e.paid
                        ? <span className="font-bold text-green-400">Y</span>
                        : <span className="font-bold text-red-400">N</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {clerkRawMetadata === null || e.clerkCheck === null
                      ? <span className="text-slate-600">—</span>
                      : e.clerkEnabled
                        ? <span className="font-bold text-green-400">Y</span>
                        : <span className="font-bold text-red-400">N</span>}
                  </td>
                  <td className="px-3 py-2 text-center text-slate-400 tabular-nums">
                    {e.views > 0 ? e.views : <span className="text-slate-600">—</span>}
                  </td>
                  <td className={`px-4 py-2 text-right ${sig.color}`}>
                    {sig.icon} {sig.label}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── PostHog cards ─────────────────────────────────────────────────

function AdoptionBadge({ level }: { level: AdoptionLevel }) {
  const cls = ADOPTION_COLORS[level] ?? ADOPTION_COLORS['New']
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cls}`}>
      {level}
    </span>
  )
}

function TrendIcon({ current, prev, days = 30 }: { current: number; prev: number; days?: number }) {
  if (prev === 0) return null
  const pct = Math.round(((current - prev) / prev) * 100)
  const title = `vs ${days}gg precedenti (gg ${days + 1}–${days * 2})`
  if (Math.abs(pct) < 5) return <span title={title}><Minus className="h-3 w-3 text-slate-500 inline ml-1" /></span>
  if (pct > 0) return <span className="text-green-400 text-xs ml-1 inline-flex items-center gap-0.5" title={title}><TrendingUp className="h-3 w-3" />+{pct}%</span>
  return <span className="text-red-400 text-xs ml-1 inline-flex items-center gap-0.5" title={title}><TrendingDown className="h-3 w-3" />{pct}%</span>
}

function PostHogUsageCard({ clientCode, usage, loading, posthogConfigured, onRefresh }: {
  clientCode: string | null
  usage: UsageSummary | null
  loading: boolean
  posthogConfigured: boolean
  onRefresh: () => void
}) {
  if (!posthogConfigured) {
    return (
      <div className="rounded-lg border p-4 opacity-60" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
        <p className="text-xs text-slate-500 uppercase tracking-wider">Usage (PostHog)</p>
        <p className="text-xs text-slate-600 italic mt-1">Configura POSTHOG_API_KEY in .env.local</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="rounded-lg border p-4" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Usage (PostHog)</p>
        <p className="text-xs text-slate-600 animate-pulse">Caricamento...</p>
      </div>
    )
  }

  if (!usage) {
    return (
      <div className="rounded-lg border p-4" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-slate-500 uppercase tracking-wider">Usage (PostHog)</p>
          <button onClick={onRefresh} className="text-slate-600 hover:text-slate-400 transition-colors" title="Ricarica">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="text-xs text-slate-600 italic">Organization &quot;{clientCode}&quot; non trovata su PostHog</p>
        <AdoptionBadge level="New" />
      </div>
    )
  }

  function daysSinceLabel(iso: string | null): string {
    if (!iso) return '—'
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
    return d === 0 ? 'oggi' : `${d}gg fa`
  }
  function daysColor(iso: string | null): string {
    if (!iso) return 'text-slate-600'
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
    if (d <= 7) return 'text-green-400'
    if (d <= 30) return 'text-yellow-400'
    return 'text-red-400'
  }

  return (
    <div className="rounded-lg border p-4 space-y-3" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500 uppercase tracking-wider">Usage — ultimi {usage.period_days}gg</p>
        <button onClick={onRefresh} className="text-slate-600 hover:text-slate-400 transition-colors" title="Ricarica">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Last seen */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">🏢 Ultimo accesso ext</span>
          <span className={`text-xs font-medium tabular-nums ${daysColor(usage.last_seen_external?.last_seen_at ?? null)}`}>
            {daysSinceLabel(usage.last_seen_external?.last_seen_at ?? null)}
          </span>
        </div>
        {usage.last_seen_external?.email && (
          <p className="text-xs text-slate-600 truncate">{usage.last_seen_external.email}</p>
        )}
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">🏠 Ultimo accesso int</span>
          <span className={`text-xs font-medium tabular-nums ${daysColor(usage.last_seen_internal?.last_seen_at ?? null)}`}>
            {daysSinceLabel(usage.last_seen_internal?.last_seen_at ?? null)}
          </span>
        </div>
      </div>

      {/* Utenti attivi */}
      <div className="grid grid-cols-2 gap-2 pt-1 border-t" style={{ borderColor: '#1e293b' }}>
        <div>
          <p className="text-xs text-slate-500">Utenti ext</p>
          <p className="text-lg font-bold text-blue-400 tabular-nums">{usage.active_external}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Utenti int</p>
          <p className="text-lg font-bold text-slate-400 tabular-nums">{usage.active_internal}</p>
        </div>
      </div>

      {/* Sessioni */}
      <div className="grid grid-cols-2 gap-2 pt-1 border-t" style={{ borderColor: '#1e293b' }}>
        <div>
          <p className="text-xs text-slate-500">Pageview ext</p>
          <p className="text-sm font-semibold text-slate-200 tabular-nums">
            {usage.events_external}
            <TrendIcon current={usage.events_external} prev={usage.events_external_prev} />
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Pageview int</p>
          <p className="text-sm font-semibold text-slate-200 tabular-nums">
            {usage.events_internal}
            <TrendIcon current={usage.events_internal} prev={usage.events_internal_prev} />
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Sessioni ext</p>
          <p className="text-sm font-semibold text-slate-200 tabular-nums">
            {usage.sessions_external}
            <TrendIcon current={usage.sessions_external} prev={usage.sessions_external_prev} />
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Sessioni int</p>
          <p className="text-sm font-semibold text-slate-200 tabular-nums">
            {usage.sessions_internal}
            <TrendIcon current={usage.sessions_internal} prev={usage.sessions_internal_prev} />
          </p>
        </div>
      </div>

      <div className="pt-1 border-t" style={{ borderColor: '#1e293b' }}>
        <AdoptionBadge level={usage.adoption_level} />
        {usage.active_external === 0 && usage.active_internal > 0 && (
          <p className="text-xs text-yellow-500 mt-1">⚠ Solo internal — nessun accesso esterno</p>
        )}
      </div>

      <p className="text-xs text-slate-700">
        Sync: {new Date(usage.last_synced_at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}
      </p>
    </div>
  )
}

function ModulesCard({ usage }: { usage: UsageSummary }) {
  const entries = Object.entries(usage.modules).sort(([, a], [, b]) => b - a)
  if (!entries.length) return null
  const max = entries[0][1]

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b' }}>
      <div className="px-4 py-3 border-b" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
        <h3 className="text-sm font-semibold text-slate-200">Moduli utilizzati <span className="text-xs font-normal text-slate-500 ml-1">(ultimi {usage.period_days}gg, solo external)</span></h3>
      </div>
      <div className="px-4 py-3 space-y-2" style={{ background: '#0a0f1e' }}>
        {entries.map(([mod, cnt]) => (
          <div key={mod} className="flex items-center gap-3">
            <div className="w-28 text-xs text-slate-400 shrink-0 truncate">{mod}</div>
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: '#1e293b' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${(cnt / max) * 100}%`, background: '#3b82f6' }}
              />
            </div>
            <div className="w-10 text-xs text-slate-500 text-right tabular-nums shrink-0">{cnt}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function UsersCard({ usage, internalExpanded, onToggleInternal }: {
  usage: UsageSummary
  internalExpanded: boolean
  onToggleInternal: () => void
}) {
  if (!usage.users_external.length && !usage.users_internal.length) return null

  function formatLastSeen(iso: string): string {
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
    return d === 0 ? 'oggi' : `${d}gg fa`
  }
  function lastSeenColor(iso: string): string {
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
    if (d <= 7) return 'text-green-400'
    if (d <= 30) return 'text-yellow-400'
    return 'text-red-400'
  }

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b' }}>
      <div className="px-4 py-3 border-b" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
        <h3 className="text-sm font-semibold text-slate-200">Utenti attivi <span className="text-xs font-normal text-slate-500 ml-1">(ultimi {usage.period_days}gg)</span></h3>
      </div>
      <div style={{ background: '#0a0f1e' }}>
        {/* External users */}
        {usage.users_external.length > 0 && (
          <div className="px-4 py-3 space-y-2">
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">🏢 External ({usage.users_external.length})</p>
            {usage.users_external.map((u) => (
              <div key={u.email} className="flex items-center gap-2 text-sm">
                <span className="flex-1 text-slate-300 truncate font-mono text-xs">{u.email}</span>
                <span className={`text-xs tabular-nums shrink-0 ${lastSeenColor(u.last_seen_at)}`}>{formatLastSeen(u.last_seen_at)}</span>
                <span className="text-xs text-slate-600 tabular-nums shrink-0 w-16 text-right">{u.events} pv</span>
              </div>
            ))}
          </div>
        )}
        {usage.users_external.length === 0 && (
          <div className="px-4 py-3 text-xs text-yellow-500">⚠ Nessun utente external attivo</div>
        )}

        {/* Internal users — collapsible */}
        {usage.users_internal.length > 0 && (
          <>
            <button
              className="w-full px-4 py-2 flex items-center justify-between text-xs text-slate-500 hover:bg-slate-900/40 transition-colors border-t"
              style={{ borderColor: '#1e293b' }}
              onClick={onToggleInternal}
            >
              <span>🏠 Internal ({usage.users_internal.length})</span>
              {internalExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {internalExpanded && (
              <div className="px-4 py-2 space-y-2">
                {usage.users_internal.map((u) => (
                  <div key={u.email} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 text-slate-500 truncate font-mono text-xs">{u.email}</span>
                    <span className={`text-xs tabular-nums shrink-0 ${lastSeenColor(u.last_seen_at)}`}>{formatLastSeen(u.last_seen_at)}</span>
                    <span className="text-xs text-slate-600 tabular-nums shrink-0 w-16 text-right">{u.events} pv</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Bug table ─────────────────────────────────────────────────────

function BugTable({ bugs, showResolved = false }: { bugs: Bug[]; showResolved?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b" style={{ borderColor: '#1e293b', background: '#0a0f1e' }}>
            <th className="text-left px-4 py-2 text-xs font-medium text-slate-500">Titolo</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 whitespace-nowrap">Priorità</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 whitespace-nowrap hidden sm:table-cell">Modulo</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 whitespace-nowrap hidden md:table-cell">Tool</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 whitespace-nowrap">Status</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 whitespace-nowrap hidden lg:table-cell">Data</th>
            {showResolved && <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 whitespace-nowrap hidden lg:table-cell">Due date</th>}
            <th className="px-3 py-2 w-8" />
          </tr>
        </thead>
        <tbody>
          {bugs.map((bug) => (
            <tr key={bug.id} className="border-b hover:bg-slate-900/40 transition-colors" style={{ borderColor: '#1e293b' }}>
              <td className="px-4 py-2.5 max-w-[280px]">
                <span className="text-slate-200 text-sm leading-snug line-clamp-2">{bug.bug_title}</span>
                {bug.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{bug.description}</p>}
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap">
                {bug.priority && (
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[bug.priority] ?? 'bg-slate-700 text-slate-300'}`}>{bug.priority}</span>
                )}
              </td>
              <td className="px-3 py-2.5 text-xs text-slate-400 whitespace-nowrap hidden sm:table-cell">{bug.modulo ?? '—'}</td>
              <td className="px-3 py-2.5 text-xs text-slate-400 whitespace-nowrap hidden md:table-cell">{bug.tool ?? '—'}</td>
              <td className="px-3 py-2.5 whitespace-nowrap">
                {bug.status && (
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[bug.status] ?? 'bg-slate-700 text-slate-300'}`}>{bug.status}</span>
                )}
              </td>
              <td className="px-3 py-2.5 text-xs text-slate-400 whitespace-nowrap hidden lg:table-cell">{bug.date_reported ? formatDate(bug.date_reported) : '—'}</td>
              {showResolved && <td className="px-3 py-2.5 text-xs text-slate-400 whitespace-nowrap hidden lg:table-cell">{bug.due_date ? formatDate(bug.due_date) : '—'}</td>}
              <td className="px-3 py-2.5">
                {bug.notion_url && (
                  <a href={bug.notion_url} target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:text-indigo-400 transition-colors" title="Apri in Notion"><ExternalLink className="h-3.5 w-3.5" /></a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Utility components ────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-xs text-slate-500 block mb-1">{label}</label>{children}</div>
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode | string | null | undefined }) {
  if (!value) return null
  return (
    <div>
      <span className="text-xs text-slate-500">{label}: </span>
      {typeof value === 'string' ? <span className="text-sm text-slate-300">{value}</span> : value}
    </div>
  )
}

function InfoRowAlways({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <span className="text-xs text-slate-500">{label}: </span>
      {value ? <span className="text-sm text-slate-300">{value}</span> : <span className="text-sm text-slate-600">—</span>}
    </div>
  )
}

// ─── Prepare Session Card (AI-generated script) ────────────────────

function PrepareSessionCard({ clientId }: { clientId: number }) {
  const [script, setScript] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transcriptCount, setTranscriptCount] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const [tokenUsage, setTokenUsage] = useState<{ input: number; output: number; cache_read: number } | null>(null)

  async function handleGenerate() {
    setLoading(true)
    setError(null)
    setScript(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/generate-script`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? `Errore ${res.status}`)
        return
      }
      const data = await res.json()
      setScript(data.script)
      setTranscriptCount(data.context?.transcripts?.length ?? 0)
      setTokenUsage({
        input: data.usage?.input_tokens ?? 0,
        output: data.usage?.output_tokens ?? 0,
        cache_read: data.usage?.cache_read ?? 0,
      })
    } catch {
      setError('Errore di rete')
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    if (!script) return
    await navigator.clipboard.writeText(script)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#1e293b' }}>
      <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-purple-400" />
          <h3 className="text-sm font-semibold text-slate-200">Prepare Session</h3>
          <span className="text-xs text-slate-500">AI-generated script</span>
        </div>
        <div className="flex items-center gap-2">
          {script && (
            <button
              onClick={handleCopy}
              className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 transition-colors inline-flex items-center gap-1"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? 'Copiato' : 'Copia'}
            </button>
          )}
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded bg-purple-500/15 border border-purple-500/40 text-purple-300 hover:bg-purple-500/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
          >
            <Sparkles className="h-3 w-3" />
            {loading ? 'Generando...' : script ? 'Rigenera' : 'Genera script'}
          </button>
        </div>
      </div>
      <div className="px-4 py-4" style={{ background: '#0a0f1e' }}>
        {!script && !loading && !error && (
          <p className="text-xs text-slate-500">
            Clicca &quot;Genera script&quot; per creare uno script personalizzato per la prossima feedback session, basato su utilizzo, bug aperti, contratto e transcript delle sessioni precedenti.
          </p>
        )}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Analisi contesto e generazione in corso...
          </div>
        )}
        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
            {error}
          </div>
        )}
        {script && (
          <>
            <div className="flex items-center gap-3 text-xs text-slate-500 mb-3 pb-2 border-b" style={{ borderColor: '#1e293b' }}>
              <span>📄 {transcriptCount} transcript usati</span>
              {tokenUsage && (
                <>
                  <span>•</span>
                  <span className="tabular-nums">{tokenUsage.input} in / {tokenUsage.output} out tokens</span>
                  {tokenUsage.cache_read > 0 && (
                    <>
                      <span>•</span>
                      <span className="text-green-400 tabular-nums">{tokenUsage.cache_read} cached</span>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed prose prose-sm prose-invert max-w-none">
              {script}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
