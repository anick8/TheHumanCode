import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import DashboardNav from './components/DashboardNav'

export default async function DashboardLayout({ children }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Middleware already redirects non-organizers away from /dashboard; this
  // is a defense-in-depth repeat of that check, not the primary gate (RLS
  // via is_organizer() is what actually stops a non-organizer's writes).
  const { data: isOrganizer } = await supabase.rpc('is_organizer')
  if (!isOrganizer) {
    redirect('/pending')
  }

  return (
    <div className="min-h-screen bg-muted">
      <DashboardNav user={user} />
      <main className="py-6">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  )
}
