'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import SessionTheme from '@/components/SessionTheme'
import SessionLogo from '@/components/SessionLogo'
import ConfirmDialog from '@/components/ConfirmDialog'

// Public, anonymous scan page for a single Treasure Hunt Clue. No join, no
// name, no tracking - get_clue() only ever unlocks the one clue this token
// names, scoped to whether its session is currently live (see database-setup.sql
// section 20 / get_clue()).
export default function CluePage() {
  const params = useParams()
  const token = params.token
  const [loading, setLoading] = useState(true)
  const [result, setResult] = useState(null) // { status, clue_message, clue_number, session_title, choices, confirm_choice, theme }
  const [picked, setPicked] = useState(null) // { index, reveal } once a choice is revealed
  const [revealing, setRevealing] = useState(false)
  const [revealError, setRevealError] = useState('')
  const [pending, setPending] = useState(null) // index awaiting confirmation
  const supabase = createClient()
  const storageKey = `clue-choice:${token}`

  useEffect(() => {
    if (token) load()
  }, [token])

  const load = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('get_clue', { p_token: token })
      if (error) throw error
      const clue = data?.[0] || { status: 'missing' }
      setResult(clue)
      // A phone that already chose here gets its choice back (kept per phone,
      // never sent to the server). The reveal text is re-fetched, not cached.
      if (clue.status === 'live' && clue.choices?.length) {
        const saved = readSavedChoice()
        if (saved !== null && saved < clue.choices.length) await reveal(saved, false)
      }
    } catch (error) {
      console.error('Error loading clue:', error)
      setResult({ status: 'missing' })
    } finally {
      setLoading(false)
    }
  }

  const readSavedChoice = () => {
    try {
      const raw = window.localStorage.getItem(storageKey)
      const index = raw === null ? NaN : Number(raw)
      return Number.isInteger(index) && index >= 0 ? index : null
    } catch {
      return null
    }
  }

  const reveal = async (index, persist) => {
    setRevealing(true)
    setRevealError('')
    try {
      const { data, error } = await supabase.rpc('reveal_clue_choice', { p_token: token, p_index: index })
      if (error) throw error
      const row = data?.[0]
      if (row?.status === 'live' && row.reveal) {
        setPicked({ index, reveal: row.reveal })
        if (persist) {
          try {
            window.localStorage.setItem(storageKey, String(index))
          } catch {}
        }
      } else if (row?.status === 'closed' || row?.status === 'not_live') {
        setResult((prev) => ({ ...prev, status: row.status }))
      } else {
        setRevealError('Could not load this choice. Please try again.')
      }
    } catch (error) {
      console.error('Error revealing clue choice:', error)
      setRevealError('Could not load this choice. Please try again.')
    } finally {
      setRevealing(false)
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
    <SessionTheme theme={result?.theme} className="min-h-screen bg-gradient-to-br from-background to-muted">
      <main className="container mx-auto flex min-h-screen items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
          <SessionLogo theme={result?.theme} className="mx-auto mb-4 h-10" />
          {status === 'live' ? (
            <>
              <p className="text-sm font-semibold uppercase tracking-widest text-accent">
                {result.session_title} · Clue #{result.clue_number}
              </p>
              <p className="font-display mt-4 whitespace-pre-wrap text-2xl font-bold text-foreground">
                {result.clue_message}
              </p>
              {result.choices?.length > 0 && (
                <div className="mt-6 space-y-3">
                  {result.choices.map((label, index) => {
                    const isPicked = picked?.index === index
                    const isLocked = picked !== null || revealing
                    return (
                      <button
                        key={index}
                        type="button"
                        disabled={isLocked}
                        onClick={() => (result.confirm_choice ? setPending(index) : reveal(index, true))}
                        className={
                          'w-full rounded-xl border px-4 py-3 text-base font-semibold transition-colors ' +
                          (isPicked
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-card text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50')
                        }
                      >
                        {label}
                      </button>
                    )
                  })}
                  {picked && (
                    <p className="font-display mt-4 whitespace-pre-wrap rounded-xl bg-muted p-4 text-xl font-bold text-foreground">
                      {picked.reveal}
                    </p>
                  )}
                  {revealError && <p className="text-sm text-destructive">{revealError}</p>}
                </div>
              )}
              <ConfirmDialog
                open={pending !== null}
                title={`Choose "${result.choices?.[pending] ?? ''}"?`}
                confirmLabel="Yes, reveal it"
                busyLabel="Revealing…"
                busy={revealing}
                tone="primary"
                onCancel={() => setPending(null)}
                onConfirm={async () => {
                  await reveal(pending, true)
                  setPending(null)
                }}
              >
                <p className="mt-2 text-sm text-muted-foreground">
                  You get one choice on this clue. Once it&apos;s revealed it stays on this phone.
                </p>
              </ConfirmDialog>
            </>
          ) : status === 'closed' ? (
            <h1 className="font-display text-2xl font-bold text-foreground">This session is closed</h1>
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
    </SessionTheme>
  )
}
