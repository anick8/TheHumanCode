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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-6">
        <Link href="/" className="inline-flex items-center justify-center">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 flex items-center justify-center shadow-md">
            <span className="text-xl font-black text-white">⚡</span>
          </div>
          <span className="ml-3 text-2xl font-bold text-gray-900">LivePolls</span>
        </Link>
        <h2 className="mt-4 text-2xl font-extrabold text-gray-900 tracking-tight">
          Welcome back
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Sign in to manage your poll sessions and view live analytics
        </p>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md px-4">
        <AuthForm defaultTab="signin" />
      </div>

      <div className="mt-8 text-center text-xs text-gray-400">
        <Link href="/" className="hover:text-gray-600 transition-colors">
          ← Return to home page
        </Link>
      </div>
    </div>
  )
}
