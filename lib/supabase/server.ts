/**
 * lib/supabase/server.ts — Supabase client for Server Components and Route Handlers
 *
 * Reads session from Next.js cookies. Use in:
 * - Server Components (async)
 * - Route Handlers (GET/POST/...)
 * - Server Actions
 */

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // `setAll` is called from Server Components, where mutation is not allowed.
            // Safe to ignore — middleware handles session refresh on every request.
          }
        },
      },
    },
  )
}
