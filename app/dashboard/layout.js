import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardNav from './components/DashboardNav'
import AccessBanner from './components/AccessBanner'
import { accessStateOf } from '@/lib/accessStatus'

export default async function DashboardLayout({ children }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Middleware already redirects accounts with no access at all; this is a
  // defense-in-depth repeat of that check, not the primary gate (RLS is what
  // actually stops writes). Lapsed and upcoming accounts may view the
  // dashboard read-only; the client AccessProvider carries the details.
  const { data: statusRows } = await supabase.rpc('organizer_access_status')
  const state = accessStateOf(statusRows)
  if (!state || state === 'none') {
    redirect('/pending')
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardNav user={user} />
      <main className="py-6">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <AccessBanner />
          {children}
        </div>
      </main>
    </div>
  )
}
