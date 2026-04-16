'use client'
import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AlertCircle, CheckCircle2, Loader2, Mail, KeyRound } from 'lucide-react'

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const errorParam = searchParams.get('error')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(
    errorParam === 'unauthorized'
      ? 'Il tuo account non è autorizzato ad accedere a questo tool.'
      : errorParam === 'link_expired'
        ? 'Il codice è scaduto. Richiedine uno nuovo.'
        : null,
  )

  async function handleRequestCode(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) {
      setError('Inserisci un indirizzo email valido')
      setLoading(false)
      return
    }

    try {
      const supabase = createClient()
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { shouldCreateUser: true },
      })
      if (authError) {
        setError(authError.message)
      } else {
        setStep('code')
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const trimmedCode = code.replace(/\s+/g, '').trim()
    if (!/^\d{6,8}$/.test(trimmedCode)) {
      setError('Il codice deve essere di 6-8 cifre')
      setLoading(false)
      return
    }

    try {
      const supabase = createClient()
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: trimmedCode,
        type: 'email',
      })
      if (verifyError) {
        setError(verifyError.message)
      } else {
        router.push('/')
        router.refresh()
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#020817', color: '#f1f5f9' }}>
      <div className="w-full max-w-sm rounded-lg border p-8 space-y-6" style={{ borderColor: '#1e293b', background: '#0f172a' }}>
        <div className="text-center space-y-2">
          <h1 className="text-xl font-bold text-white">CSM Command Center</h1>
          <p className="text-xs text-slate-500">
            {step === 'email' ? 'Accedi con la tua email Witailer' : `Codice inviato a ${email}`}
          </p>
        </div>

        {error && (
          <div className="flex gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded p-3">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {step === 'email' ? (
          <form onSubmit={handleRequestCode} className="space-y-3">
            <div>
              <label htmlFor="email" className="block text-xs text-slate-400 mb-1.5">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                disabled={loading}
                placeholder="nome.cognome@witailer.com"
                className="w-full h-10 rounded-md border px-3 text-sm outline-none placeholder-slate-600 focus:border-indigo-500 transition-colors"
                style={{ borderColor: '#334155', background: '#1e293b', color: '#f1f5f9' }}
              />
            </div>
            <button
              type="submit"
              disabled={loading || !email}
              className="w-full h-10 rounded-md font-medium text-sm inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              {loading ? 'Invio...' : 'Invia codice'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCode} className="space-y-3">
            <div className="flex gap-2 text-xs text-green-400 bg-green-500/10 border border-green-500/30 rounded p-3">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Controlla la tua casella e inserisci il codice a 6 cifre (scade in 1 ora).</span>
            </div>
            <div>
              <label htmlFor="code" className="block text-xs text-slate-400 mb-1.5">Codice di verifica</label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6,8}"
                maxLength={8}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                autoComplete="one-time-code"
                autoFocus
                required
                disabled={loading}
                placeholder="00000000"
                className="w-full h-12 rounded-md border px-3 text-center text-2xl tracking-widest font-mono outline-none placeholder-slate-700 focus:border-indigo-500 transition-colors"
                style={{ borderColor: '#334155', background: '#1e293b', color: '#f1f5f9' }}
              />
            </div>
            <button
              type="submit"
              disabled={loading || code.length < 6}
              className="w-full h-10 rounded-md font-medium text-sm inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {loading ? 'Verifica...' : 'Verifica e accedi'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('email'); setCode(''); setError(null) }}
              className="w-full text-xs text-slate-400 hover:text-white transition-colors"
            >
              Usa un&apos;altra email
            </button>
          </form>
        )}

        <p className="text-xs text-slate-600 text-center">
          Solo email @witailer.com autorizzate possono accedere.
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  )
}
