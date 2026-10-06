'use client'

import { useEffect, useState } from 'react'

// Countdown for the open Quiz question. The host's first open stamps
// questions.opened_at server-side (a trigger that fires after the session
// update), so a client that just saw the question change may need a few polls
// before it appears. Returns remainingSeconds = null when there is nothing to
// count down - disabled, no question, or a question opened before open times
// were recorded (those have no deadline).
export function useQuestionClock(supabase, question, enabled) {
  const questionId = question?.id ?? null
  const limitSeconds = question?.time_limit_seconds ?? null
  const [openedAt, setOpenedAt] = useState(null) // { id, at }
  const [now, setNow] = useState(() => Date.now())

  const known = openedAt?.id === questionId ? openedAt.at : null

  // Fetch the open time once per question, retrying until the trigger's stamp
  // is visible. Gives up after ~8s: a question with no open time never gets one.
  useEffect(() => {
    if (!enabled || !questionId || known) return
    let cancelled = false
    let attempts = 0
    const load = async () => {
      attempts += 1
      const { data } = await supabase
        .from('questions')
        .select('opened_at')
        .eq('id', questionId)
        .maybeSingle()
      if (cancelled) return
      if (data?.opened_at) setOpenedAt({ id: questionId, at: data.opened_at })
      else if (attempts >= 8) clearInterval(interval)
    }
    const interval = setInterval(load, 1000)
    load()
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [supabase, enabled, questionId, known])

  useEffect(() => {
    if (!enabled || !known) return
    setNow(Date.now())
    const tick = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(tick)
  }, [enabled, known])

  if (!enabled || !known || !limitSeconds) return { remainingSeconds: null, timeUp: false }
  const remainingMs = Date.parse(known) + limitSeconds * 1000 - now
  return { remainingSeconds: Math.max(0, Math.ceil(remainingMs / 1000)), timeUp: remainingMs <= 0 }
}
