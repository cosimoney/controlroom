/**
 * lib/supabase/middleware.ts — Session refresh + auth guard for middleware.ts
 *
 * Called on every request by the top-level middleware.ts.
 * Refreshes the Supabase session cookie + redirects unauthenticated users to /login.
 */

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Routes that don't require authentication
const PUBLIC_ROUTES = ['/login', '/auth/callback', '/auth/confirm', '/auth/error', '/api/cron']

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'))
}

function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const allowed = (process.env.ALLOWED_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  const allowedDomains = (process.env.ALLOWED_EMAIL_DOMAINS ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)
  const em = email.toLowerCase()

  if (allowed.includes(em)) return true
  if (allowedDomains.some((d) => em.endsWith('@' + d))) return true
  return false
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // IMPORTANT: must not run any code between createServerClient and supabase.auth.getUser()
  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname

  // Public routes: let them through, even if authenticated
  if (isPublicRoute(pathname)) {
    // If authenticated and visiting /login, redirect to home
    if (user && pathname === '/login' && isAllowedEmail(user.email)) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  // Unauthenticated → redirect to /login
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Authenticated but email not in whitelist → sign out + redirect to /login?error=unauthorized
  if (!isAllowedEmail(user.email)) {
    await supabase.auth.signOut()
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('error', 'unauthorized')
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
