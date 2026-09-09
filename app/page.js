'use client'

import { useAuth } from './components/AuthProvider'
import AuthForm from '@/components/AuthForm'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import Link from 'next/link'

export default function Home() {
  const { session, loading } = useAuth()
  const router = useRouter()
  const authCardRef = useRef(null)

  useEffect(() => {
    if (session) {
      router.push('/dashboard')
    }
  }, [session, router])

  const scrollToAuth = () => {
    authCardRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Navigation */}
      <nav className="border-b border-gray-200 bg-white/80 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="h-9 w-9 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 flex items-center justify-center shadow-sm">
                  <span className="text-xl font-black text-white">⚡</span>
                </div>
              </div>
              <div className="ml-3 flex items-center">
                <span className="text-xl font-bold text-gray-900">LivePolls</span>
                <span className="ml-2 text-xs font-semibold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                  v1.0
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-3 sm:space-x-4">
              <button
                onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
                className="hidden sm:inline-flex text-sm font-medium text-gray-600 hover:text-gray-900 px-3 py-2"
              >
                Features
              </button>
              <Link
                href="/login"
                className="text-sm font-semibold text-gray-700 hover:text-blue-600 px-3 py-2 transition-colors"
              >
                Sign In
              </Link>
              <button
                onClick={scrollToAuth}
                className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
              >
                Get Started
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section with Dual Layout */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-12 pb-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left Column: Headline & Value Prop */}
          <div className="lg:col-span-7 text-center lg:text-left">
            <div className="inline-flex items-center rounded-full bg-blue-100 px-3.5 py-1 text-xs font-semibold text-blue-800 mb-6">
              ✨ Real-time interactive audience polling
            </div>
            <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl md:text-6xl">
              <span className="block">Create live polls</span>
              <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
                driven by QR codes
              </span>
            </h1>
            <p className="mt-6 text-lg text-gray-600 max-w-2xl mx-auto lg:mx-0">
              Generate unique QR codes for your sessions. Attendees simply scan with their smartphones to vote anonymously in real-time. No apps or signups required for voters.
            </p>

            {/* Feature Pills */}
            <div className="mt-8 flex flex-wrap gap-3 justify-center lg:justify-start">
              <span className="inline-flex items-center rounded-lg bg-white border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-xs">
                🔒 Anonymous Voting
              </span>
              <span className="inline-flex items-center rounded-lg bg-white border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-xs">
                ⚡ Instant Realtime Updates
              </span>
              <span className="inline-flex items-center rounded-lg bg-white border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-xs">
                📱 Mobile-First Scanning
              </span>
              <span className="inline-flex items-center rounded-lg bg-white border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-xs">
                📊 Live Analytics
              </span>
            </div>

            {/* Quick Demo Button for testing */}
            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <Link
                href="/demo"
                className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-xs hover:bg-gray-50 transition-colors"
              >
                <span className="mr-2">🚀</span> Explore Interactive Demo
              </Link>
            </div>
          </div>

          {/* Right Column: Interactive Auth Form */}
          <div ref={authCardRef} className="lg:col-span-5 flex justify-center">
            <AuthForm defaultTab="signin" />
          </div>
        </div>

        {/* Stats Preview */}
        <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-3">
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-xs">
            <div className="text-3xl font-extrabold text-blue-600">∞</div>
            <div className="mt-2 text-sm font-semibold text-gray-900">Unlimited Poll Sessions</div>
            <div className="mt-1 text-xs text-gray-500">Create as many sessions as you need for any event</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-xs">
            <div className="text-3xl font-extrabold text-blue-600">⚡</div>
            <div className="mt-2 text-sm font-semibold text-gray-900">Live Instant Results</div>
            <div className="mt-1 text-xs text-gray-500">Votes update seamlessly in real-time on your dashboard</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-6 text-center shadow-xs">
            <div className="text-3xl font-extrabold text-blue-600">📱</div>
            <div className="mt-2 text-sm font-semibold text-gray-900">Instant QR Scanning</div>
            <div className="mt-1 text-xs text-gray-500">Zero friction — no app downloads or voter registration</div>
          </div>
        </div>

        {/* Features / How It Works */}
        <div id="features" className="mt-28">
          <div className="text-center">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-blue-600">Simple 3-Step Workflow</h2>
            <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
              How LivePolls Works
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xs hover:shadow-md transition-shadow">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-blue-50 text-blue-600 text-2xl">
                📝
              </div>
              <h3 className="text-lg font-bold text-gray-900">1. Create Your Session</h3>
              <p className="mt-2 text-sm text-gray-600 leading-relaxed">
                Log in to your dashboard and add your poll questions with customizable multiple-choice options.
              </p>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xs hover:shadow-md transition-shadow">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 text-2xl">
                🔗
              </div>
              <h3 className="text-lg font-bold text-gray-900">2. Display the QR Code</h3>
              <p className="mt-2 text-sm text-gray-600 leading-relaxed">
                Download or project your unique session QR code on screen. Attendees point their camera to join.
              </p>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-xs hover:shadow-md transition-shadow">
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-green-50 text-green-600 text-2xl">
                📊
              </div>
              <h3 className="text-lg font-bold text-gray-900">3. Monitor Live Results</h3>
              <p className="mt-2 text-sm text-gray-600 leading-relaxed">
                Watch votes stream in with real-time percentage charts or reveal answers after all questions are completed.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white py-8">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between text-sm text-gray-500 gap-4">
            <div className="flex items-center">
              <span className="font-semibold text-gray-900">LivePolls</span>
              <span className="ml-2">© 2026. All rights reserved.</span>
            </div>
            <div>
              Built with Next.js, Supabase, and Tailwind CSS.
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
