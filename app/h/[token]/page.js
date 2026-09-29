'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Public, anonymous scan page for a single Treasure Hunt Clue. No join, no
// name, no tracking - get_clue() only ever unlocks the one clue this token
// names, scoped to whether its session is currently live (see database-setup.sql
// section 20 / get_clue()).
export default function CluePage() {
  const params = useParams()
  const token = params.token
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState(null) // { status, clue_message, clue_number, session_title }
  const supabase = createClient()

  useEffect(() => {
    if (token) load()
  }, [token])

  const load = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('get_clue', { p_token: token })
      if (error) throw error
      setResult(data?.[0] || { status: 'missing' })
    } catch (error) {
      console.error('Error loading clue:', error)
      setResult({ status: 'missing' })
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted">
        <div className="container mx-auto px-4 py-16 text-center">
          <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <h1 className="font-display mt-6 text-2xl font-bold text-foreground">Loading clue...</h1>
        </div>
      </div>
    )
  }

  const status = result?.status || 'missing'

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted">
      <main className="container mx-auto flex min-h-screen items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
          {status === 'live' ? (
            <>
              <p className="text-sm font-semibold uppercase tracking-widest text-accent">
                {result.session_title} · Clue #{result.clue_number}
              </p>
              <p className="font-display mt-4 whitespace-pre-wrap text-2xl font-bold text-foreground">
                {result.clue_message}
              </p>
            </>
          ) : status === 'not_live' ? (
            <>
              <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <svg className="h-6 w-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="font-display text-2xl font-bold text-foreground">
                {result.session_title || 'This hunt'} isn&apos;t live right now
              </h1>
              <p className="mt-2 text-muted-foreground">
                Clue #{result.clue_number} will show its message once the organizer starts the hunt.
              </p>
            </>
          ) : (
            <>
              <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                <svg className="h-6 w-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h1 className="font-display text-2xl font-bold text-foreground">This clue no longer exists</h1>
              <p className="mt-2 text-muted-foreground">
                The code may be out of date, or the organizer removed this clue.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
