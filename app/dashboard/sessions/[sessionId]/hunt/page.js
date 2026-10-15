'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { QRCodeSVG } from 'qrcode.react'
import HelpLink from '@/components/HelpLink'
import ConfirmDialog from '@/components/ConfirmDialog'
import { createClient } from '@/lib/supabase/client'
import { getAppUrl } from '@/lib/utils'
import { useAccess } from '@/app/components/AccessProvider'
import { buildHuntCsv, formatDuration, huntClock, splitBoard } from '@/lib/huntRun'

const POLL_MS = 4000

const cardClass = 'rounded-2xl border border-border bg-card p-6 shadow-sm'
const primaryButton =
  'inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50'
const secondaryButton =
  'inline-flex items-center justify-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm hover:bg-muted transition-colors disabled:opacity-50'

function formatJoined(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function RunHuntPage() {
  const params = useParams()
  const sessionId = params.sessionId
  const { access } = useAccess()
  const readOnly = access.readOnly
  const supabase = useMemo(() => createClient(), [])

  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [clueCount, setClueCount] = useState(0)
  const [board, setBoard] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [minutes, setMinutes] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    const [sessionRes, boardRes, countRes] = await Promise.all([
      supabase.from('sessions').select('*').eq('id', sessionId).single(),
      supabase.rpc('get_hunt_board', { p_session_id: sessionId }),
      supabase.from('questions').select('id', { count: 'exact', head: true }).eq('session_id', sessionId),
    ])
    if (sessionRes.data) setSession(sessionRes.data)
    if (!boardRes.error) setBoard(boardRes.data || [])
    if (countRes.count !== null && countRes.count !== undefined) setClueCount(countRes.count)
    setLoading(false)
  }, [supabase, sessionId])

  useEffect(() => {
    if (!sessionId) return
    refresh()
    const poll = setInterval(refresh, POLL_MS)
    return () => clearInterval(poll)
  }, [sessionId, refresh])

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [])

  // Run an organizer RPC, show any error, then refresh the board right away.
  const act = async (name, args, fallback) => {
    setBusy(true)
    setError('')
    const { error: rpcError } = await supabase.rpc(name, args)
    if (rpcError) {
      const msg = rpcError.message || ''
      setError(
        name === 'start_hunt' && /already/i.test(msg)
          ? 'This hunt has already started. Reset it before starting again.'
          : msg || fallback
      )
    }
    await refresh()
    setBusy(false)
    return !rpcError
  }

  const start = () => {
    const n = minutes.trim() === '' ? null : Math.floor(Number(minutes))
    if (n !== null && (!Number.isFinite(n) || n < 1)) {
      setError('Enter a whole number of minutes, or leave it empty for no time limit.')
      return
    }
    act('start_hunt', { p_session_id: sessionId, p_minutes: n }, 'Could not start the hunt.')
  }

  const joinUrl = session ? `${getAppUrl()}/hunt/${session.slug}` : ''

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const downloadCsv = () => {
    const numbers = Array.from({ length: clueCount }, (_, i) => i + 1)
    const csv = buildHuntCsv(board, numbers, session.hunt_started_at)
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${session.slug || 'hunt'}-results.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return (
      <div className="py-8">
        <div className="animate-pulse">
          <div className="mb-8 h-8 w-48 rounded bg-muted"></div>
          <div className="h-64 rounded-lg bg-muted"></div>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="py-8 text-center">
        <h2 className="font-display text-2xl font-bold text-foreground">Session not found</h2>
        <Link href="/dashboard" className="mt-4 inline-block text-accent hover:underline">Back to dashboard</Link>
      </div>
    )
  }

  if (session.session_type !== 'treasure_hunt' || !session.hunt_game) {
    return (
      <div className="py-8 text-center">
        <h2 className="font-display text-2xl font-bold text-foreground">This hunt is not a game</h2>
        <p className="mt-2 text-muted-foreground">
          Turn on &quot;Players join and are timed&quot; in the session settings to run it as a game.
        </p>
        <Link href={`/dashboard/sessions/${sessionId}`} className="mt-4 inline-block text-accent hover:underline">
          Back to {session.title}
        </Link>
      </div>
    )
  }

  const clock = huntClock(
    { started_at: session.hunt_started_at, ends_at: session.hunt_ends_at, stopped_at: session.hunt_stopped_at },
    now
  )
  const { pending, approved } = splitBoard(board)
  const nameCounts = board.reduce((acc, r) => {
    if (r.approval_status === 'rejected') return acc
    const k = (r.name || '').trim().toLowerCase()
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {})
  const isDuplicate = (r) => nameCounts[(r.name || '').trim().toLowerCase()] > 1
  const started = Boolean(session.hunt_started_at)
  const stopped = clock.state === 'over'
  const running = clock.state === 'running'

  const clockCaption = {
    not_started: 'Not started',
    running: clock.countdown ? 'Time left' : 'Elapsed',
    over: 'Hunt over',
  }[clock.state]

  return (
    <div className="py-8">
      <div className="mb-8">
        <Link href={`/dashboard/sessions/${sessionId}`} className="text-sm text-accent hover:underline">
          ← Back to {session.title}
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="font-display text-3xl font-bold text-foreground">Run hunt</h1>
          <HelpLink slug="treasure-hunt" label="About Treasure Hunts" />
        </div>
      </div>

      {error && (
        <p role="alert" className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className={cardClass} aria-labelledby="join-heading">
          <h2 id="join-heading" className="text-lg font-bold text-foreground">Join link</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Players scan this, enter their name, and wait for you to let them in.
            {started && ' Joining is closed now that the hunt has started.'}
          </p>
          <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="rounded-xl bg-white p-3">
              <QRCodeSVG value={joinUrl} size={160} level="M" bgColor="#ffffff" fgColor="#111418" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="break-all text-sm text-foreground" data-testid="hunt-join-url">{joinUrl}</p>
              <button onClick={copyLink} className={`${secondaryButton} mt-3`}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          </div>
        </section>

        <section className={cardClass} aria-labelledby="clock-heading">
          <h2 id="clock-heading" className="text-lg font-bold text-foreground">Hunt clock</h2>
          <p className="mt-4 text-sm text-muted-foreground">{clockCaption}</p>
          <p className="font-display text-5xl font-bold tabular-nums text-foreground" data-testid="hunt-clock">
            {clock.label}
          </p>
          {!readOnly && (
            <div className="mt-5">
              {!started && (
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-sm text-foreground">
                    <span className="block text-muted-foreground">Length in minutes (optional)</span>
                    <input
                      type="number"
                      min="1"
                      inputMode="numeric"
                      value={minutes}
                      onChange={(e) => setMinutes(e.target.value)}
                      placeholder="No limit"
                      className="mt-1 w-32 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    />
                  </label>
                  <button onClick={start} disabled={busy} className={primaryButton}>Start hunt</button>
                </div>
              )}
              {running && (
                <button
                  onClick={() => act('stop_hunt', { p_session_id: sessionId }, 'Could not stop the hunt.')}
                  disabled={busy}
                  className={primaryButton}
                >
                  Stop hunt
                </button>
              )}
              {started && (
                <button
                  onClick={() => setConfirmReset(true)}
                  disabled={busy}
                  className={`${secondaryButton} ${running ? 'ml-3' : ''}`}
                >
                  Reset hunt
                </button>
              )}
            </div>
          )}
          {!started && !readOnly && (
            <p className="mt-3 text-xs text-muted-foreground">
              Starting closes joining. You can still approve players who already joined.
            </p>
          )}
        </section>
      </div>

      <section className={`${cardClass} mt-6`} aria-labelledby="pending-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="pending-heading" className="text-lg font-bold text-foreground">
            Waiting for approval ({pending.length})
          </h2>
          {!readOnly && pending.length > 0 && (
            <button
              onClick={() => act('approve_all_hunt_players', { p_session_id: sessionId }, 'Could not approve everyone.')}
              disabled={busy}
              className={primaryButton}
            >
              Approve all
            </button>
          )}
        </div>
        {pending.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nobody is waiting.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {pending.map((p) => (
              <li key={p.participant_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <span className="font-medium text-foreground">{p.name}</span>
                  {isDuplicate(p) && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      Same name
                    </span>
                  )}
                  <span className="ml-2 text-xs text-muted-foreground">joined {formatJoined(p.joined_at)}</span>
                </div>
                {!readOnly && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => act('set_hunt_approval', { p_participant_id: p.participant_id, p_status: 'approved' }, 'Could not approve.')}
                      disabled={busy}
                      className={secondaryButton}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => act('set_hunt_approval', { p_participant_id: p.participant_id, p_status: 'rejected' }, 'Could not reject.')}
                      disabled={busy}
                      className={secondaryButton}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={`${cardClass} mt-6`} aria-labelledby="board-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="board-heading" className="text-lg font-bold text-foreground">
            Players and leaderboard ({approved.length})
          </h2>
          {stopped && approved.length > 0 && (
            <button onClick={downloadCsv} className={secondaryButton}>Download CSV</button>
          )}
        </div>
        {approved.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No approved players yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Rank</th>
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">Clues found</th>
                  <th className="py-2 pr-3 font-medium">Last scan</th>
                  <th className="py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {approved.map((p) => (
                  <tr key={p.participant_id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 tabular-nums">{p.rank ?? '-'}</td>
                    <td className="py-2 pr-3 font-medium text-foreground">
                      {p.name}
                      {isDuplicate(p) && <span className="ml-2 text-xs text-amber-700">(same name)</span>}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{p.clues_found ?? 0} of {clueCount}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {p.last_scan_at && session.hunt_started_at
                        ? formatDuration(Date.parse(p.last_scan_at) - Date.parse(session.hunt_started_at))
                        : '-'}
                    </td>
                    <td className="py-2 text-right">
                      {!readOnly && (
                        <button
                          onClick={() => act('remove_participant', { p_participant_id: p.participant_id }, 'Could not remove.')}
                          disabled={busy}
                          className="text-sm font-semibold text-destructive hover:underline disabled:opacity-50"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmReset}
        title="Reset this hunt?"
        confirmLabel="Reset hunt"
        busyLabel="Resetting…"
        busy={busy}
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          await act('reset_hunt', { p_session_id: sessionId }, 'Could not reset the hunt.')
          setConfirmReset(false)
        }}
      >
        <p className="mt-2 text-sm text-muted-foreground">
          This removes every player, scan and pick, and clears the clock. Your clues and printed QR
          codes stay the same. Download the CSV first if you want to keep the results.
        </p>
      </ConfirmDialog>
    </div>
  )
}
