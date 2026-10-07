'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { QRCodeSVG } from 'qrcode.react'
import { createClient } from '@/lib/supabase/client'
import { useQuestionClock } from '@/lib/useQuestionClock'
import ResultsChart from '@/components/ResultsChart'
import Leaderboard from '@/components/Leaderboard'
import { getAppUrl } from '@/lib/utils'
import SessionTheme from '@/components/SessionTheme'
import SessionLogo from '@/components/SessionLogo'
import WheelPresenter from '@/components/WheelPresenter'

// Full-screen presenter view for projecting a session. The host's position
// lives in sessions.current_question_index, and every attendee device on
// /vote/[slug] follows it over Supabase Realtime:
//   -1 = lobby (QR code), 0..n-1 = question, n = finished, NULL = not presenting
// With results_mode 'live', Next becomes two steps per question: first
// it sets results_revealed (results on screen, voting closed), then it moves on.
// Lives outside /dashboard so the dashboard nav doesn't appear on the
// projector; middleware.js protects /present/* the same way.
export default function PresentPage() {
  const params = useParams()
  const router = useRouter()
  const sessionId = params.sessionId
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [questions, setQuestions] = useState([])
  const [optionsByQuestion, setOptionsByQuestion] = useState({})
  const [voteCounts, setVoteCounts] = useState({})
  const [userId, setUserId] = useState(null)
  const [advancing, setAdvancing] = useState(false)
  const [error, setError] = useState(null)
  const [participantCount, setParticipantCount] = useState(0)
  const [participantNames, setParticipantNames] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [commentCounts, setCommentCounts] = useState({}) // {questionId: count}
  const [commentWall, setCommentWall] = useState([]) // owner-only, current image
  // Scored quiz: the answer key (owner-only, fetched once) to highlight the
  // correct option at reveal, and how many participants have locked an
  // answer for the open question - a total only, never the per-option split,
  // so it can be shown before reveal without hinting at the answer.
  const [correctOptionByQuestion, setCorrectOptionByQuestion] = useState({})
  const [lockedCount, setLockedCount] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [canFullscreen, setCanFullscreen] = useState(false)

  // Browser fullscreen hides the URL bar and tabs while projecting. Track it
  // via fullscreenchange so Esc keeps the button label right, and leave it on
  // unmount so client-side navigation doesn't strand the dashboard fullscreen.
  useEffect(() => {
    setCanFullscreen(Boolean(document.fullscreenEnabled))
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    }
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    else document.documentElement.requestFullscreen?.().catch(() => {})
  }

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false

    const load = async () => {
      try {
        const [{ data: { user } }, { data: sessionData, error: sessionError }] = await Promise.all([
          supabase.auth.getUser(),
          supabase.from('sessions').select('*').eq('id', sessionId).single(),
        ])
        if (sessionError) throw sessionError

        const { data: questionsData, error: questionsError } = await supabase
          .from('questions')
          .select('*')
          .eq('session_id', sessionId)
          .order('order_index')
        if (questionsError) throw questionsError

        const questionIds = (questionsData || []).map((q) => q.id)
        const optionsMap = {}
        if (questionIds.length > 0) {
          const { data: optionsData, error: optionsError } = await supabase
            .from('options')
            .select('*')
            .in('question_id', questionIds)
            .order('order_index')
          if (optionsError) throw optionsError
          for (const option of optionsData || []) {
            ;(optionsMap[option.question_id] ||= []).push(option)
          }
        }

        // The answer key, for the reveal stage's correct-option highlight.
        // Owner-only under RLS; harmless to fetch upfront since it never
        // reaches an attendee.
        const keyMap = {}
        if (sessionData.is_scored && questionIds.length > 0) {
          const { data: keysData } = await supabase
            .from('question_keys')
            .select('question_id, option_id')
            .in('question_id', questionIds)
          for (const k of keysData || []) keyMap[k.question_id] = k.option_id
        }

        if (cancelled) return
        setUserId(user?.id ?? null)
        setSession(sessionData)
        setQuestions(questionsData || [])
        setOptionsByQuestion(optionsMap)
        setCorrectOptionByQuestion(keyMap)

        // Opening this page directly (not via Start) on a session that isn't
        // presenting puts attendees in the lobby, same as pressing Start.
        if (user?.id === sessionData.owner_id && sessionData.current_question_index === null) {
          await updateSession({ current_question_index: -1, results_revealed: false }, sessionData)
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Could not load this session.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // Keep a second presenter tab (or a phone used as a remote) in sync.
  useEffect(() => {
    if (!sessionId) return
    const channel = supabase
      .channel(`present-${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
        (payload) => setSession((prev) => (prev ? { ...prev, ...payload.new } : prev))
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [sessionId])

  // While a question is open, poll counts so the presenter sees votes arrive
  // (and the chart stays current once results are revealed).
  const revealed = Boolean(session?.results_revealed)
  const inQuestion =
    session?.current_question_index != null &&
    session.current_question_index >= 0 &&
    session.current_question_index < questions.length
  useEffect(() => {
    if (!inQuestion || !sessionId) return
    const loadCounts = async () => {
      const { data, error: rpcError } = await supabase.rpc('get_vote_counts', { p_session_id: sessionId })
      if (rpcError) return
      const counts = {}
      for (const row of data || []) counts[row.opt_id] = Number(row.vote_total) || 0
      setVoteCounts(counts)
    }
    loadCounts()
    const interval = setInterval(loadCounts, 3000)
    return () => clearInterval(interval)
  }, [inQuestion, sessionId])

  // Image & comments: the owner's live comment wall for the open image, plus a
  // count per image so the footer/stage pill can show "N comments" like votes.
  const isComments = session?.session_type === 'comments'
  const isWheel = session?.session_type === 'wheel'
  useEffect(() => {
    if (!isComments || !inQuestion || !sessionId) return
    const questionId = questions[session.current_question_index]?.id
    if (!questionId) return
    const loadWall = async () => {
      const { data, error: rpcError } = await supabase.rpc('get_comments', {
        p_session_id: sessionId,
        p_question_id: questionId,
      })
      if (rpcError) return
      setCommentWall(data || [])
      setCommentCounts((prev) => ({ ...prev, [questionId]: (data || []).length }))
    }
    loadWall()
    const interval = setInterval(loadWall, 3000)
    return () => clearInterval(interval)
  }, [isComments, inQuestion, sessionId, session?.current_question_index, questions])

  // Owner-only realtime push so a new comment appears without waiting for the
  // next poll; comments has no attendee SELECT policy, so only the owner's
  // subscription receives these events.
  useEffect(() => {
    if (!isComments || !sessionId) return
    const channel = supabase
      .channel(`present-comments-${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'comments' },
        () => {
          const questionId = questions[session?.current_question_index]?.id
          if (!questionId) return
          supabase.rpc('get_comments', { p_session_id: sessionId, p_question_id: questionId })
            .then(({ data }) => {
              setCommentWall(data || [])
              setCommentCounts((prev) => ({ ...prev, [questionId]: (data || []).length }))
            })
        }
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [isComments, sessionId, session?.current_question_index, questions])

  // Lobby for identified sessions: a public join count via the aggregate RPC,
  // plus the live name wall for the owner (RLS keeps participant rows private
  // to everyone else). A scored quiz is host-paced like everything else now,
  // so -1 means lobby for it too.
  const lobby = session?.current_question_index === -1
  const identified = session?.participation_mode === 'identified'
  const isScored = Boolean(session?.is_scored)
  useEffect(() => {
    if (!identified || !lobby || !sessionId) return
    let cancelled = false
    const load = async () => {
      const { data } = await supabase.rpc('get_participant_count', { p_session_id: sessionId })
      if (!cancelled) setParticipantCount(Number(data) || 0)

      if (userId && session?.owner_id === userId) {
        const { data: rows } = await supabase
          .from('participants')
          .select('name, external_id')
          .eq('session_id', sessionId)
          .order('created_at')
        if (!cancelled) {
          setParticipantNames((rows || []).map((r) => r.name || r.external_id).filter(Boolean))
        }
      }
    }
    load()
    const interval = setInterval(load, 4000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [identified, lobby, sessionId, userId, session?.owner_id])

  // Scored quiz: the live ranked board shown on the presenter screen.
  useEffect(() => {
    if (!isScored || !sessionId) return
    let cancelled = false
    const load = async () => {
      // Ranked server-side (Score, then cumulative Response time) so the
      // presenter, the phones and the results page can't disagree.
      const { data } = await supabase.rpc('get_leaderboard', { p_session_id: sessionId })
      if (!cancelled) {
        setLeaderboard(
          (data || []).map((p) => ({
            participant_id: p.participant_id,
            display_name: p.display_name,
            score: p.score,
            answered_count: p.answered_count,
            finished_at: p.finished_at,
            rank: Number(p.rank),
            total_response_ms: Number(p.total_response_ms),
          }))
        )
      }
    }
    load()
    const interval = setInterval(load, 3000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [isScored, sessionId])

  // How many participants have locked an answer for the currently open
  // question - a total only, so it never leaks the option split before
  // reveal. Stops polling once revealed (get_vote_counts takes over).
  const currentQuestionId = inQuestion ? questions[session?.current_question_index]?.id : null
  const clock = useQuestionClock(supabase, inQuestion ? questions[session.current_question_index] : null, isScored && !revealed)
  useEffect(() => {
    if (!isScored || !currentQuestionId || revealed) {
      setLockedCount(0)
      return
    }
    let cancelled = false
    const load = async () => {
      const { count } = await supabase
        .from('votes')
        .select('id', { count: 'exact', head: true })
        .eq('question_id', currentQuestionId)
      if (!cancelled) setLockedCount(count || 0)
    }
    load()
    const interval = setInterval(load, 3000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [isScored, currentQuestionId, revealed])

  // RLS turns an unauthorized UPDATE into "0 rows affected" rather than an
  // error, so check the returned rows - otherwise a non-owner's click would
  // look like it worked while no attendee moved.
  const updateSession = async (patch, baseSession = session) => {
    setAdvancing(true)
    setError(null)
    setSession({ ...baseSession, ...patch })

    const { data, error: updateError } = await supabase
      .from('sessions')
      .update(patch)
      .eq('id', sessionId)
      .select('id')

    if (updateError || !data?.length) {
      setSession(baseSession)
      setError(updateError?.message || 'Could not update the session. Only the session owner can present it.')
      setAdvancing(false)
      return false
    }
    setAdvancing(false)
    return true
  }

  const index = session?.current_question_index ?? -1
  const total = questions.length
  const isOwner = Boolean(userId && session && userId === session.owner_id)
  // Comments sessions have no results reveal step - each image is one Next.
  const showBetween = !isComments && session?.results_mode === 'live'
  const closed = Boolean(session?.scored_closed)
  const showLeaderboardStep = Boolean(session?.show_leaderboard)
  const canAdvance = isOwner && total > 0 && index < total && !advancing && !closed
  // In Live Results mode, a question's first Next reveals its results.
  const revealStep = showBetween && !revealed && index >= 0 && index < total

  // A scored quiz's reveal is a judged, scored action, not a plain column
  // flip - reveal_quiz_question() does the judging server-side.
  const revealQuestion = async () => {
    setAdvancing(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('reveal_quiz_question', { p_session_id: sessionId })
    if (rpcError) {
      setError(rpcError.message || 'Could not reveal this question.')
      setAdvancing(false)
      return false
    }
    setSession((prev) => (prev ? { ...prev, results_revealed: true, show_leaderboard: false } : prev))
    setAdvancing(false)
    return true
  }

  const goNext = async () => {
    if (!canAdvance) return

    // Host-paced quiz, on a real question: Reveal -> Leaderboard -> Next/End.
    if (isScored && index >= 0) {
      if (!revealed) {
        await revealQuestion()
      } else if (!showLeaderboardStep) {
        await updateSession({ show_leaderboard: true })
      } else if (index < total - 1) {
        await updateSession({ current_question_index: index + 1, results_revealed: false, show_leaderboard: false })
      } else {
        await updateSession({ scored_closed: true })
      }
      return
    }

    if (revealStep) await updateSession({ results_revealed: true })
    else await updateSession({ current_question_index: index + 1, results_revealed: false })
  }

  // Presentation clickers send PageDown / ArrowRight.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      if (['ArrowRight', 'PageDown'].includes(e.key)) {
        e.preventDefault()
        goNext()
      } else if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        toggleFullscreen()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const stopPresenting = async () => {
    if (await updateSession({ current_question_index: null, results_revealed: false })) {
      router.push(`/dashboard/sessions/${sessionId}`)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="inline-block h-10 w-10 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 text-center">
        <h1 className="font-display text-3xl font-bold text-foreground">Session not found</h1>
        <p className="mt-2 text-muted-foreground">{error || "This session doesn't exist or you don't have access to it."}</p>
        <Link href="/dashboard" className="mt-6 text-accent hover:underline">Back to dashboard</Link>
      </div>
    )
  }

  const voteUrl = `${getAppUrl()}/vote/${session.slug}`
  const currentQuestion = index >= 0 && index < total ? questions[index] : null
  const currentOptions = currentQuestion ? optionsByQuestion[currentQuestion.id] || [] : []
  const questionVotes = currentOptions.reduce((sum, o) => sum + (voteCounts[o.id] || 0), 0)
  const questionComments = currentQuestion ? commentCounts[currentQuestion.id] || 0 : 0
  const votesLabel = isComments
    ? `${questionComments} comment${questionComments !== 1 ? 's' : ''}`
    : isScored
      ? `${lockedCount} locked${clock.remainingSeconds === null ? '' : clock.timeUp ? " · Time's up" : ` · ${clock.remainingSeconds}s`}`
      : `${questionVotes} vote${questionVotes !== 1 ? 's' : ''}`

  const nextLabel =
    isScored && index >= 0
      ? (!revealed ? 'Reveal answer' : !showLeaderboardStep ? 'Show leaderboard' : index < total - 1 ? 'Next question' : 'End quiz')
      : index < 0
        ? (isComments ? 'Show first image' : isScored ? 'Start quiz' : 'Start first question')
        : revealStep
          ? 'Show results'
          : index < total - 1
            ? (isComments ? 'Next image' : 'Next question')
            : (isComments ? 'End session' : 'End poll')

  return (
    <SessionTheme theme={session.theme} className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="flex min-w-0 items-center gap-4">
        <SessionLogo theme={session.theme} className="h-10 shrink-0" />
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-bold text-foreground">{session.title}</p>
          <p className="text-sm text-muted-foreground">
            {isWheel
              ? 'Wheel of Fortune'
              : closed
              ? 'Quiz closed · Final results'
              : index < 0
                ? 'Waiting room'
                : index < total
                  ? isComments
                    ? `Image ${index + 1} of ${total}`
                    : isScored
                      ? `Question ${index + 1} of ${total}${showLeaderboardStep ? ' · Leaderboard' : revealed ? ' · Revealed' : ''}`
                      : `Question ${index + 1} of ${total}${revealed ? ' · Results' : ''}`
                  : isComments ? 'Session ended' : isScored ? 'Quiz complete' : 'Poll ended'}
          </p>
        </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canFullscreen && (
            <button
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)'}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {isFullscreen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
                )}
              </svg>
              {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            </button>
          )}
          <Link
            href={`/dashboard/sessions/${sessionId}`}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            Exit
          </Link>
        </div>
      </header>

      {(error || !session.is_active) && (
        <div className="mx-6 mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error || 'This session is inactive, so attendees cannot open it. Activate it in the session settings.'}
        </div>
      )}

      {/* Stage */}
      <main className="flex flex-1 items-center justify-center px-6 py-10">
        {isWheel ? (
          <WheelPresenter sessionId={sessionId} session={session} isOwner={isOwner} voteUrl={voteUrl} onError={setError} />
        ) : closed ? (
          <div className="text-center w-full max-w-4xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-accent">Final results</p>
            <h1 className="mt-3 font-display text-4xl font-bold text-foreground md:text-5xl">{session.title}</h1>
            <div className="mt-10">
              <Leaderboard entries={leaderboard} podium total={total} />
            </div>
          </div>
        ) : index < 0 ? (
          <div className="text-center">
            {session.theme?.logoUrl && (
              <div className="mb-8 flex justify-center">
                <SessionLogo theme={session.theme} className="h-20 md:h-24" />
              </div>
            )}
            <p className="text-sm font-semibold uppercase tracking-widest text-accent">Scan to join</p>
            <h1 className="mt-3 font-display text-4xl font-bold text-foreground md:text-6xl">{session.title}</h1>
            <div className="mt-10 inline-block rounded-2xl bg-white p-6 shadow-2xl">
              <QRCodeSVG value={voteUrl} size={300} level="H" bgColor="#ffffff" fgColor="#000000" />
            </div>
            <p className="mt-6 break-all font-mono text-base text-muted-foreground md:text-lg">{voteUrl}</p>
            {total === 0 && (
              <p className="mt-6 text-destructive">Add questions to this session before presenting.</p>
            )}
            {identified && (
              <div className="mt-8">
                <p className="text-base font-medium text-foreground">
                  {participantCount} {participantCount === 1 ? 'participant' : 'participants'} joined
                </p>
                {isOwner && participantNames.length > 0 && (
                  <div className="mx-auto mt-4 flex max-w-3xl flex-wrap justify-center gap-2">
                    {participantNames.map((name, i) => (
                      <span
                        key={`${name}-${i}`}
                        className="rounded-full border border-border bg-card px-3 py-1 text-sm text-foreground"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : currentQuestion && isComments ? (
          <div className="grid w-full max-w-6xl gap-8 lg:grid-cols-[3fr_2fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-widest text-accent">
                Image {index + 1} of {total}
              </p>
              <h1 className="mt-4 font-display text-3xl font-bold leading-tight text-foreground md:text-4xl">
                {currentQuestion.text}
              </h1>
              <img
                src={currentQuestion.image_url}
                alt=""
                className="mt-6 max-h-[28rem] w-full rounded-2xl border border-border object-contain bg-card"
              />
              <div className="mt-6 flex justify-center">
                <span className="inline-flex items-center gap-3 rounded-full border border-border bg-card px-6 py-3 text-2xl font-semibold text-foreground">
                  <span className="relative flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-primary"></span>
                  </span>
                  {votesLabel}
                </span>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6">
              <h2 className="font-display mb-4 text-xl font-bold text-foreground">Comments</h2>
              {commentWall.length === 0 ? (
                <p className="text-muted-foreground">Waiting for the first comment…</p>
              ) : (
                <ul className="max-h-[28rem] space-y-3 overflow-y-auto">
                  {commentWall.map((c) => (
                    <li key={c.comment_id} className="rounded-lg bg-muted p-3">
                      <p className="text-sm font-medium text-accent">{c.author_name}</p>
                      <p className="mt-1 text-sm text-foreground">{c.comment_body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : currentQuestion && isScored ? (
          <div className="w-full max-w-4xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-accent">
              Question {index + 1} of {total}
            </p>
            <h1 className="mt-4 font-display text-4xl font-bold leading-tight text-foreground md:text-5xl">
              {currentQuestion.text}
            </h1>

            {showLeaderboardStep ? (
              <div className="mt-10 rounded-2xl border border-border bg-card p-6">
                <h2 className="font-display mb-4 text-2xl font-bold text-foreground">Leaderboard</h2>
                <Leaderboard entries={leaderboard} total={total} />
              </div>
            ) : (
              <div className="mt-10 grid gap-4 sm:grid-cols-2">
                {currentOptions.map((option, i) => {
                  const isCorrectOption = revealed && correctOptionByQuestion[currentQuestion.id] === option.id
                  return (
                    <div
                      key={option.id}
                      className={`flex items-center rounded-xl border px-6 py-5 text-xl ${
                        isCorrectOption
                          ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
                          : 'border-border bg-card text-foreground'
                      }`}
                    >
                      <span className="mr-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-accent">
                        {String.fromCharCode(65 + i)}
                      </span>
                      {option.text}
                      {revealed && (
                        <span className="ml-auto text-base font-semibold text-muted-foreground">
                          {voteCounts[option.id] || 0}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {!revealed && !showLeaderboardStep && (
              <div className="mt-10 flex justify-center">
                <span className="inline-flex items-center gap-3 rounded-full border border-border bg-card px-6 py-3 text-2xl font-semibold text-foreground">
                  <span className="relative flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-primary"></span>
                  </span>
                  {votesLabel}
                </span>
              </div>
            )}
          </div>
        ) : currentQuestion ? (
          <div className="w-full max-w-5xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-accent">
              Question {index + 1} of {total}
            </p>
            <h1 className="mt-4 font-display text-4xl font-bold leading-tight text-foreground md:text-5xl">
              {currentQuestion.text}
            </h1>
            {revealed ? (
              <div className="mt-10">
                <ResultsChart options={currentOptions} voteCounts={voteCounts} live={false} />
              </div>
            ) : (
              <div className="mt-10 grid gap-4 sm:grid-cols-2">
                {currentOptions.map((option, i) => (
                  <div
                    key={option.id}
                    className="flex items-center rounded-xl border border-border bg-card px-6 py-5 text-xl text-foreground"
                  >
                    <span className="mr-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-accent">
                      {String.fromCharCode(65 + i)}
                    </span>
                    {option.text}
                  </div>
                ))}
              </div>
            )}
            {!revealed && (
              <div className="mt-10 flex justify-center">
                <span className="inline-flex items-center gap-3 rounded-full border border-border bg-card px-6 py-3 text-2xl font-semibold text-foreground">
                  <span className="relative flex h-3 w-3">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-primary"></span>
                  </span>
                  {votesLabel}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center">
            <h1 className="font-display text-4xl font-bold text-foreground md:text-6xl">
              {isComments ? 'Thanks for commenting!' : isScored ? 'Quiz complete!' : 'Thanks for voting!'}
            </h1>
            <p className="mt-4 text-lg text-muted-foreground">
              {isComments ? 'The session has ended.' : isScored ? 'Close the quiz to show final results.' : 'Attendees are now seeing the results.'}
            </p>
            {isOwner && (
              <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href={`/dashboard/sessions/${sessionId}/results`}
                  className="rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 font-semibold text-white hover:opacity-90 transition-opacity"
                >
                  {isComments ? 'View comments' : 'View full results'}
                </Link>
                <button
                  onClick={() => updateSession({ current_question_index: -1, results_revealed: false })}
                  disabled={advancing}
                  className="rounded-lg border border-border px-6 py-3 font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  Restart
                </button>
                <button
                  onClick={stopPresenting}
                  disabled={advancing}
                  className="rounded-lg border border-border px-6 py-3 font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  Stop presenting
                </button>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Controls - the session owner only */}
      {isWheel ? null : closed ? (
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-6 py-4">
          <p className="text-sm text-muted-foreground">Quiz closed · final results shown</p>
          {isOwner ? (
            <button
              onClick={() => updateSession({ scored_closed: false })}
              disabled={advancing}
              className="rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Reopen quiz
            </button>
          ) : (
            <p className="text-sm text-muted-foreground">Only the session owner can control this presentation.</p>
          )}
        </footer>
      ) : index < total && (
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-6 py-4">
          {isOwner ? (
            <>
              <p className="text-sm text-muted-foreground">
                {isComments
                  ? 'Attendees comment on the open image only'
                  : isScored
                    ? 'Host-paced: lock, reveal, then leaderboard'
                    : showBetween ? 'Live results: shown after each question' : 'Results shown after the last question'}
                {' · '}
                <Link href={`/dashboard/sessions/${sessionId}`} className="text-accent hover:underline">
                  Change
                </Link>
              </p>
              <div className="flex items-center gap-4">
              {currentQuestion && !(isScored && showLeaderboardStep) && (
                <span className="text-sm font-medium text-muted-foreground">{votesLabel}</span>
              )}
              <button
                onClick={goNext}
                disabled={!canAdvance}
                className="inline-flex items-center rounded-lg bg-gradient-to-r from-primary to-accent px-8 py-4 text-lg font-semibold text-white shadow-lg hover:opacity-90 transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              >
                {advancing ? 'Updating…' : nextLabel}
                <svg className="ml-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
              </div>
            </>
          ) : (
            <p className="ml-auto text-sm text-muted-foreground">Only the session owner can control this presentation.</p>
          )}
        </footer>
      )}
    </SessionTheme>
  )
}
