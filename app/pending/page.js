'use client'

import { useAuth } from '@/app/components/AuthProvider'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function PendingPage() {
  const { signOut } = useAuth()
  const router = useRouter()

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch {
      // Best-effort - the account is unprivileged either way.
    }
    router.push('/')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted flex flex-col items-center justify-center px-4 py-12 text-center">
      <Link href="/" className="mb-6 inline-flex items-center justify-center">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-r from-primary to-accent flex items-center justify-center shadow-md">
          <span className="text-xl font-black text-white">⚡</span>
        </div>
        <span className="ml-3 text-2xl font-bold text-foreground">MC Genie</span>
      </Link>

      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15">
          <svg className="h-6 w-6 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="font-display text-xl font-bold text-foreground">You&apos;re on the list</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          MC Genie is invite-only right now. We&apos;ve got your account, and we&apos;ll be in touch if
          that changes.
        </p>
        <button
          type="button"
          onClick={handleSignOut}
          className="mt-6 w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground shadow-xs hover:bg-muted transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
