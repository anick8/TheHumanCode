'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { generateJoinToken } from '@/lib/utils'
import SessionTheme from '@/components/SessionTheme'
import SessionLogo from '@/components/SessionLogo'
import {
  screenFor,
  clockOffset,
  clockLabel,
  safeNext,
  progressLabel,
  ordinal,
  joinFailure,
} from '@/lib/huntPlayer'

// Player join page for a Hunt game. The clue page (/h/[token]) sends players
// here with ?next=<clue path> when they have no approved join token; the token
// lives in localStorage under hunt_player:<sessionId>, shared with that page.
const POLL_MS = 4000
const NAME_MAX = 40

const storageKey = (sessionId) => `hunt_player:${sessionId}`

function readToken(sessionId) {
  try {
    return window.localStorage.getItem(storageKey(sessionId))
  } catch {
    return null
  }
}

function writeToken(sessionId, token) {
  try {
    window.localStorage.setItem(storageKey(sessionId), token)
  } catch {
    // Private mode: the page still works for this visit.
  }
}

function Card({ children }) {
  return (
    <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
      {children}
    </div>
  )
}

export default function HuntJoinPage() {
  const { slug } = useParams()
  const router = useRouter()
  const supabase = createClient()

  const [session, setSession] = useState(null)
  const [lookup, setLookup] = useState('loading') // loading | ready | missing | not_game
  const [status, setStatus] = useState(null)
  const [offset, setOffset] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [closedByJoin, setClosedByJoin] = useState(false)
  const nextRef = useRef(null)
  const tokenRef = useRef(null)

  useEffect(() => {
    nextRef.current = safeNext(new URLSearchParams(window.location.search).get('next'))
  }, [])

  // Resolve slug -> session, the same public lookup the vote page uses.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('sessions')
        .select('*')
        .eq('slug', slug)
        .eq('is_active', true)
        .single()
      if (cancelled) return
      if (!data) return setLookup('missing')
      if (!data.hunt_game) return setLookup('not_game')
      setSession(data)
      tokenRef.current = readToken(data.id) || generateJoinToken()
      setLookup('ready')
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const poll = useCallback(async () => {
    if (!session) return
    const { data, error: rpcError } = await supabase.rpc('get_hunt_status', {
      p_session_id: session.id,
      p_join_token: tokenRef.current,
    })
    if (rpcError || !data?.[0]) return
    const row = data[0]
    setOffset(clockOffset(row.server_now, Date.now()))
    setStatus(row)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  useEffect(() => {
    if (lookup !== 'ready') return
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => clearInterval(id)
  }, [lookup, poll])

  const screen = screenFor(status)

  // Tick the clock locally between polls.
  useEffect(() => {
    if (screen !== 'running') return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [screen])

  // Approved and running: go back to the clue that sent the player here.
  useEffect(() => {
    if (screen === 'running' && nextRef.current) router.replace(nextRef.current)
  }, [screen, router])

  const handleJoin = async (e) => {
    e.preventDefault()
    setError(null)
    const trimmed = name.trim()
    if (!trimmed) return setError('Enter your name to join.')
    setSubmitting(true)
    try {
      const { data, error: rpcError } = await supabase.rpc('join_hunt', {
        p_session_id: session.id,
        p_name: trimmed,
        p_join_token: tokenRef.current,
      })
      if (rpcError) throw rpcError
      if (!data?.[0]) throw new Error('Could not join this hunt.')
      writeToken(session.id, tokenRef.current)
      await poll()
    } catch (err) {
      let row = null
      try {
        const { data } = await supabase.rpc('get_hunt_status', {
          p_session_id: session.id,
          p_join_token: tokenRef.current,
        })
        row = data?.[0] || null
      } catch {}
      const outcome = joinFailure(row, err?.message)
      if (outcome.kind === 'closed') setClosedByJoin(true)
      else setError(outcome.message)
    } finally {
      setSubmitting(false)
    }
  }

  const title = session?.title || 'Treasure hunt'

  let body
  if (lookup === 'loading' || (lookup === 'ready' && screen === 'loading')) {
    body = (
      <Card>
        <p className="text-muted-foreground">Loading…</p>
      </Card>
    )
  } else if (lookup === 'missing') {
    body = (
      <Card>
        <h1 className="font-display text-2xl font-bold text-foreground">Hunt not found</h1>
        <p className="mt-2 text-muted-foreground">This hunt does not exist or is closed.</p>
      </Card>
    )
  } else if (lookup === 'not_game') {
    body = (
      <Card>
        <h1 className="font-display text-2xl font-bold text-foreground">No sign-up needed</h1>
        <p className="mt-2 text-muted-foreground">
          {title} has no player sign-up. Scan a clue&apos;s QR code to play.
        </p>
      </Card>
    )
  } else if (screen === 'closed' || closedByJoin) {
    body = (
      <Card>
        <h1 className="font-display text-2xl font-bold text-foreground">Joining is closed</h1>
        <p className="mt-2 text-muted-foreground">
          {title} has already started, so new players can no longer join.
        </p>
      </Card>
    )
  } else if (screen === 'removed') {
    body = (
      <Card>
        <h1 className="font-display text-2xl font-bold text-foreground">You were removed</h1>
        <p className="mt-2 text-muted-foreground">
          The host removed you from {title}. Ask them if you think this is a mistake.
        </p>
      </Card>
    )
  } else if (screen === 'join') {
    body = (
      <Card>
        <h1 className="font-display text-2xl font-bold text-foreground">Join {title}</h1>
        <p className="mt-2 text-muted-foreground">
          Enter your name. The host will approve you before the hunt starts.
        </p>
        <form onSubmit={handleJoin} className="mt-6 space-y-4 text-left">
          <div>
            <label htmlFor="hunt-name" className="mb-2 block text-sm font-medium text-foreground">
              Name
            </label>
            <input
              id="hunt-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={NAME_MAX}
              autoComplete="name"
              placeholder="Your name"
              className="block w-full rounded-lg border border-border px-4 py-3 text-foreground shadow-sm focus:border-ring focus:ring-2 focus:ring-ring focus:ring-opacity-20"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-50"
          >
            {submitting ? 'Joining…' : 'Join the hunt'}
          </button>
        </form>
      </Card>
    )
  } else if (screen === 'pending') {
    body = (
      <Card>
        <h1 className="font-display text-2xl font-bold text-foreground">Waiting for approval</h1>
        <p className="mt-2 text-muted-foreground">
          The host needs to approve you before you can play. Keep this page open.
        </p>
      </Card>
    )
  } else if (screen === 'waiting') {
    body = (
      <Card>
        <h1 className="font-display text-2xl font-bold text-foreground">You&apos;re in</h1>
        <p className="mt-2 text-muted-foreground">
          Waiting for the host to start the hunt. This page updates on its own.
        </p>
      </Card>
    )
  } else if (screen === 'running') {
    const clock = clockLabel(status, now, offset)
    body = (
      <Card>
        <h1 className="font-display text-2xl font-bold text-foreground">{title}</h1>
        <p className="mt-4 text-lg font-semibold text-foreground">
          {progressLabel(status.clues_found, status.total_clues)}
        </p>
        <p className="mt-4 text-4xl font-bold tabular-nums text-foreground" aria-live="off">
          {clock.text}
        </p>
        <p className="text-sm text-muted-foreground">
          {clock.kind === 'remaining' ? 'time left' : 'time elapsed'}
        </p>
        <p className="mt-4 text-muted-foreground">Scan a clue&apos;s QR code to find the next one.</p>
      </Card>
    )
  } else if (screen === 'over') {
    const elapsedMs =
      status.last_scan_at && status.hunt_started_at
        ? Date.parse(status.last_scan_at) - Date.parse(status.hunt_started_at)
        : null
    body = (
      <Card>
        <h1 className="font-display text-2xl font-bold text-foreground">The hunt is over</h1>
        {status.rank ? (
          <p className="mt-4 text-3xl font-bold text-foreground">{ordinal(status.rank)} place</p>
        ) : null}
        <p className="mt-2 text-lg text-foreground">
          {progressLabel(status.clues_found, status.total_clues)}
        </p>
        {elapsedMs !== null && elapsedMs >= 0 && (
          <p className="mt-1 text-muted-foreground">
            Last clue found {clockLabel({ hunt_started_at: status.hunt_started_at, hunt_ends_at: null }, Date.parse(status.last_scan_at), 0).text} after the start
          </p>
        )}
      </Card>
    )
  }

  return (
    <SessionTheme
      theme={session?.theme}
      className="min-h-screen bg-gradient-to-br from-background to-muted"
    >
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md">
          {session && <SessionLogo theme={session.theme} className="mx-auto mb-4 h-10" />}
          {body}
        </div>
      </main>
    </SessionTheme>
  )
}
