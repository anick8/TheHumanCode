'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/app/components/AuthProvider'

export default function DashboardNav({ session, user: propUser }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user: authUser, session: authSession, signOut } = useAuth()

  const currentUser = authUser || authSession?.user || propUser || session?.user
  const userEmail = currentUser?.email || 'User'
  const userInitial = userEmail.charAt(0).toUpperCase()

  const navigation = [
    { name: 'Sessions', href: '/dashboard' },
    { name: 'New Session', href: '/dashboard/sessions/new' },
  ]

  const isActive = (path) => {
    if (path === '/dashboard') {
      return pathname === '/dashboard'
    }
    return pathname.startsWith(path)
  }

  const handleSignOut = async () => {
    try {
      await signOut()
      router.push('/')
      router.refresh()
    } catch (error) {
      console.error('Error signing out:', error)
      router.push('/')
    }
  }

  return (
    <nav className="border-b border-border bg-card sticky top-0 z-30 shadow-2xs">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 justify-between items-center">
          <div className="flex items-center">
            <div className="flex flex-shrink-0 items-center">
              <Link href="/dashboard" className="flex items-center">
                <img src="/mcgenie.png" alt="" className="h-9 w-9 rounded-xl object-cover shadow-xs" />
                <span className="ml-3 text-xl font-bold text-foreground">MC Genie</span>
                <span className="ml-2 hidden md:inline-block text-xs font-semibold bg-primary/15 text-accent px-2 py-0.5 rounded-full">
                  Dashboard
                </span>
              </Link>
            </div>
            <div className="hidden sm:ml-8 sm:flex sm:space-x-4">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    isActive(item.href)
                      ? 'bg-muted text-accent font-semibold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex items-center">
              <div className="h-8 w-8 rounded-full bg-gradient-to-r from-primary to-accent flex items-center justify-center text-white text-xs font-bold shadow-xs">
                {userInitial}
              </div>
              <span className="ml-2.5 text-sm font-medium text-foreground max-w-[200px] truncate hidden lg:inline-block">
                {userEmail}
              </span>
            </div>

            <button
              onClick={handleSignOut}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs sm:text-sm font-medium text-foreground shadow-2xs hover:bg-muted hover:text-destructive transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Mobile navigation */}
        <div className="sm:hidden border-t border-border py-2 flex space-x-2">
          {navigation.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                isActive(item.href)
                  ? 'bg-muted text-accent font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {item.name}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  )
}
