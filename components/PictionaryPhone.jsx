'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import DrawingCanvas from '@/components/DrawingCanvas'
import Leaderboard from '@/components/Leaderboard'
import { cooldownLeft, blankWords, secondsLeft, GUESS_COOLDOWN_MS } from '@/lib/pictionaryPhone'

const FEED_POLL_MS = 1500 // guess comments are not delivered by realtime
const BACKUP_POLL_MS = 4000 // venue Wi-Fi drops websockets; keeps the Round state honest

// Phone surface for a Pictionary session: Drawer (Word choice, canvas) and guesser
// (live canvas, blanks, Guess box, feed, standing). The vote page renders this after the join gate.
export default function PictionaryPhone({ session, participant, onSwitch }) {
  const supabase = createClient()
  const sessionId = session.id
  const token = participant.join_token
  const [round, setRound] = useState(undefined) // undefined = loading, null = no Round yet
  const [guesses, setGuesses] = useState([])
  const [board, setBoard] = useState([])
  const [choices, setChoices] = useState([])
  const [myWord, setMyWord] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const [draft, setDraft] = useState('')
  const [lastGuessAt, setLastGuessAt] = useState(null)
  const [guessError, setGuessError] = useState(null)
  const [won, setWon] = useState(false)
  const [sending, setSending] = useState(false)
  const [pickError, setPickError] = useState(null)
  const roundIdRef = useRef(null)

  const isDrawer = Boolean(round && round.drawer_id === participant.id)
  const status = round?.status
  const live = status === 'choosing' || status === 'drawing'

  const loadRound = useCallback(async () => {
    const { data, error } = await supabase
      .from('pictionary_rounds')
      .select('*')
      .eq('session_id', sessionId)
      .order('round_number', { ascending: false })
      .limit(1)
    if (!error) setRound(data?.[0] ?? null)
  }, [sessionId])

  const loadBoard = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_pictionary_leaderboard', { p_session_id: sessionId })
    if (!error) {
      setBoard((data || []).map((p) => ({ ...p, score: Number(p.score), rank: Number(p.rank), total_response_ms: 0 })))
    }
  }, [sessionId])

  const loadGuesses = useCallback(async (roundId) => {
    const { data, error } = await supabase.rpc('get_pictionary_guesses', { p_session_id: sessionId, p_round_id: roundId })
    if (!error && roundIdRef.current === roundId) setGuesses(data || [])
  }, [sessionId])

  // Round state: realtime row changes, a slow backup poll, and a refetch when the tab wakes (reload/catch-up).
  useEffect(() => {
    loadRound()
    const channel = supabase
      .channel(`pictionary-rounds-${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pictionary_rounds', filter: `session_id=eq.${sessionId}` }, loadRound)
      .subscribe()
    const timer = setInterval(loadRound, BACKUP_POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') loadRound() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [sessionId, loadRound])

  // Reset per-Round state when the Round changes.
  const roundId = round?.id ?? null
  useEffect(() => {
    roundIdRef.current = roundId
    setGuesses([])
    setWon(false)
    setGuessError(null)
    setPickError(null)
    setMyWord(null)
    setChoices([])
  }, [roundId])

  // Guess feed: poll while the Round is live, and once more when it flips (incl. reveal).
  useEffect(() => {
    if (!roundId) return
    loadGuesses(roundId)
    if (!live) return
    const timer = setInterval(() => loadGuesses(roundId), FEED_POLL_MS)
    return () => clearInterval(timer)
  }, [roundId, live, status, loadGuesses])

  // Leaderboard: names for the Drawer/winner, own standing, and the final ranking.
  useEffect(() => {
    loadBoard()
    const timer = setInterval(loadBoard, 5000)
    return () => clearInterval(timer)
  }, [loadBoard])
  useEffect(() => { if (status === 'revealed') loadBoard() }, [status, roundId, loadBoard])

  // Drawer: the 3 offered Words while Choosing, the picked Word while Drawing.
  useEffect(() => {
    if (!isDrawer || !roundId) return
    if (status === 'choosing') {
      supabase.rpc('get_pictionary_choices', { p_join_token: token }).then(({ data, error }) => {
        if (!error && roundIdRef.current === roundId) setChoices(data || [])
      })
    } else if (status === 'drawing') {
      supabase.rpc('get_pictionary_word', { p_session_id: sessionId, p_join_token: token }).then(({ data, error }) => {
        if (!error && roundIdRef.current === roundId) setMyWord(data)
      })
    }
  }, [isDrawer, roundId, status, token, sessionId])

  // One ticker drives the countdown, the choose window and the Guess cooldown.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [])

  async function choose(wordId) {
    setPickError(null)
    const { error } = await supabase.rpc('choose_pictionary_word', { p_join_token: token, p_word_id: wordId })
    if (error) setPickError(error.message)
    else loadRound()
  }

  async function submitGuess(e) {
    e.preventDefault()
    if (!draft.trim() || sending) return
    setSending(true)
    setGuessError(null)
    const { data, error } = await supabase.rpc('submit_pictionary_guess', { p_join_token: token, p_body: draft.trim() })
    setSending(false)
    if (error) {
      // The server's cooldown message means a guess just went through: restart ours.
      if (/wait a moment/i.test(error.message)) setLastGuessAt(Date.now())
      setGuessError(error.message)
      return
    }
    setDraft('')
    setLastGuessAt(Date.now())
    if (data?.[0]?.won) setWon(true)
    loadGuesses(roundId)
    loadRound()
  }

  const nameOf = (id) => board.find((p) => p.participant_id === id)?.display_name
    ?? guesses.find((g) => g.participant_id === id)?.author_name
  const me = board.find((p) => p.participant_id === participant.id)
  const isFinal = status === 'revealed' && round.round_number >= session.pictionary_round_count
  const cooldown = cooldownLeft(lastGuessAt, now)
  const timeLeft = status === 'drawing' ? secondsLeft(round.ends_at, now) : 0
  const blanks = blankWords(round?.word_pattern)

  const card = 'rounded-2xl border border-border bg-card p-5 shadow-lg'

  const feed = (
    <div className={card}>
      <h3 className="text-sm font-semibold text-foreground">Guesses</h3>
      {guesses.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No guesses yet.</p>
      ) : (
        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto" aria-live="polite">
          {[...guesses].reverse().map((g) => (
            <li key={g.comment_id} className={`rounded-lg px-3 py-1.5 text-sm ${g.is_winner ? 'bg-primary/15 font-semibold text-foreground' : 'text-foreground'}`}>
              <span className="text-muted-foreground">{g.author_name}: </span>
              <span className="break-words">{g.body}</span>
              {g.is_winner && <span className="ml-2 text-xs text-accent">winner</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  const standing = (
    <div className="space-y-3">
      {me && (
        <div className={`${card} text-center`}>
          <p className="text-sm text-muted-foreground">Your standing</p>
          <p className="font-display text-2xl font-bold text-foreground">#{me.rank} · {me.score} pts</p>
        </div>
      )}
      <div className={card}>
        <Leaderboard entries={board} currentId={participant.id} total={session.pictionary_round_count} />
      </div>
    </div>
  )

  let body
  if (round === undefined) {
    body = <p className="text-center text-muted-foreground">Loading…</p>
  } else if (round === null) {
    body = (
      <div className={`${card} text-center`}>
        <h2 className="font-display text-xl font-bold text-foreground">You're in ✓</h2>
        <p className="mt-2 text-muted-foreground">Waiting for the host to start the first round.</p>
      </div>
    )
  } else if (status === 'choosing' && isDrawer) {
    const left = secondsLeft(round.choose_deadline, now)
    body = (
      <div className={card}>
        <h2 className="font-display text-xl font-bold text-foreground">Your turn to draw!</h2>
        <p className="mt-1 text-sm text-muted-foreground">Pick a word ({left}s, otherwise one is chosen for you).</p>
        <div className="mt-4 grid gap-3">
          {choices.map((c) => (
            <button key={c.word_id} onClick={() => choose(c.word_id)} className="rounded-xl border border-border bg-background px-4 py-4 text-lg font-semibold text-foreground active:bg-primary/10">
              {c.word}
            </button>
          ))}
        </div>
        {pickError && <p className="mt-3 text-sm font-medium text-destructive">{pickError}</p>}
      </div>
    )
  } else if (status === 'choosing') {
    body = (
      <div className={`${card} text-center`}>
        <p className="text-sm text-muted-foreground">Round {round.round_number} of {session.pictionary_round_count}</p>
        <h2 className="font-display mt-1 text-xl font-bold text-foreground">{nameOf(round.drawer_id) ?? 'The drawer'} is choosing a word…</h2>
      </div>
    )
  } else if (status === 'drawing') {
    body = (
      <div className="space-y-4">
        <div className={`${card} flex items-center justify-between`}>
          <div>
            <p className="text-xs text-muted-foreground">Round {round.round_number} of {session.pictionary_round_count} · {isDrawer ? 'You are drawing' : `${nameOf(round.drawer_id) ?? 'Someone'} is drawing`}</p>
            {isDrawer ? (
              <p className="font-display text-xl font-bold text-foreground">Draw: {myWord ?? '…'}</p>
            ) : blanks ? (
              <p className="font-display flex flex-wrap gap-x-5 text-xl font-bold tracking-widest text-foreground" aria-label="Word blanks">
                {blanks.map((w, i) => <span key={i}>{w.join(' ')}</span>)}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">The word is hidden until the reveal.</p>
            )}
          </div>
          <span className="font-display text-2xl font-bold tabular-nums text-accent">{timeLeft}s</span>
        </div>
        <DrawingCanvas key={round.id} sessionId={sessionId} mode={isDrawer ? 'draw' : 'view'} />
        {!isDrawer && (
          won ? (
            <p className={`${card} text-center font-semibold text-foreground`}>🎉 You got it!</p>
          ) : (
            <form onSubmit={submitGuess} className={card}>
              <label htmlFor="pictionary-guess" className="text-sm font-semibold text-foreground">Your guess</label>
              <div className="mt-2 flex gap-2">
                <input
                  id="pictionary-guess"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={200}
                  autoComplete="off"
                  autoCapitalize="none"
                  enterKeyHint="send"
                  className="min-w-0 flex-1 rounded-lg border border-border px-3 py-3 text-base text-foreground"
                  placeholder="What is it?"
                />
                <button type="submit" disabled={sending || cooldown > 0 || !draft.trim()} className="relative shrink-0 overflow-hidden rounded-lg bg-gradient-to-r from-primary to-accent px-4 py-3 font-semibold text-white disabled:opacity-50">
                  {cooldown > 0 ? `Wait ${(cooldown / 1000).toFixed(1)}s` : 'Guess'}
                  {cooldown > 0 && (
                    <span className="absolute bottom-0 left-0 h-1 bg-white/70" style={{ width: `${(cooldown / GUESS_COOLDOWN_MS) * 100}%` }} />
                  )}
                </button>
              </div>
              {guessError && <p className="mt-2 text-sm font-medium text-destructive">{guessError}</p>}
            </form>
          )
        )}
        {feed}
      </div>
    )
  } else {
    // revealed
    const winnerName = round.winner_participant_id ? nameOf(round.winner_participant_id) : null
    body = (
      <div className="space-y-4">
        <div className={`${card} text-center`}>
          <p className="text-sm text-muted-foreground">Round {round.round_number} of {session.pictionary_round_count}</p>
          <p className="font-display mt-1 text-3xl font-bold text-foreground">{round.word ?? '—'}</p>
          <p className="mt-2 text-foreground">
            {round.winner_participant_id
              ? `${round.winner_participant_id === participant.id ? 'You' : winnerName ?? 'Someone'} guessed it${round.winner_points != null ? ` (+${round.winner_points})` : ''}`
              : round.end_reason === 'skipped' ? 'Round skipped' : 'Nobody guessed it'}
          </p>
          {isDrawer && round.drawer_points > 0 && <p className="text-sm text-muted-foreground">Drawer bonus +{round.drawer_points}</p>}
        </div>
        <DrawingCanvas key={round.id} sessionId={sessionId} mode="view" />
        {isFinal ? (
          <div className={card}>
            <h2 className="font-display mb-4 text-center text-2xl font-bold text-foreground">Final ranking</h2>
            <Leaderboard entries={board} podium total={session.pictionary_round_count} />
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground">Waiting for the host to start the next round.</p>
        )}
        {standing}
        {feed}
      </div>
    )
  }

  return (
    <main className="container mx-auto px-4 py-6">
      <div className="mx-auto max-w-md space-y-4">
        {body}
        {onSwitch && (
          <button onClick={onSwitch} className="block w-full text-center text-sm font-medium text-accent hover:underline">
            Not {participant.name || 'you'}? Switch
          </button>
        )}
      </div>
    </main>
  )
}
