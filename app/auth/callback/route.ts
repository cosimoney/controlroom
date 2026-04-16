/**
 * OAuth callback handler for Supabase Auth.
 *
 * Google/provider redirects here after successful authentication.
 * Exchanges the ?code= query param for a session and sets the auth cookie.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error('OAuth exchange failed:', error.message)
    return NextResponse.redirect(`${origin}/login?error=oauth_failed`)
  }

  // Middleware will enforce email whitelist — just redirect to destination
  return NextResponse.redirect(`${origin}${next}`)
}
