import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export const metadata = { title: 'Admin | MC Genie' }

// Standalone layout carrying the dashboard console-bar look. Middleware is the
// first redirect; this repeats it (defense in depth). RLS on allowed_emails and
// leads is the actual gate, so a bypass here still can't read or write anything.
export default async function AdminLayout({ children }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: isSuperAdmin } = await supabase.rpc('is_super_admin')
  if (!isSuperAdmin) redirect('/dashboard')

  return (
    <div className="min-h-screen bg-background">
      <nav className="sticky top-0 z-30 border-b border-border bg-card" aria-label="Admin">
        <div className="mx-auto flex h-14 max-w-7xl items-stretch justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <Link href="/dashboard" aria-label="MC Genie dashboard" className="flex shrink-0 items-center gap-2.5">
              <img src="/mcgenie.png" alt="" className="h-8 w-8 rounded-lg object-cover" />
              <span className="hidden font-display text-base font-bold tracking-wide text-foreground sm:inline">
                MC Genie
              </span>
            </Link>
            <span className="h-5 w-px bg-border" aria-hidden="true" />
            <span className="font-display text-sm font-bold tracking-wide text-foreground">Admin</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden max-w-[220px] truncate text-xs text-muted-foreground sm:inline">
              {user.email}
            </span>
            <Link
              href="/dashboard"
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Dashboard
            </Link>
          </div>
        </div>
      </nav>
      <main className="py-6">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  )
}
