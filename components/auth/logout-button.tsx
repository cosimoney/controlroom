'use client'
import { useState, useEffect } from 'react'
import { LogOut, User } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export function LogoutButton() {
  const [email, setEmail] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null))
  }, [])

  if (!email) return null

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="h-9 w-9 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        title={email}
      >
        <User className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-10 w-48 rounded-md border shadow-lg overflow-hidden z-50"
          style={{ borderColor: '#334155', background: '#0f172a' }}
        >
          <div className="px-3 py-2 border-b text-xs text-slate-400 truncate" style={{ borderColor: '#1e293b' }}>
            {email}
          </div>
          <form action="/auth/logout" method="POST">
            <button
              type="submit"
              className="w-full px-3 py-2 flex items-center gap-2 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              Esci
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
