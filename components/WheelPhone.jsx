'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

const POLL_MS = 5000

// Phone surface for a Wheel of Fortune session. The phone never reads the
// Entry list: it sees only the latest Pick via the token-scoped
// get_wheel_latest_pick RPC (no row until the first Spin).
export default function WheelPhone({ participant, onSwitch }) {
  const supabase = createClient()
  const [pick, setPick] = useState(null)
  const joinToken = participant?.join_token

  useEffect(() => {
    if (!joinToken) return
    let cancelled = false
    const load = async () => {
      const { data, error } = await supabase.rpc('get_wheel_latest_pick', { p_join_token: joinToken })
      if (!error && !cancelled) setPick(data?.[0] || null)
    }
    load()
    const timer = setInterval(load, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [joinToken])

  return (
    <main className="container mx-auto px-4 py-10">
      <div className="mx-auto max-w-md space-y-4 text-center">
        {pick?.is_you && (
          <div className="rounded-2xl border border-primary/40 bg-primary/10 p-8 shadow-lg" role="status">
            <h2 className="font-display text-3xl font-bold text-foreground">🎉 You were picked!</h2>
          </div>
        )}

        {pick && !pick.is_you && (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-lg" role="status">
            <p className="text-sm text-muted-foreground">Latest pick</p>
            <p className="font-display mt-1 break-words text-2xl font-bold text-foreground">
              {pick.label} was picked
            </p>
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card p-10 shadow-lg">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="font-display mt-6 text-2xl font-bold text-foreground">You're on the wheel ✓</h2>
          <p className="mt-2 text-muted-foreground">
            {participant?.name ? `Joined as ${participant.name}. ` : ''}Watch the big screen for the spin.
          </p>
          <button onClick={onSwitch} className="mt-4 text-sm font-medium text-accent hover:underline">
            Not you? Switch
          </button>
        </div>
      </div>
    </main>
  )
}
