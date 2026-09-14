'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { QRCodeSVG } from 'qrcode.react'
import { createClient } from '@/lib/supabase/client'
import ResultsChart from '@/components/ResultsChart'
import { getAppUrl } from '@/lib/utils'
import SessionTheme from '@/components/SessionTheme'
import SessionLogo from '@/components/SessionLogo'

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

        if (cancelled) return
        setUserId(user?.id ?? null)
        setSession(sessionData)
        setQuestions(questionsData || [])
        setOptionsByQuestion(optionsMap)

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
  const showBetween = session?.results_mode === 'live'
  const canAdvance = isOwner && total > 0 && index < total && !advancing
  // In Live Results mode, a question's first Next reveals its results.
  const revealStep = showBetween && !revealed && index >= 0 && index < total

  const goNext = () => {
    if (!canAdvance) return
    if (revealStep) updateSession({ results_revealed: true })
    else updateSession({ current_question_index: index + 1, results_revealed: false })
  }

  // Presentation clickers send PageDown / ArrowRight.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      if (['ArrowRight', 'PageDown'].includes(e.key)) {
        e.preventDefault()
        goNext()
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
  const votesLabel = `${questionVotes} vote${questionVotes !== 1 ? 's' : ''}`

  const nextLabel =
    index < 0
      ? 'Start first question'
      : revealStep
        ? 'Show results'
        : index < total - 1
          ? 'Next question'
          : 'End poll'

  return (
    <SessionTheme theme={session.theme} className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="flex min-w-0 items-center gap-4">
        <SessionLogo theme={session.theme} className="h-10 shrink-0" />
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-bold text-foreground">{session.title}</p>
          <p className="text-sm text-muted-foreground">
            {index < 0
              ? 'Waiting room'
              : index < total
                ? `Question ${index + 1} of ${total}${revealed ? ' · Results' : ''}`
                : 'Poll ended'}
          </p>
        </div>
        </div>
        <Link
          href={`/dashboard/sessions/${sessionId}`}
          className="shrink-0 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
        >
          Exit
        </Link>
      </header>

      {(error || !session.is_active) && (
        <div className="mx-6 mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error || 'This session is inactive, so attendees cannot open it. Activate it in the session settings.'}
        </div>
      )}

      {/* Stage */}
      <main className="flex flex-1 items-center justify-center px-6 py-10">
        {index < 0 ? (
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
            <h1 className="font-display text-4xl font-bold text-foreground md:text-6xl">Thanks for voting!</h1>
            <p className="mt-4 text-lg text-muted-foreground">Attendees are now seeing the results.</p>
            {isOwner && (
              <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href={`/dashboard/sessions/${sessionId}/results`}
                  className="rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 font-semibold text-white hover:opacity-90 transition-opacity"
                >
                  View full results
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
      {index < total && (
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-6 py-4">
          {isOwner ? (
            <>
              <p className="text-sm text-muted-foreground">
                {showBetween ? 'Live results: shown after each question' : 'Results shown after the last question'}
                {' · '}
                <Link href={`/dashboard/sessions/${sessionId}`} className="text-accent hover:underline">
                  Change
                </Link>
              </p>
              <div className="flex items-center gap-4">
              {currentQuestion && (
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
