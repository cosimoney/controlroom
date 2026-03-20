# CLAUDE.md — CSM Command Center

## Progetto

CSM Command Center: dashboard web per Customer Success Manager. Stack: Next.js 14+ (App Router) + SQLite (better-sqlite3 o sql.js) + Tailwind + shadcn/ui. Deploy: Google Antigravity (IDE cloud).

## Principi fondamentali

1. **Server First**: default Server Components, `'use client'` solo per interattività (form, dialog, chart)
2. **Type Everything**: TypeScript strict, zero `any`, tutte le props/functions tipizzate
3. **Single Responsibility**: ogni file = 1 job. Le pagine sono orchestratori puri (max 20-30 righe)
4. **Separation of Concerns**: logica separata da presentazione, data access isolato
5. **Explicit > Implicit**: codice auto-documentante, nomi espliciti, no magic numbers

## Struttura file

```
/app
  /(routes)/            # Route groups
  /api/                 # API routes (clienti, touchpoints, bugs, posthog)
  /[route]/
    page.tsx            # Pagina (orchestrazione pura, max 20-30 righe)
    loading.tsx         # Loading UI
    error.tsx           # Error handling
/components
  /ui/                  # Design system base (shadcn/ui components)
  /features/            # Feature-specific (ClientTable, QuickLogBar, BugList...)
/lib
  /actions/             # Server Actions (mutations: crea touchpoint, importa CSV)
  /queries/             # Data fetching (read: lista clienti, bug, stats)
  /hooks/               # Custom React hooks (useFilters, useDebounce...)
  /utils/               # Pure utility functions (health score, date formatting)
  /services/            # Business logic complessa (PostHog sync, Notion sync)
  /db/                  # Database access (SQLite queries, migrations, seed)
/types                  # TypeScript interfaces/types
```

## Regole pagine

### Una pagina DEVE:
- Chiamare 1-3 funzioni di data fetching
- Comporre componenti feature
- Passare props ai componenti
- Nient'altro

### Una pagina NON DEVE:
- Contenere query SQL o logica business
- Fare trasformazioni dati inline (.map/.filter con logica)
- Gestire state (useState, useReducer)
- Avere più di 30 righe di codice
- Contenere try/catch (usa error.tsx)

### Esempio pagina ideale
```typescript
// app/page.tsx
import { getClientsWithStats } from '@/lib/queries/client.queries';
import { Dashboard } from '@/components/features/dashboard/Dashboard';

export default async function HomePage() {
  const clients = await getClientsWithStats();
  return <Dashboard clients={clients} />;
}
```

## Regole componenti

- **Server Components (default)**: per data fetching e rendering statico
- **Client Components ('use client')**: SOLO per interattività (Quick Log Bar, filtri, form, dialog)
- File componente max 150 righe — se più lungo, split
- Composizione > configurazione (usa children, non mega-props)

## Regole data access

- Tutte le query SQL in `/lib/db/` o `/lib/queries/`
- MAI query SQL inline nei componenti o nelle pagine
- Le API routes in `/app/api/` sono wrapper sottili che chiamano funzioni in `/lib/`
- Ogni query ha il suo tipo di ritorno definito in `/types/`

## Naming conventions

- **Componenti**: `PascalCase.tsx` (ClientTable.tsx, QuickLogBar.tsx)
- **Hooks**: `use[Name].ts` (useClientFilters.ts)
- **Queries**: `[entity].queries.ts` (client.queries.ts, bug.queries.ts)
- **Actions**: `[entity].actions.ts` (touchpoint.actions.ts)
- **Utils**: `[entity].util.ts` (healthScore.util.ts, date.util.ts)
- **Services**: `[entity].service.ts` (posthog.service.ts, notion.service.ts)
- **Types**: `[entity].types.ts` (client.types.ts)

## Database

- SQLite con better-sqlite3 (o sql.js come fallback)
- Connessione centralizzata in `/lib/db/index.ts`
- Migrations in `/lib/db/migrations/`
- Seed data in `/lib/db/seed.ts`
- Il file .db va in `/data/` ed è in .gitignore

## Health Score

La formula è a 3 componenti + tier penalty:
- 35% recency (touchpoint con peso tipo: call=1.0, meeting=1.0, mail=0.5)
- 30% bug (conteggio aperti, Critical conta doppio, bonus risoluzione)
- 35% usage (adoption PostHog: Self-serve/Supported/PM-driven/Dormant/New)
- Tier penalty: amplifica urgenza per Tier 1/2 quando score < 60

Questa logica DEVE stare in `/lib/utils/healthScore.util.ts`, non sparsa nei componenti.

## Integrazioni esterne

- **Notion**: API o CSV import. Service in `/lib/services/notion.service.ts`
- **PostHog**: API con cache locale 30min. Service in `/lib/services/posthog.service.ts`
- **Monday**: futuro (Fase 4). Service in `/lib/services/monday.service.ts`
- Tutte le API key in `.env.local`, mai hardcoded

## Domini interni (PostHog)

Email interne = contiene: `witailer`, `retex`, `alkemy`
Tutto il resto = external (utenti del brand/cliente)
Funzione `isInternalUser(email)` in `/lib/utils/domain.util.ts`

## Client Code (chiave universale)

Il campo `client_code` collega tutti i sistemi:
- Monday: client code
- Notion: Reported By
- PostHog: organization
- CSM App: clients.client_code

Match sempre case-insensitive + trim.

## Regole per modifiche future

- NON refactorare codice esistente che funziona, a meno che non sia richiesto esplicitamente
- Quando aggiungi nuove feature, segui la struttura sopra
- Se un file esistente non segue queste convenzioni, allinealo SOLO se lo stai già modificando
- Ogni modifica deve essere retrocompatibile con i dati esistenti nel DB
- Mai cancellare tabelle o colonne — solo aggiungere

## Error handling

- Pagine: usa `error.tsx` per error boundaries
- API routes: try/catch con risposta JSON `{ error: "messaggio" }`
- Servizi esterni (Notion, PostHog): retry con backoff, fallback a cache locale
- UI: mostra banner/toast per errori, non crash
