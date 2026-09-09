'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AuthFallback() {
  const router = useRouter()
  const [demoMode, setDemoMode] = useState(false)

  useEffect(() => {
    // Check if we're stuck in loading state for too long
    const timer = setTimeout(() => {
      console.log('Auth taking too long, enabling demo mode')
      setDemoMode(true)
    }, 3000)

    return () => clearTimeout(timer)
  }, [])

  if (!demoMode) {
    return null
  }

  return (
    <div className="fixed inset-0 bg-white z-50 flex items-center justify-center">
      <div className="max-w-md mx-auto text-center p-8">
        <div className="mb-8">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 mb-4">
            <span className="text-2xl text-white">⚡</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Demo Mode Active</h1>
          <p className="text-gray-600 mb-6">
            Supabase authentication is taking longer than expected. Continue with demo data?
          </p>
        </div>

        <div className="space-y-4">
          <button
            onClick={() => {
              localStorage.setItem('demo_mode', 'true')
              router.push('/demo')
            }}
            className="w-full inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
          >
            Enter Demo Mode
          </button>

          <button
            onClick={() => window.location.reload()}
            className="w-full inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-6 py-3 text-base font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
          >
            Try Again
          </button>
        </div>

        <div className="mt-8 text-sm text-gray-500">
          <p className="mb-2">To configure Google OAuth:</p>
          <ol className="text-left space-y-1">
            <li>1. Go to Supabase Dashboard → Authentication → Providers</li>
            <li>2. Enable Google OAuth and add your credentials</li>
            <li>3. Add redirect URL: http://localhost:3000/auth/callback</li>
            <li>4. Run database-setup.sql in SQL Editor</li>
          </ol>
        </div>
      </div>
    </div>
  )
}