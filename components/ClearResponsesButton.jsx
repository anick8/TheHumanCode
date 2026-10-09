'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import ConfirmDialog from '@/components/ConfirmDialog'

// The host's Clear: deletes what the audience produced (participants, answers,
// comments, spins) and keeps everything the host wrote. Disabled with
// "Nothing to clear" while there is nothing to delete.
const COUNT_LABELS = [
  ['participants', 'participant', 'participants'],
  ['votes', 'answer', 'answers'],
  ['comments', 'comment', 'comments'],
  ['spins', 'spin', 'spins'],
]

export default function ClearResponsesButton({ sessionId, rewindsQuiz = false, onCleared }) {
  const [counts, setCounts] = useState(null)
  const [open, setOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState(null)
  const supabase = createClient()

  const loadCounts = useCallback(async () => {
    const { data, error: countError } = await supabase.rpc('get_clearable_counts', {
      p_session_id: sessionId,
    })
    if (!countError && data) setCounts(data)
    return data
  }, [sessionId])

  // Keep the disabled state honest while people join or answer.
  useEffect(() => {
    loadCounts()
    const interval = setInterval(loadCounts, 10000)
    return () => clearInterval(interval)
  }, [loadCounts])

  const total = counts ? COUNT_LABELS.reduce((sum, [key]) => sum + (counts[key] || 0), 0) : 0
  const empty = counts !== null && total === 0

  const openDialog = async () => {
    setError(null)
    setOpen(true)
    await loadCounts()
  }

  const clear = async () => {
    setClearing(true)
    setError(null)
    const { error: clearError } = await supabase.rpc('clear_session_responses', {
      p_session_id: sessionId,
    })
    setClearing(false)
    if (clearError) {
      setError(clearError.message || 'Could not clear this session.')
      return
    }
    setOpen(false)
    await loadCounts()
    onCleared?.()
  }

  const summary = counts
    ? COUNT_LABELS.filter(([key]) => counts[key] > 0)
        .map(([key, one, many]) => `${counts[key]} ${counts[key] === 1 ? one : many}`)
        .join(', ')
    : ''

  return (
    <>
      <button
        onClick={openDialog}
        disabled={empty || counts === null}
        className="inline-flex items-center justify-center rounded-lg border border-destructive/40 bg-card px-6 py-3 text-base font-semibold text-destructive shadow-sm hover:bg-destructive/10 transition-colors disabled:opacity-50 disabled:hover:bg-card disabled:cursor-not-allowed"
      >
        <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        {empty ? 'Nothing to clear' : 'Clear'}
      </button>

      <ConfirmDialog
        open={open}
        title="Clear all responses?"
        confirmLabel="Clear"
        busyLabel="Clearing…"
        busy={clearing}
        error={error}
        confirmDisabled={!summary}
        onConfirm={clear}
        onCancel={() => setOpen(false)}
      >
        <p className="mt-3 text-sm text-foreground">
          {summary ? `This permanently deletes ${summary}.` : 'There is nothing to delete.'}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Your questions, options and images stay.
          {rewindsQuiz && ' The quiz goes back to the start.'} This cannot be undone.
        </p>
      </ConfirmDialog>
    </>
  )
}
