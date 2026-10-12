import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import { accessStateOf } from '@/lib/accessStatus'

export async function middleware(request) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() re-verifies the JWT with Supabase; getSession() only decodes
  // the cookie, which isn't enough to trust for an authorization decision.
  const { data: { user } } = await supabase.auth.getUser()

  // Protect dashboard and presenter routes - redirect to home if not authenticated
  const { pathname } = request.nextUrl
  const isAdminRoute = pathname.startsWith('/admin')
  const isProtected =
    pathname.startsWith('/dashboard') || pathname.startsWith('/present') || isAdminRoute
  if (isProtected && !user) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // /admin is for Super admins only. UX redirect; the RLS policies on
  // allowed_emails / leads and the admin RPC guard are the real gate.
  if (isAdminRoute && user) {
    const { data: isSuperAdmin } = await supabase.rpc('is_super_admin')
    if (!isSuperAdmin) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
    return supabaseResponse
  }

  // Access is decided in the database (organizer_access_status). This is a
  // UX redirect, not the gate: RLS refuses every write from a lapsed owner.
  // - active / admin: everything.
  // - expired / revoked / upcoming: /dashboard read-only; /present is for
  //   active Organizers only, so a lapsed owner goes back to the dashboard.
  // - none: /pending.
  if (isProtected && user) {
    const { data: statusRows } = await supabase.rpc('organizer_access_status')
    const state = accessStateOf(statusRows)
    const canWrite = state === 'active' || state === 'admin'
    const lapsed = state === 'expired' || state === 'revoked' || state === 'upcoming'
    if (!canWrite) {
      if (lapsed && pathname.startsWith('/dashboard')) {
        return supabaseResponse
      }
      const target = lapsed ? '/dashboard' : '/pending'
      return NextResponse.redirect(new URL(target, request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/dashboard/:path*', '/present/:path*', '/admin/:path*']
}