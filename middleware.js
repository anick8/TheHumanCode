import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

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
  const isProtected = pathname.startsWith('/dashboard') || pathname.startsWith('/present')
  if (isProtected && !user) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Organizer capabilities (owning/presenting sessions) are restricted to an
  // allowlist enforced in RLS via is_organizer() - this redirect is UX only,
  // not the actual gate. A non-organizer who bypasses this still can't own
  // or edit anything at the database level.
  if (isProtected && user) {
    const { data: isOrganizer } = await supabase.rpc('is_organizer')
    if (!isOrganizer) {
      return NextResponse.redirect(new URL('/pending', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/dashboard/:path*', '/present/:path*']
}