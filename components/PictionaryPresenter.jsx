'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { createClient } from '@/lib/supabase/client'
import DrawingCanvas from '@/components/DrawingCanvas'
import Leaderboard from '@/components/Leaderboard'
import { sendCanvasClear } from '@/lib/drawingChannel'
import { blanksFor } from '@/lib/pictionaryBlanks'
import { secondsLeft } from '@/lib/pictionaryPhone'

const GUESS_POLL_MS = 1500 // Guess comments are not delivered by realtime
const btn = 'rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50'
const primaryBtn = 'inline-flex items-center rounded-lg bg-gradient-to-r from-primary to-accent px-8 py-3 text-lg font-semibold text-white shadow-lg hover:opacity-90 transition-opacity disabled:cursor-not-allowed disabled:opacity-50'


// Presenter stage + host console for a Pictionary session. The page owns the header, the roster
// drawer (Remove) and session updates; everything Round-shaped lives here.
export default function PictionaryPresenter({ sessionId, session, isOwner, voteUrl, onError, entriesClosed, onToggleEntries, togglingEntries, onToggleRoster, onUpdateSession }) {
  const supabase = createClient()
  const [rounds, setRounds] = useState([])
  const [participants, setParticipants] = useState([])
  const [guesses, setGuesses] = useState([])
  const [board, setBoard] = useState([])
  const [drawerChoice, setDrawerChoice] = useState('') // '' = random
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const lastDue = useRef({ key: null, at: 0 })

  const round = rounds[rounds.length - 1] ?? null
  const status = round?.status
  const podium = Boolean(session.scored_closed)
  const nameOf = (id) => {
    const p = participants.find((x) => x.id === id)
    return p ? p.name || p.external_id : null
  }

  const loadRounds = useCallback(async () => {
    const { data } = await supabase.from('pictionary_rounds').select('*').eq('session_id', sessionId).order('round_number')
    if (data) setRounds(data)
  }, [sessionId])
  const loadParticipants = useCallback(async () => {
    const { data } = await supabase.from('participants').select('id, name, external_id').eq('session_id', sessionId).order('created_at')
    if (data) setParticipants(data)
  }, [sessionId])
  const loadGuesses = useCallback(async () => {
    const { data } = await supabase.rpc('get_pictionary_guesses', { p_session_id: sessionId })
    if (data) setGuesses(data)
  }, [sessionId])
  const loadBoard = useCallback(async () => {
    const { data } = await supabase.rpc('get_pictionary_leaderboard', { p_session_id: sessionId })
    if (data) setBoard(data.map((p) => ({ ...p, rank: Number(p.rank), total_response_ms: Number(p.total_response_ms) })))
  }, [sessionId])

  // Round state: initial load (also the reload catch-up), realtime row changes, and a slow poll as a backstop.
  useEffect(() => {
    loadRounds()
    const ch = supabase
      .channel(`present-pictionary-${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pictionary_rounds', filter: `session_id=eq.${sessionId}` }, loadRounds)
      .subscribe()
    const poll = setInterval(loadRounds, 5000)
    return () => { clearInterval(poll); supabase.removeChannel(ch) }
  }, [sessionId, loadRounds])

  useEffect(() => {
    loadParticipants()
    const t = setInterval(loadParticipants, 3000)
    return () => clearInterval(t)
  }, [loadParticipants])

  // Guess feed: poll while drawing, refetch once on every Round change.
  useEffect(() => {
    if (!round || status === 'choosing') { setGuesses([]); return }
    loadGuesses()
    if (status !== 'drawing') return
    const t = setInterval(loadGuesses, GUESS_POLL_MS)
    return () => clearInterval(t)
  }, [round?.id, status, loadGuesses])

  // Ranking between Rounds and at the end.
  // The winner can change within a revealed Round (Change winner), so it is a dependency too.
  useEffect(() => { if (status === 'revealed' || podium) loadBoard() }, [status, round?.id, round?.winner_comment_id, podium, loadBoard])

  // Clock, and the time boundaries the presenter drives (the server re-validates each call).
  useEffect(() => {
    if (!round || status === 'revealed') return
    const t = setInterval(() => {
      const n = Date.now()
      setNow(n)
      if (!isOwner) return
      const due = status === 'choosing' ? round.choose_deadline : round.ends_at
      const key = `${round.id}:${status}`
      if (!due || n < Date.parse(due) || (lastDue.current.key === key && n - lastDue.current.at < 3000)) return
      lastDue.current = { key, at: n } // retried every 3s in case of clock skew
      supabase.rpc(status === 'choosing' ? 'auto_pick_pictionary_word' : 'timeout_pictionary_round', { p_session_id: sessionId }).then(loadRounds)
    }, 500)
    return () => clearInterval(t)
  }, [round, status, isOwner, sessionId, loadRounds])

  // Run an owner RPC, surface errors, refresh Round state.
  const act = async (fn, args) => {
    setBusy(true)
    onError(null)
    const { error } = await supabase.rpc(fn, { p_session_id: sessionId, ...args })
    if (error) onError(error.message)
    await Promise.all([loadRounds(), loadGuesses()])
    setBusy(false)
  }
  const drawerArg = { p_drawer_id: drawerChoice || null }

  const lastRound = round && round.round_number >= session.pictionary_round_count
  const drawerSelect = (
    <select value={drawerChoice} onChange={(e) => setDrawerChoice(e.target.value)} aria-label="Drawer" className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
      <option value="">Random drawer</option>
      {participants.map((p) => (
        <option key={p.id} value={p.id}>{p.name || p.external_id}</option>
      ))}
    </select>
  )

  const feed = (
    <ul data-testid="guess-feed" className="min-h-0 flex-1 space-y-2 overflow-y-auto">
      {guesses.length === 0 && <li className="text-sm text-muted-foreground">No guesses yet.</li>}
      {guesses.map((g) => (
        <li key={g.comment_id} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${g.is_winner ? 'border-accent bg-primary/10' : 'border-border'}`}>
          <span className="min-w-0">
            <span className="block truncate text-xs text-muted-foreground">{g.author_name}</span>
            <span className="block truncate text-lg text-foreground">{g.body}</span>
          </span>
          {g.is_winner ? (
            <span className="shrink-0 text-sm font-bold text-accent">Winner</span>
          ) : isOwner && (
            <button disabled={busy} onClick={() => act('pick_pictionary_winner', { p_comment_id: g.comment_id })} className={`shrink-0 ${btn}`}>
              {round?.winner_comment_id ? 'Change winner' : 'Pick as winner'}
            </button>
          )}
        </li>
      ))}
    </ul>
  )

  let stage
  if (podium) {
    stage = (
      <div className="w-full max-w-4xl text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">Final results</p>
        <h1 className="mt-3 font-display text-4xl font-bold text-foreground md:text-5xl">{session.title}</h1>
        <div className="mt-10"><Leaderboard entries={board} podium total={participants.length} /></div>
      </div>
    )
  } else if (!round) {
    stage = (
      <div className="text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">{entriesClosed ? 'Entries closed' : 'Scan to join'}</p>
        <h1 className="mt-3 font-display text-4xl font-bold text-foreground md:text-6xl">{session.title}</h1>
        <div className="relative mt-8 inline-block rounded-2xl bg-white p-6 shadow-2xl">
          <div className={entriesClosed ? 'opacity-20' : ''}><QRCodeSVG value={voteUrl} size={260} level="H" bgColor="#ffffff" fgColor="#000000" /></div>
          {entriesClosed && <span className="absolute inset-0 flex items-center justify-center font-display text-3xl font-bold text-black">Entries closed</span>}
        </div>
        <p className="mt-4 break-all font-mono text-base text-muted-foreground">{voteUrl}</p>
        <p className="mt-6 text-base font-medium text-foreground">{participants.length} {participants.length === 1 ? 'participant' : 'participants'} joined</p>
        <ul data-testid="lobby-names" className="mx-auto mt-3 flex max-w-3xl flex-wrap justify-center gap-2">
          {participants.map((p) => <li key={p.id} className="rounded-full border border-border bg-card px-3 py-1 text-sm text-foreground">{p.name || p.external_id}</li>)}
        </ul>
      </div>
    )
  } else if (status === 'choosing') {
    stage = (
      <div className="text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">Round {round.round_number} of {session.pictionary_round_count}</p>
        <h1 data-testid="choosing" className="mt-4 font-display text-5xl font-bold text-foreground md:text-7xl">{nameOf(round.drawer_id) ?? 'The drawer'} is choosing…</h1>
        <p className="mt-6 font-display text-3xl text-muted-foreground">{secondsLeft(round.choose_deadline, now)}s</p>
      </div>
    )
  } else {
    const drawing = status === 'drawing'
    const winnerName = nameOf(round.winner_participant_id) ?? guesses.find((g) => g.is_winner)?.author_name
    stage = (
      <div className="grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <DrawingCanvas key={round.id} sessionId={sessionId} mode="view" />
        <div className="flex min-h-0 flex-col gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-accent">Round {round.round_number} of {session.pictionary_round_count}</p>
            <p className="mt-1 text-lg text-foreground"><span className="text-muted-foreground">Drawing:</span> <b data-testid="drawer-name">{nameOf(round.drawer_id) ?? 'Drawer'}</b></p>
          </div>
          {drawing ? (
            <>
              <p data-testid="timer" className="font-display text-5xl font-bold text-foreground">{secondsLeft(round.ends_at, now)}s</p>
              <p data-testid="blanks" className="whitespace-pre font-mono text-2xl tracking-widest text-foreground">{round.word_pattern ? blanksFor(round.word_pattern) : '…'}</p>
            </>
          ) : (
            <div data-testid="reveal" className="rounded-xl border border-accent/50 bg-primary/10 p-4">
              <p className="text-sm text-muted-foreground">The word was</p>
              <p data-testid="reveal-word" className="font-display text-4xl font-bold text-foreground">{round.word}</p>
              <p className="mt-2 text-foreground">
                {round.winner_participant_id || winnerName
                  ? <>Won by <b>{winnerName ?? 'a guesser'}</b> · +{round.winner_points ?? 0} pts · drawer +{round.drawer_points}</>
                  : round.end_reason === 'skipped' ? 'Round skipped · no points' : 'Nobody guessed it'}
              </p>
            </div>
          )}
          {feed}
          {!drawing && board.length > 0 && <div className="max-h-56 overflow-y-auto"><Leaderboard entries={board} total={participants.length} showAnswered={false} /></div>}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="relative flex flex-1 items-center justify-center px-6 py-8">{stage}</div>
      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-6 py-4">
        {isOwner ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={onToggleRoster} className={btn}>Participants</button>
              <button onClick={onToggleEntries} disabled={togglingEntries} aria-pressed={entriesClosed} className={btn}>{entriesClosed ? 'Open entries' : 'Close entries'}</button>
              {!podium && (status === 'drawing' || status === 'choosing') && (
                <>
                  <button disabled={busy} onClick={() => act('skip_pictionary_round')} className={btn}>Skip round</button>
                  {status === 'drawing' && <button onClick={() => sendCanvasClear(sessionId)} className={btn}>Clear canvas</button>}
                  {drawerSelect}
                  <button disabled={busy} onClick={() => act('pick_another_pictionary_drawer', drawerArg)} className={btn}>Pick another drawer</button>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {podium ? (
                <button onClick={() => onUpdateSession({ scored_closed: false })} className={btn}>Back to rounds</button>
              ) : !round ? (
                <>
                  {drawerSelect}
                  <button data-testid="start" disabled={busy || participants.length < 2} onClick={() => act('start_pictionary_round', drawerArg)} className={primaryBtn}>Start</button>
                  {participants.length < 2 && <span className="text-sm text-muted-foreground">Needs at least 2 participants</span>}
                </>
              ) : status === 'revealed' ? (
                lastRound ? (
                  <button data-testid="final" disabled={busy} onClick={() => onUpdateSession({ scored_closed: true })} className={primaryBtn}>Final results</button>
                ) : (
                  <>
                    {drawerSelect}
                    <button data-testid="next" disabled={busy} onClick={() => act('start_pictionary_round', drawerArg)} className={primaryBtn}>Next round</button>
                  </>
                )
              ) : null}
            </div>
          </>
        ) : (
          <p className="ml-auto text-sm text-muted-foreground">Only the session owner can control this presentation.</p>
        )}
      </footer>
    </>
  )
}
