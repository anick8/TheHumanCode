'use client'

import { useAuth } from '@/app/components/AuthProvider'
import AuthForm from '@/components/AuthForm'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function LoginPage() {
  const { session, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (session) {
      router.push('/dashboard')
    }
  }, [session, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background to-muted">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-6">
        <Link href="/" className="inline-flex items-center justify-center">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-r from-primary to-accent flex items-center justify-center shadow-md">
            <span className="text-xl font-black text-white">⚡</span>
          </div>
          <span className="ml-3 text-2xl font-bold text-foreground">LivePolls</span>
        </Link>
        <h2 className="font-display mt-4 text-2xl font-extrabold text-foreground tracking-tight">
          Welcome back
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to manage your poll sessions and view live analytics
        </p>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md px-4">
        <AuthForm defaultTab="signin" />
      </div>

      <div className="mt-8 text-center text-xs text-muted-foreground">
        <Link href="/" className="hover:text-muted-foreground transition-colors">
          ← Return to home page
        </Link>
      </div>
    </div>
  )
}
