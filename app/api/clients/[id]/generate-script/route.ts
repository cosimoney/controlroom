import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import type { UsageSummary } from '@/lib/types'

const MODEL = 'claude-sonnet-4-6'
const MAX_TRANSCRIPTS = 3
const LATEST_TRANSCRIPT_MAX_CHARS = 30000 // full text cap for most recent session

interface ClientContext {
  client: {
    id: number
    name: string
    client_code: string
    tier: number | null
    arr: number | null
    products: string | null
    service_end: string | null
    client_manager: string | null
    am_owner: string | null
    potential_churn: string | null
  }
  last_touchpoint: { date: string; type: string; notes: string | null } | null
  days_since_contact: number | null
  usage: {
    adoption_level: string | null
    active_external: number
    active_internal: number
    sessions_current: number | null
    sessions_previous: number | null
    sessions_delta_pct: number | null
    modules: Record<string, number> | null
    last_seen_external: string | null
    top_external_users: Array<{ email: string; events: number; last_seen_at: string }>
  }
  bugs: { open: number; critical: number; high: number; resolved: number }
  transcripts: Array<{
    date: string
    session_id: string | null
    products: string | null
    content_type: 'full' | 'summary'
    content: string
  }>
}

function daysBetween(iso: string | null): number | null {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

async function buildContext(clientId: number): Promise<ClientContext | null> {
  const sql = await db()

  const [client] = await sql<ClientContext['client'][]>`
    SELECT id, name, client_code, tier, arr, products, service_end,
           client_manager, am_owner, potential_churn
    FROM clients WHERE id = ${clientId}
  `
  if (!client) return null

  const tpRows = await sql<{ date: string; type: string; notes: string | null }[]>`
    SELECT date, type, notes FROM touchpoints
    WHERE client_id = ${clientId} ORDER BY date DESC, created_at DESC LIMIT 1
  `
  const tp = tpRows[0]

  const bugsRows = await sql<{ open_count: number; critical_count: number; high_count: number; resolved_count: number }[]>`
    SELECT
      SUM(CASE WHEN status IN ('Open','In Progress','Testing') THEN 1 ELSE 0 END)::int AS open_count,
      SUM(CASE WHEN status IN ('Open','In Progress','Testing') AND priority = 'Critical' THEN 1 ELSE 0 END)::int AS critical_count,
      SUM(CASE WHEN status IN ('Open','In Progress','Testing') AND priority = 'High' THEN 1 ELSE 0 END)::int AS high_count,
      SUM(CASE WHEN status IN ('Fixed','Closed') THEN 1 ELSE 0 END)::int AS resolved_count
    FROM bugs WHERE LOWER(TRIM(reported_by)) = LOWER(TRIM(${client.client_code}))
  `
  const bugs = bugsRows[0]

  const phRows = await sql<{ value: string }[]>`
    SELECT value FROM posthog_usage_cache
    WHERE LOWER(TRIM(client_code)) = LOWER(TRIM(${client.client_code}))
      AND metric_type = 'summary' AND user_type = 'all' AND period_days = 30
  `
  const phRow = phRows[0]

  let usage: ClientContext['usage'] = {
    adoption_level: null,
    active_external: 0,
    active_internal: 0,
    sessions_current: null,
    sessions_previous: null,
    sessions_delta_pct: null,
    modules: null,
    last_seen_external: null,
    top_external_users: [],
  }

  if (phRow) {
    try {
      const s = JSON.parse(phRow.value) as UsageSummary & {
        sessions_external?: number
        sessions_external_prev?: number
        modules?: Record<string, number>
        users_external?: Array<{ email: string; events: number; last_seen_at: string }>
      }
      const sessionsCurr = s.sessions_external ?? null
      const sessionsPrev = s.sessions_external_prev ?? null
      let delta: number | null = null
      if (sessionsCurr !== null && sessionsPrev !== null && sessionsPrev > 0) {
        delta = Math.round(((sessionsCurr - sessionsPrev) / sessionsPrev) * 100)
      }
      usage = {
        adoption_level: s.adoption_level ?? null,
        active_external: s.active_external ?? 0,
        active_internal: s.active_internal ?? 0,
        sessions_current: sessionsCurr,
        sessions_previous: sessionsPrev,
        sessions_delta_pct: delta,
        modules: s.modules ?? null,
        last_seen_external: s.last_seen_external?.last_seen_at ?? null,
        top_external_users: (s.users_external ?? []).slice(0, 5),
      }
    } catch { /* ignore */ }
  }

  const transcripts = await sql<Array<{
    session_date: string; session_id: string | null; products: string | null;
    transcript_text: string | null; transcript_summary: string | null
  }>>`
    SELECT session_date, session_id, products, transcript_text, transcript_summary
    FROM feedback_transcripts
    WHERE LOWER(TRIM(client_code)) = LOWER(TRIM(${client.client_code}))
    ORDER BY session_date DESC
    LIMIT ${MAX_TRANSCRIPTS}
  `

  // Hybrid: first (most recent) transcript = full text, older ones = summary
  const transcriptsContext = transcripts.map((t, idx) => {
    const isLatest = idx === 0
    let contentType: 'full' | 'summary' = 'summary'
    let content = ''
    if (isLatest && t.transcript_text) {
      contentType = 'full'
      content = t.transcript_text.slice(0, LATEST_TRANSCRIPT_MAX_CHARS)
      if (t.transcript_text.length > LATEST_TRANSCRIPT_MAX_CHARS) {
        content += '\n\n[... transcript troncato per lunghezza ...]'
      }
    } else if (t.transcript_summary) {
      content = t.transcript_summary
    } else if (t.transcript_text) {
      // Fallback: no summary available, use truncated text
      content = t.transcript_text.slice(0, 4000)
      contentType = 'summary'
    }
    return {
      date: t.session_date,
      session_id: t.session_id,
      products: t.products,
      content_type: contentType,
      content,
    }
  })

  return {
    client,
    last_touchpoint: tp ?? null,
    days_since_contact: tp ? daysBetween(tp.date) : null,
    usage,
    bugs: {
      open: bugs?.open_count ?? 0,
      critical: bugs?.critical_count ?? 0,
      high: bugs?.high_count ?? 0,
      resolved: bugs?.resolved_count ?? 0,
    },
    transcripts: transcriptsContext,
  }
}

// ─── Rule-based skeleton: computes talking points from signals ─────────

function buildSkeleton(ctx: ClientContext): {
  structured_signals: string[]
  talking_points: string[]
} {
  const signals: string[] = []
  const points: string[] = []

  // Contract expiration
  if (ctx.client.service_end) {
    const daysToEnd = Math.floor((new Date(ctx.client.service_end).getTime() - Date.now()) / 86400000)
    if (daysToEnd >= 0 && daysToEnd <= 90) {
      signals.push(`⚠️ Contratto scade in ${daysToEnd} giorni (${ctx.client.service_end})`)
      points.push('Allineamento sul rinnovo — raccogli aspettative e obiezioni')
    } else if (daysToEnd < 0) {
      signals.push(`🔴 Contratto scaduto ${-daysToEnd} giorni fa`)
    }
  }

  // Usage trend
  if (ctx.usage.sessions_delta_pct !== null) {
    const d = ctx.usage.sessions_delta_pct
    if (d < -25) {
      signals.push(`📉 Sessioni in calo del ${d}% vs periodo precedente (${ctx.usage.sessions_previous}→${ctx.usage.sessions_current})`)
      points.push('Esplora il calo di utilizzo — capire se è stagionale, cambio processo interno, problemi tool')
    } else if (d > 25) {
      signals.push(`📈 Sessioni in crescita del +${d}% vs periodo precedente`)
      points.push('Riconosci e valorizza la crescita — capire cosa sta funzionando per replicarlo')
    }
  }

  // Adoption level
  if (ctx.usage.adoption_level === 'Dormant') {
    signals.push('🔴 Adoption: Dormant — cliente praticamente non usa Studio')
    points.push('Capire cosa blocca l\'adozione, offrire training mirato o demo su casi concreti')
  } else if (ctx.usage.adoption_level === 'PM-driven') {
    signals.push('⚠️ Adoption: PM-driven — usato solo via PM, nessun power user lato cliente')
    points.push('Identificare un champion interno al cliente da formare')
  }

  // Module usage vs contract
  if (ctx.client.products && ctx.usage.modules) {
    const contracted = ctx.client.products.split(',').map((p) => p.trim().toLowerCase())
    const used = Object.keys(ctx.usage.modules).map((m) => m.toLowerCase())
    const notUsed = contracted.filter((c) => !used.some((u) => u.includes(c.replace('s-', '').toLowerCase())))
    if (notUsed.length > 0) {
      signals.push(`💰 Moduli a contratto non usati: ${notUsed.join(', ')}`)
      points.push(`Rilevare se c'è interesse a riattivare i moduli contracted ma non usati`)
    }
  }

  // Bugs
  if (ctx.bugs.critical > 0) {
    signals.push(`🐛 ${ctx.bugs.critical} bug critici aperti`)
    points.push('Aggiornamento status bug critici — comunicare ETA e workaround')
  } else if (ctx.bugs.high > 0) {
    signals.push(`🐛 ${ctx.bugs.high} bug high priority aperti`)
    points.push('Status bug high priority aperti')
  }

  // Churn
  if (ctx.client.potential_churn && !['', 'no', '-'].includes(ctx.client.potential_churn.toLowerCase().trim())) {
    signals.push('🚨 Flag: Potential churn')
    points.push('Conversazione aperta su retention — capire cause e possibili leve di salvataggio')
  }

  // Days since contact
  if (ctx.days_since_contact === null) {
    signals.push('⚠️ Mai contattato prima')
    points.push('Presentazione del ruolo CSM e obiettivi della relazione')
  } else if (ctx.days_since_contact > 45) {
    signals.push(`⏰ Ultimo contatto ${ctx.days_since_contact} giorni fa`)
  }

  // Top users
  if (ctx.usage.top_external_users.length > 0) {
    const top = ctx.usage.top_external_users[0]
    points.push(`Chiedere feedback diretto a ${top.email} (top user con ${top.events} eventi)`)
  }

  // Fallback if no signals
  if (points.length === 0) {
    points.push('Check-in generale: come sta andando l\'utilizzo di Studio?')
    points.push('Feedback su ultime release o miglioramenti desiderati')
  }

  return { structured_signals: signals, talking_points: points }
}

// ─── Main handler ──────────────────────────────────────────────────────

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const clientId = parseInt(id, 10)
  if (isNaN(clientId)) return NextResponse.json({ error: 'Invalid client id' }, { status: 400 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })

  const ctx = await buildContext(clientId)
  if (!ctx) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  const skeleton = buildSkeleton(ctx)

  // Build structured prompt for Claude
  const contextBlock = `
## Cliente
- Nome: ${ctx.client.name} (${ctx.client.client_code})
- Tier: ${ctx.client.tier ?? 'N/D'}
- ARR: €${ctx.client.arr ?? 0}
- Prodotti a contratto: ${ctx.client.products ?? 'N/D'}
- Contract end: ${ctx.client.service_end ?? 'N/D'}
- Client Manager: ${ctx.client.client_manager ?? 'N/D'}
- AM Owner: ${ctx.client.am_owner ?? 'N/D'}
- Potential churn flag: ${ctx.client.potential_churn ?? 'No'}

## Ultimo contatto
${ctx.last_touchpoint ? `- Data: ${ctx.last_touchpoint.date} (${ctx.days_since_contact} giorni fa)\n- Tipo: ${ctx.last_touchpoint.type}\n- Note: ${ctx.last_touchpoint.notes ?? 'nessuna'}` : 'Mai contattato'}

## Utilizzo (ultimi 30 giorni)
- Adoption level: ${ctx.usage.adoption_level ?? 'N/D'}
- Utenti attivi external: ${ctx.usage.active_external}
- Utenti attivi internal (Witailer): ${ctx.usage.active_internal}
- Sessioni periodo corrente: ${ctx.usage.sessions_current ?? 'N/D'}
- Sessioni periodo precedente: ${ctx.usage.sessions_previous ?? 'N/D'}
- Delta %: ${ctx.usage.sessions_delta_pct !== null ? `${ctx.usage.sessions_delta_pct}%` : 'N/D'}
- Ultimo accesso external: ${ctx.usage.last_seen_external ?? 'N/D'}
- Moduli usati: ${ctx.usage.modules ? Object.entries(ctx.usage.modules).map(([m, c]) => `${m} (${c} PV)`).join(', ') : 'N/D'}
- Top utenti external: ${ctx.usage.top_external_users.map((u) => `${u.email} (${u.events} eventi)`).join('; ') || 'nessuno'}

## Bug
- Open: ${ctx.bugs.open} (critical: ${ctx.bugs.critical}, high: ${ctx.bugs.high})
- Resolved totali: ${ctx.bugs.resolved}

## Segnali calcolati (da regole)
${skeleton.structured_signals.map((s) => `- ${s}`).join('\n') || '- Nessun segnale particolare'}

## Talking points suggeriti (da regole)
${skeleton.talking_points.map((p) => `- ${p}`).join('\n')}

## Transcript sessioni precedenti (più recenti prima)
${ctx.transcripts.length === 0
  ? 'Nessun transcript disponibile'
  : ctx.transcripts.map((t, i) => {
    const kind = t.content_type === 'full' ? 'TRANSCRIPT COMPLETO' : 'RIASSUNTO STRUTTURATO'
    return `### Sessione ${i + 1} — ${t.date} ${t.session_id ? `(${t.session_id})` : ''} — ${kind}
${t.content}
`
  }).join('\n---\n')}
`

  const systemPrompt = `Sei un coach esperto di Customer Success per una SaaS B2B (Witailer Studio, analytics per brand su Amazon). Il tuo compito è preparare script naturali e personalizzati per feedback session con clienti esistenti, basandoti su dati di utilizzo, bug aperti, scadenze contratto e transcript di sessioni precedenti.

Regole:
1. Lo script deve essere CONVERSAZIONALE, non un elenco di bullet secchi. Immagina le parole che il CSM dirà davvero.
2. Struttura lo script in 4 sezioni: **Apertura**, **Argomenti principali**, **Domande aperte**, **Chiusura e next steps**.
3. Per ogni sezione fornisci 2-4 frasi/domande concrete pronte da usare.
4. Collega SEMPRE gli argomenti a dati specifici forniti nel contesto (es: "abbiamo visto un calo del 32% nelle sessioni", "Marco aveva menzionato un problema con il filtro categoria nella sessione di novembre"). Non essere generico.
5. Se ci sono transcript precedenti, fai follow-up diretto su temi, promesse o problemi emersi — cita date e persone. NOTA: la sessione più recente è fornita come TRANSCRIPT COMPLETO (parole esatte, possibilità di citazione letterale), mentre le sessioni più vecchie sono fornite come RIASSUNTO STRUTTURATO (macro-temi, non parole esatte). Usa le citazioni letterali solo dalla sessione più recente.
6. Se ci sono bug critici o contratto in scadenza, affronta proattivamente quelli come argomenti centrali.
7. Il tono deve essere professionale ma umano — italiano, seconda persona formale ("Come state trovando...", "Vi andrebbe di...").
8. Lunghezza totale: 400-700 parole. Non sforare.
9. Output in Markdown pulito.
10. NON inserire un titolo principale, nome del CSM, nome cliente o data sessione all'inizio — quelle informazioni sono già visibili nell'interfaccia. Inizia direttamente dalla sezione **Apertura**.`

  const userPrompt = `Genera lo script per la prossima feedback session con questo cliente.

${contextBlock}`

  const anthropic = new Anthropic({ apiKey })

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' }, // cache the system prompt across calls
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    })

    const scriptText = response.content
      .filter((c) => c.type === 'text')
      .map((c) => (c as { text: string }).text)
      .join('\n')

    return NextResponse.json({
      script: scriptText,
      context: ctx,
      skeleton,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation: response.usage.cache_creation_input_tokens ?? 0,
        cache_read: response.usage.cache_read_input_tokens ?? 0,
      },
    })
  } catch (e) {
    return NextResponse.json({ error: `Claude API error: ${String(e)}` }, { status: 502 })
  }
}
