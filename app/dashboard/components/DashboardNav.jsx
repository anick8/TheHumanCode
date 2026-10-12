'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/app/components/AuthProvider'

const NAVIGATION = [
  { name: 'Sessions', href: '/dashboard' },
  { name: 'Account', href: '/dashboard/account' },
]

export default function DashboardNav({ session, user: propUser }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user: authUser, session: authSession, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  const menuId = useId()

  const currentUser = authUser || authSession?.user || propUser || session?.user
  const userEmail = currentUser?.email || 'User'
  const userInitial = userEmail.charAt(0).toUpperCase()

  // "Sessions" owns the home route and every session sub-page; "Account" only
  // itself. Exact match for home so the two tabs never both light up.
  const isActive = (href) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard' || pathname.startsWith('/dashboard/sessions')
    }
    return pathname.startsWith(href)
  }

  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

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
    <nav className="sticky top-0 z-30 border-b border-border bg-card" aria-label="Dashboard">
      <div className="mx-auto flex h-14 max-w-7xl items-stretch justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-stretch gap-4 sm:gap-8">
          <Link href="/dashboard" aria-label="MC Genie dashboard" className="flex shrink-0 items-center gap-2.5">
            <img src="/mcgenie.png" alt="" className="h-8 w-8 rounded-lg object-cover" />
            <span className="hidden font-display text-base font-bold tracking-wide text-foreground sm:inline">
              MC Genie
            </span>
          </Link>

          <div className="flex items-stretch">
            {NAVIGATION.map((item) => {
              const active = isActive(item.href)
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`relative flex items-center px-2.5 text-sm sm:px-3 font-medium transition-colors ${
                    active
                      ? 'text-foreground after:absolute after:inset-x-2.5 after:bottom-0 sm:after:inset-x-3 after:h-0.5 after:bg-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {item.name}
                </Link>
              )
            })}
          </div>
        </div>

        <div ref={menuRef} className="relative flex items-center">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={`Account menu for ${userEmail}`}
            className="flex h-9 items-center gap-2 rounded-full border border-border bg-muted pl-1 pr-1 text-sm font-medium text-foreground transition-colors hover:border-muted-foreground sm:pr-3"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-background font-display text-xs font-bold">
              {userInitial}
            </span>
            <span className="hidden max-w-[180px] truncate sm:inline">{userEmail}</span>
          </button>

          {menuOpen && (
            <div
              id={menuId}
              role="menu"
              className="absolute right-0 top-full mt-2 w-60 rounded-xl border border-border bg-card p-1.5 shadow-[0_12px_28px_rgba(0,0,0,0.45)]"
            >
              <p className="truncate px-3 py-2 text-xs text-muted-foreground">{userEmail}</p>
              <Link
                href="/dashboard/account"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="block rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
              >
                Account
              </Link>
              <button
                type="button"
                role="menuitem"
                onClick={handleSignOut}
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted hover:text-destructive"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
