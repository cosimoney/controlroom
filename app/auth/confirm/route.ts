/**
 * Magic link confirmation handler.
 *
 * Flow:
 *   1. User submits email on /login → receives email from Supabase
 *   2. Email contains link to /auth/confirm?token_hash=...&type=email
 *   3. This route verifies the OTP and sets the session cookie
 *   4. Middleware then enforces the email whitelist on subsequent requests
 */

import { type EmailOtpType } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/'

  if (!token_hash || !type) {
    return NextResponse.redirect(`${origin}/login?error=link_expired`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ type, token_hash })

  if (error) {
    console.error('Magic link verification failed:', error.message)
    return NextResponse.redirect(`${origin}/login?error=link_expired`)
  }

  // Session cookie is set. Middleware will enforce email whitelist on /
  return NextResponse.redirect(`${origin}${next}`)
}
