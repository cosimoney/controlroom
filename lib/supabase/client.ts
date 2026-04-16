/**
 * lib/supabase/client.ts — Supabase client for Client Components
 *
 * Use in:
 * - Client Components ('use client')
 * - Browser-side event handlers (login button, logout button)
 */

import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
