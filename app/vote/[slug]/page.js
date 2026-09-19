'use client'

import { useState, useEffect, useRef } from 'react'
import SessionTheme from '@/components/SessionTheme'
import SessionLogo from '@/components/SessionLogo'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PollQuestion from '@/components/PollQuestion'
import ResultsChart from '@/components/ResultsChart'
import JoinGate from '@/components/JoinGate'
import { generateVoterToken } from '@/lib/utils'

const RESULTS_MODE_LABELS = { live: 'Live results', after_all: 'After all questions' }

export default function VotingPage() {
  const params = useParams()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [questions, setQuestions] = useState([])
  const [optionsByQuestion, setOptionsByQuestion] = useState({})
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [votes, setVotes] = useState({}) // {questionId: optionId}
  const [voteCounts, setVoteCounts] = useState({}) // {optionId: count}
  const [voteError, setVoteError] = useState(null)
  const [voterToken, setVoterToken] = useState(null)
  const [submittingVote, setSubmittingVote] = useState(false)
  const [showResults, setShowResults] = useState(false)
  // Identified sessions: { id, name, external_id, join_token } from localStorage.
  const [participant, setParticipant] = useState(null)
  const [identityReady, setIdentityReady] = useState(false)
  // Scored quizzes.
  const [quizState, setQuizState] = useState(null)
  const [nowTick, setNowTick] = useState(Date.now())
  const [standing, setStanding] = useState(null)
  const [lastAward, setLastAward] = useState(null)
  const [timeUp, setTimeUp] = useState(false)
  const [review, setReview] = useState(null)
  // Image & comments sessions: { [questionId]: [{comment_id, comment_body, author_name, comment_created_at}] }.
  const [comments, setComments] = useState({})
  const [commentDraft, setCommentDraft] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [commentError, setCommentError] = useState(null)
  const supabase = createClient()

  const isScored = Boolean(session?.is_scored && session?.participation_mode === 'identified')
  const isComments = session?.session_type === 'comments'

  const slug = params.slug

  useEffect(() => {
    if (slug) {
      loadSession()
      loadVoterToken()
    }
  }, [slug])

  // Host-driven mode: the organizer's presenter screen (/present/[sessionId])
  // sets sessions.current_question_index and every attendee follows it.
  //   NULL = self-paced, -1 = lobby, 0..n-1 = question, n = finished
  const hostIndex = session?.current_question_index ?? null
  const hostMode = hostIndex !== null

  // Follow the host.
  useEffect(() => {
    if (!hostMode || questions.length === 0) return
    if (hostIndex >= questions.length) {
      setShowResults(true)
      if (session?.id) loadVoteCounts(session.id)
    } else {
      setShowResults(false)
      if (hostIndex >= 0) setCurrentQuestionIndex(hostIndex)
    }
  }, [hostMode, hostIndex, questions.length])

  // Image & comments sessions: reload this attendee's own comments whenever
  // the current image changes (host-driven or self-paced).
  const commentsQuestionId = isComments
    ? (hostMode
        ? (hostIndex >= 0 && hostIndex < questions.length ? questions[hostIndex]?.id : null)
        : questions[currentQuestionIndex]?.id)
    : null
  useEffect(() => {
    if (!isComments || !participant || !commentsQuestionId) return
    loadOwnComments(commentsQuestionId)
  }, [isComments, participant, commentsQuestionId])

  // The host revealed this question's results: fetch the latest counts now
  // rather than waiting for the next poll. PollQuestion then shows results
  // and disables its options, which closes voting on this device.
  const resultsRevealed = hostMode && Boolean(session?.results_revealed)
  useEffect(() => {
    if (resultsRevealed && session?.id) loadVoteCounts(session.id)
  }, [resultsRevealed])

  // The presenter's Next arrives as a Realtime UPDATE on this session row.
  // A slow poll backs it up: venue Wi-Fi drops websockets, and a missed event
  // would otherwise strand a phone on an old question until reload. Counts are
  // only refreshed while results are on screen - voters never see live counts.
  const sessionRowId = session?.id
  // Live Results = a results page after each question; After All = one summary
  // at the end. Self-paced voters in Live mode see a question's results as
  // soon as they have voted on it.
  const perQuestionResults = session?.results_mode === 'live'
  const votedCurrent = Boolean(votes[questions[currentQuestionIndex]?.id])
  const questionResultsShown = hostMode ? resultsRevealed : perQuestionResults && votedCurrent
  const resultsVisibleRef = useRef(false)
  resultsVisibleRef.current = showResults || questionResultsShown
  useEffect(() => {
    if (!sessionRowId) return

    const channel = supabase
      .channel(`vote-${sessionRowId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionRowId}` },
        (payload) => setSession((prev) => (prev ? { ...prev, ...payload.new } : prev))
      )
      .subscribe()

    const refresh = async () => {
      const { data } = await supabase
        .from('sessions')
        .select('current_question_index, results_revealed, theme, scored_closed, is_scored')
        .eq('id', sessionRowId)
        .maybeSingle()
      if (data) setSession((prev) => (prev ? { ...prev, ...data } : prev))
      if (resultsVisibleRef.current) loadVoteCounts(sessionRowId)
    }
    const interval = setInterval(refresh, 8000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [sessionRowId])

  // Scored sessions: resume the stopwatch if this device already started, and
  // fetch the participant's own standing.
  useEffect(() => {
    if (!isScored || !participant) return
    let started = false
    try {
      started = localStorage.getItem(`quiz_started_${slug}`) === '1'
    } catch { /* ignore */ }

    const load = async () => {
      if (started && !quizState) {
        const { data, error } = await supabase.rpc('start_scored_session', {
          p_join_token: participant.join_token
        })
        if (!error && data?.[0]) {
          setQuizState({ started_at: data[0].started_at, deadline: data[0].deadline })
        }
      }
      await loadStanding(participant.join_token)
    }
    load()
  }, [isScored, participant, slug])

  // Countdown ticker for a timed quiz.
  useEffect(() => {
    if (!quizState?.deadline) return
    const timer = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [quizState?.deadline])

  // Keep the participant's own rank current without a public leaderboard feed.
  useEffect(() => {
    if (!isScored || !participant) return
    const timer = setInterval(() => loadStanding(participant.join_token), 5000)
    return () => clearInterval(timer)
  }, [isScored, participant])

  // Resume at the first unanswered question once, after standings load.
  const resumedRef = useRef(false)
  useEffect(() => {
    if (!isScored || resumedRef.current) return
    if (typeof standing?.answered_count === 'number' && questions.length > 0) {
      resumedRef.current = true
      setCurrentQuestionIndex(Math.min(standing.answered_count, questions.length - 1))
    }
  }, [isScored, standing?.answered_count, questions.length])

  // Correct answers are released only when the host closes the quiz.
  useEffect(() => {
    if (!isScored || !participant || !session?.scored_closed) return
    let cancelled = false
    const load = async () => {
      const { data, error } = await supabase.rpc('get_quiz_review', {
        p_join_token: participant.join_token
      })
      if (!error && !cancelled) setReview(data || [])
    }
    load()
    return () => { cancelled = true }
  }, [isScored, participant, session?.scored_closed])

  const loadSession = async () => {
    try {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('slug', slug)
        .eq('is_active', true)
        .single()

      if (error) throw error
      setSession(data)

      // Identified sessions resume a stored participant (and their answers)
      // before the join gate renders.
      if (data.participation_mode === 'identified') {
        await restoreParticipant()
      }

      // Load questions and options
      await loadQuestionsAndOptions(data.id)
      await loadVoteCounts(data.id)
    } catch (error) {
      console.error('Error loading session:', error)
      // Session might not exist or be inactive
    } finally {
      setIdentityReady(true)
      setLoading(false)
    }
  }

  const restoreParticipant = async () => {
    try {
      const stored = localStorage.getItem(`participant_${slug}`)
      if (!stored) return
      const parsed = JSON.parse(stored)
      if (!parsed?.join_token) return
      setParticipant(parsed)
      await restoreAnswers(parsed.join_token)
    } catch (error) {
      console.error('Error restoring participant:', error)
    }
  }

  const restoreAnswers = async (joinToken) => {
    try {
      const { data, error } = await supabase.rpc('get_participant_answers', {
        p_join_token: joinToken
      })
      if (error) throw error
      const restored = {}
      for (const row of data || []) {
        restored[row.answer_question_id] = row.answer_option_id
      }
      setVotes(restored)
    } catch (error) {
      console.error('Error restoring answers:', error)
    }
  }

  const handleJoined = async (joined) => {
    try {
      localStorage.setItem(`participant_${slug}`, JSON.stringify(joined))
      // A new identity starts fresh: don't inherit the previous player's clock.
      localStorage.removeItem(`quiz_started_${slug}`)
    } catch (error) {
      console.error('Error saving participant:', error)
    }
    setParticipant(joined)
    setQuizState(null)
    setStanding(null)
    setLastAward(null)
    setTimeUp(false)
    setReview(null)
    resumedRef.current = false
    await restoreAnswers(joined.join_token)
  }

  const switchParticipant = () => {
    try {
      localStorage.removeItem(`participant_${slug}`)
      localStorage.removeItem(`quiz_started_${slug}`)
    } catch (error) {
      console.error('Error clearing participant:', error)
    }
    setParticipant(null)
    setVotes({})
    setQuizState(null)
    setStanding(null)
    setLastAward(null)
    setTimeUp(false)
    setReview(null)
    resumedRef.current = false
  }

  const loadQuestionsAndOptions = async (sessionId) => {
    try {
      // Try to load questions
      const { data: questionsData, error: questionsError } = await supabase
        .from('questions')
        .select('*')
        .eq('session_id', sessionId)
        .order('order_index')

      if (questionsError && !questionsError.message.includes('does not exist')) {
        throw questionsError
      }

      const loadedQuestions = questionsData || []

      // Load options for each question
      const optionsMap = {}
      for (const question of loadedQuestions) {
        const { data: optionsData, error: optionsError } = await supabase
          .from('options')
          .select('*')
          .eq('question_id', question.id)
          .order('order_index')

        if (!optionsError) {
          optionsMap[question.id] = optionsData || []
        }
      }

      setQuestions(loadedQuestions)
      setOptionsByQuestion(optionsMap)
    } catch (error) {
      console.error('Error loading questions:', error)
      // Tables might not exist yet - use sample data
      setQuestions(getSampleQuestions(sessionId))
      setOptionsByQuestion(getSampleOptions())
    }
  }

  const loadVoterToken = () => {
    try {
      const storedToken = localStorage.getItem(`voter_token_${slug}`)
      if (storedToken) {
        setVoterToken(storedToken)
      } else {
        const newToken = generateVoterToken()
        localStorage.setItem(`voter_token_${slug}`, newToken)
        setVoterToken(newToken)
      }
    } catch (error) {
      console.error('Error accessing localStorage:', error)
      // Generate a fallback token
      const fallbackToken = `voter_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      setVoterToken(fallbackToken)
    }
  }

  // Aggregate counts come from a SECURITY DEFINER function: the votes table
  // itself is not readable by attendees, since it holds voter_token and would
  // let anyone correlate an individual voter's choices across questions.
  const loadVoteCounts = async (sessionId) => {
    try {
      const { data, error } = await supabase.rpc('get_vote_counts', {
        p_session_id: sessionId
      })
      if (error) throw error

      const counts = {}
      for (const row of data || []) {
        counts[row.opt_id] = Number(row.vote_total) || 0
      }
      setVoteCounts(counts)
    } catch (error) {
      console.error('Error loading vote counts:', error)
    }
  }

  const loadStanding = async (joinToken) => {
    try {
      const { data, error } = await supabase.rpc('get_participant_standing', {
        p_join_token: joinToken
      })
      if (!error && data?.[0]) setStanding(data[0])
    } catch (error) {
      console.error('Error loading standing:', error)
    }
  }

  const beginQuiz = async () => {
    if (!participant) return
    setVoteError(null)
    try {
      const { data, error } = await supabase.rpc('start_scored_session', {
        p_join_token: participant.join_token
      })
      if (error) throw error
      const row = data?.[0]
      if (row) setQuizState({ started_at: row.started_at, deadline: row.deadline })
      try {
        localStorage.setItem(`quiz_started_${slug}`, '1')
      } catch { /* ignore */ }
      await loadStanding(participant.join_token)
    } catch (error) {
      console.error('Error starting quiz:', error)
      setVoteError(error.message || 'Could not start the quiz. Please try again.')
    }
  }

  // Attendees only ever see their own comments, via the join-token-scoped
  // get_own_comments - get_comments (every comment, attributed by name) is
  // owner-only, so another attendee's text is never fetched to this device.
  const loadOwnComments = async (questionId) => {
    if (!participant || !questionId) return
    try {
      const { data, error } = await supabase.rpc('get_own_comments', {
        p_join_token: participant.join_token,
        p_question_id: questionId,
      })
      if (error) throw error
      setComments((prev) => ({ ...prev, [questionId]: data || [] }))
    } catch (error) {
      console.error('Error loading comments:', error)
    }
  }

  const submitComment = async (questionId) => {
    if (!participant || !questionId) return
    const body = commentDraft.trim()
    if (!body) return
    setSubmittingComment(true)
    setCommentError(null)
    try {
      const { error } = await supabase.rpc('submit_comment', {
        p_join_token: participant.join_token,
        p_question_id: questionId,
        p_body: body,
      })
      if (error) throw error
      setCommentDraft('')
      await loadOwnComments(questionId)
    } catch (error) {
      console.error('Error submitting comment:', error)
      setCommentError(error.message || 'Could not send your comment. Please try again.')
    } finally {
      setSubmittingComment(false)
    }
  }

  const handleVote = async (optionId) => {
    const identified = session?.participation_mode === 'identified'
    if (!session || (identified ? !participant : !voterToken)) return

    const currentQuestion = questions[currentQuestionIndex]
    if (!currentQuestion) return

    setSubmittingVote(true)
    setVoteError(null)

    try {
      if (identified) {
        // Validated server-side against the join token; a repeat on the same
        // question returns the existing choice instead of erroring.
        const { data, error } = await supabase.rpc('submit_identified_vote', {
          p_join_token: participant.join_token,
          p_question_id: currentQuestion.id,
          p_option_id: optionId
        })
        if (error) throw error
        const row = data?.[0]
        const recorded = row?.recorded_option_id || optionId
        setVotes(prev => ({
          ...prev,
          [currentQuestion.id]: recorded
        }))

        if (isScored && row) {
          setLastAward({ questionId: currentQuestion.id, points: row.awarded_points || 0 })
          setStanding((prev) => ({
            ...(prev || {}),
            total_score: row.total_score,
            answered_count: row.answered_count,
            finished_at: row.finished_at,
          }))
          if (row.time_up) setTimeUp(true)
        }
      } else {
        const { error } = await supabase.from('votes').insert({
          option_id: optionId,
          question_id: currentQuestion.id,
          voter_token: voterToken
        })

        // 23505 = unique(question_id, voter_token): this browser already voted on
        // this question. Treat as success so the UI reflects the existing vote.
        if (error && error.code !== '23505') throw error

        setVotes(prev => ({
          ...prev,
          [currentQuestion.id]: optionId
        }))
      }

      // Scored quizzes never show live vote counts and never auto-advance.
      if (isScored) return

      // In host mode the presenter decides when to move on. Self-paced Live
      // voters stay put to see this question's results; After All voters
      // advance straight away and see results after the last question.
      if (!hostMode && perQuestionResults) {
        await loadVoteCounts(session.id)
      } else if (!hostMode) {
        if (currentQuestionIndex < questions.length - 1) {
          setCurrentQuestionIndex(prev => prev + 1)
        } else {
          await loadVoteCounts(session.id)
          setShowResults(true)
        }
      }
    } catch (error) {
      console.error('Error submitting vote:', error)
      setVoteError(error.message || 'Could not record your vote. Please try again.')
    } finally {
      setSubmittingVote(false)
    }
  }

  const nextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1)
      setShowResults(false)
    } else {
      // Last question - show final results
      if (session?.id) loadVoteCounts(session.id)
      setShowResults(true)
    }
  }

  const prevQuestion = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1)
      setShowResults(false)
    }
  }

  const getSampleQuestions = (sessionId) => {
    return [
      {
        id: 'sample_q1',
        session_id: sessionId,
        text: "How would you rate today's event?",
        order_index: 0,
        created_at: new Date().toISOString()
      },
      {
        id: 'sample_q2',
        session_id: sessionId,
        text: "What topic interests you most for future sessions?",
        order_index: 1,
        created_at: new Date().toISOString()
      }
    ]
  }

  const getSampleOptions = () => {
    return {
      'sample_q1': [
        { id: 'sample_o1', question_id: 'sample_q1', text: 'Excellent', order_index: 0 },
        { id: 'sample_o2', question_id: 'sample_q1', text: 'Good', order_index: 1 },
        { id: 'sample_o3', question_id: 'sample_q1', text: 'Average', order_index: 2 },
        { id: 'sample_o4', question_id: 'sample_q1', text: 'Needs improvement', order_index: 3 }
      ],
      'sample_q2': [
        { id: 'sample_o5', question_id: 'sample_q2', text: 'AI & Machine Learning', order_index: 0 },
        { id: 'sample_o6', question_id: 'sample_q2', text: 'Web Development', order_index: 1 },
        { id: 'sample_o7', question_id: 'sample_q2', text: 'Mobile Apps', order_index: 2 },
        { id: 'sample_o8', question_id: 'sample_q2', text: 'DevOps & Cloud', order_index: 3 }
      ]
    }
  }

  const getCurrentQuestion = () => {
    return questions[currentQuestionIndex]
  }

  const getCurrentOptions = () => {
    const question = getCurrentQuestion()
    if (!question) return []
    return optionsByQuestion[question.id] || []
  }

  const getResultsData = () => {
    const question = getCurrentQuestion()
    if (!question) return null

    const options = getCurrentOptions()
    const optionVotes = {}
    let totalVotes = 0
    let leadingOptionId = null
    let maxVotes = 0

    // Real counts, loaded via the get_vote_counts RPC after each vote.
    options.forEach(option => {
      const count = voteCounts[option.id] || 0
      optionVotes[option.id] = count
      totalVotes += count
      if (count > maxVotes) {
        maxVotes = count
        leadingOptionId = option.id
      }
    })

    return {
      optionVotes,
      totalVotes,
      leadingOptionId
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted">
        <div className="container mx-auto px-4 py-16 text-center">
          <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
          <h1 className="font-display mt-6 text-2xl font-bold text-foreground">Loading poll...</h1>
          <p className="mt-2 text-muted-foreground">Please wait while we prepare your voting experience.</p>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-muted">
        <div className="container mx-auto px-4 py-16 text-center">
          <h1 className="font-display text-3xl font-bold text-foreground">Poll Not Found</h1>
          <p className="mt-2 text-muted-foreground max-w-md mx-auto">
            This poll session is no longer available. It may have ended or been removed by the organizer.
          </p>
          <div className="mt-8">
            <a href="/" className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity">
              Return to Home
            </a>
          </div>
        </div>
      </div>
    )
  }

  const identified = session.participation_mode === 'identified'

  // Identified sessions need an identity before any voting UI renders. The
  // identityReady guard avoids flashing the gate while a stored participant is
  // being restored.
  if (identified && identityReady && !participant) {
    return (
      <SessionTheme theme={session.theme} className="min-h-screen bg-gradient-to-br from-background to-muted">
        <main className="container mx-auto px-4">
          <JoinGate session={session} onJoined={handleJoined} />
        </main>
      </SessionTheme>
    )
  }

  // Scored quizzes get their own self-paced surface: a start gate, a
  // countdown, live personal score/rank, and an end screen with a review.
  if (isScored) {
    const remaining = quizState?.deadline
      ? Math.max(0, Math.floor((new Date(quizState.deadline).getTime() - nowTick) / 1000))
      : null
    const timeExpired = remaining === 0
    const totalQuestions = questions.length
    const answeredCount = standing?.answered_count ?? 0
    const finished = Boolean(standing?.finished_at)
    const done = finished || timeUp || timeExpired || (totalQuestions > 0 && answeredCount >= totalQuestions)
    const closed = Boolean(session.scored_closed)
    const scoredQuestion = questions[currentQuestionIndex]
    const scoredOptions = scoredQuestion ? (optionsByQuestion[scoredQuestion.id] || []) : []
    const elapsed = quizState?.started_at && standing?.finished_at
      ? Math.max(0, Math.round((new Date(standing.finished_at).getTime() - new Date(quizState.started_at).getTime()) / 1000))
      : null
    const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

    return (
      <SessionTheme theme={session.theme} className="min-h-screen bg-gradient-to-br from-background to-muted">
        <header className="border-b border-border bg-card">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-4">
                <SessionLogo theme={session.theme} className="h-10 shrink-0" />
                <div className="min-w-0">
                  <h1 className="font-display truncate text-xl font-bold text-foreground">{session.title}</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {participant?.name || participant?.external_id || 'Player'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="rounded-full bg-muted px-3 py-1 text-sm text-foreground">
                  {standing?.total_score ?? 0} pts
                </div>
                {standing?.participant_rank && (
                  <div className="rounded-full bg-primary/15 px-3 py-1 text-sm font-medium text-accent">
                    #{standing.participant_rank}
                  </div>
                )}
                {remaining != null && !done && (
                  <div className={`rounded-full px-3 py-1 font-mono text-sm ${
                    remaining <= 30 ? 'bg-destructive/15 text-destructive' : 'bg-muted text-foreground'
                  }`}>
                    {fmt(remaining)}
                  </div>
                )}
                <button onClick={switchParticipant} className="text-sm font-medium text-accent hover:underline">
                  Switch
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-8">
          {done || closed ? (
            <div className="mx-auto max-w-2xl py-6">
              <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
                <p className="text-sm font-semibold uppercase tracking-widest text-accent">
                  {timeUp || timeExpired ? "Time's up" : finished ? 'Quiz complete' : 'Quiz closed'}
                </p>
                <h1 className="font-display mt-3 text-4xl font-bold text-foreground">
                  {standing?.total_score ?? 0} points
                </h1>
                <p className="mt-2 text-muted-foreground">
                  {standing?.participant_rank
                    ? `Rank #${standing.participant_rank} of ${standing.total_participants}`
                    : ''}
                  {elapsed != null ? ` • ${fmt(elapsed)}` : ''}
                </p>
                <p className="mt-4 text-sm text-muted-foreground">
                  {closed
                    ? 'The host has closed the quiz.'
                    : 'Waiting for the host to close the quiz and reveal the correct answers.'}
                </p>
              </div>

              {closed && review && review.length > 0 && (
                <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-lg">
                  <h2 className="font-display mb-4 text-xl font-bold text-foreground">Review</h2>
                  <div className="space-y-4">
                    {review.map((r, i) => (
                      <div key={r.review_question_id} className="rounded-lg border border-border p-4">
                        <p className="font-medium text-foreground">Q{i + 1}: {r.review_question_text}</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Your answer: {r.chosen_option_text || '—'}
                        </p>
                        <p className={`mt-1 text-sm font-medium ${
                          r.chosen_option_id && r.chosen_option_id === r.correct_option_id
                            ? 'text-emerald-300'
                            : 'text-destructive'
                        }`}>
                          Correct: {r.correct_option_text || '—'} • {r.review_awarded_points ?? 0} pts
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : !quizState ? (
            <div className="mx-auto max-w-xl py-10">
              <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-lg">
                <p className="text-sm font-semibold uppercase tracking-widest text-accent">Scored quiz</p>
                <h1 className="font-display mt-3 text-3xl font-bold text-foreground">{session.title}</h1>
                <p className="mt-2 text-muted-foreground">
                  Hi {participant?.name || participant?.external_id}. Ready to play?
                </p>
                <dl className="mt-6 grid grid-cols-2 gap-4 text-left text-sm">
                  <div className="rounded-lg bg-muted p-4">
                    <dt className="text-muted-foreground">Questions</dt>
                    <dd className="mt-1 text-2xl font-bold text-foreground">{totalQuestions}</dd>
                  </div>
                  <div className="rounded-lg bg-muted p-4">
                    <dt className="text-muted-foreground">Time limit</dt>
                    <dd className="mt-1 text-2xl font-bold text-foreground">
                      {session.score_time_limit_seconds
                        ? `${Math.round(session.score_time_limit_seconds / 60)} min`
                        : 'None'}
                    </dd>
                  </div>
                </dl>
                <p className="mt-6 text-sm text-muted-foreground">
                  Your clock starts when you press Start. Points grow with each question; only your first
                  answer counts. Correct answers are revealed when the host closes the quiz.
                </p>
                {voteError && (
                  <p className="mt-4 text-sm font-medium text-destructive">{voteError}</p>
                )}
                <button
                  onClick={beginQuiz}
                  className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-base font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                >
                  Start quiz
                </button>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl">
              {totalQuestions > 1 && (
                <div className="mb-6">
                  <div className="mb-2 flex justify-between text-sm text-muted-foreground">
                    <span>Question {currentQuestionIndex + 1} of {totalQuestions}</span>
                    <span>{answeredCount} answered</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
                      style={{ width: `${(answeredCount / totalQuestions) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {lastAward && lastAward.questionId === scoredQuestion?.id && (
                <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-300">
                  +{lastAward.points} point{lastAward.points !== 1 ? 's' : ''}
                </div>
              )}

              {scoredQuestion ? (
                <PollQuestion
                  question={scoredQuestion}
                  options={scoredOptions}
                  onVote={handleVote}
                  loading={submittingVote}
                  selectedOptionId={votes[scoredQuestion.id]}
                  showResults={false}
                  resultsData={null}
                  voterName={participant?.name || participant?.external_id || null}
                  lockAfterVote
                />
              ) : (
                <p className="text-center text-muted-foreground">No questions yet.</p>
              )}

              <div className="mt-6 flex justify-end">
                {scoredQuestion && currentQuestionIndex < totalQuestions - 1 && (
                  <button
                    onClick={() => setCurrentQuestionIndex((i) => i + 1)}
                    disabled={!votes[scoredQuestion.id] || submittingVote}
                    className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-base font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next question
                  </button>
                )}
              </div>
            </div>
          )}
        </main>
      </SessionTheme>
    )
  }

  // Image & comments sessions get their own surface: an image + prompt, and a
  // free-text box that sends through submit_comment. No options, no vote
  // counts - the comment wall itself lives on the presenter screen.
  if (isComments) {
    const commentsTotalQuestions = questions.length
    const inLobby = hostMode && hostIndex < 0
    const hostFinished = hostMode && hostIndex >= commentsTotalQuestions
    const commentsQuestion = hostMode
      ? (hostIndex >= 0 && hostIndex < commentsTotalQuestions ? questions[hostIndex] : null)
      : questions[currentQuestionIndex]
    const ownComments = commentsQuestion ? (comments[commentsQuestion.id] || []) : []

    return (
      <SessionTheme theme={session.theme} className="min-h-screen bg-gradient-to-br from-background to-muted">
        <header className="border-b border-border bg-card">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-4">
                <SessionLogo theme={session.theme} className="h-10 shrink-0" />
                <div className="min-w-0">
                  <h1 className="font-display truncate text-xl font-bold text-foreground">{session.title}</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {participant?.name || participant?.external_id || 'Guest'}
                    {commentsTotalQuestions > 0 && !inLobby && !hostFinished &&
                      ` • Image ${(hostMode ? hostIndex : currentQuestionIndex) + 1} of ${commentsTotalQuestions}`}
                  </p>
                </div>
              </div>
              <button onClick={switchParticipant} className="text-sm font-medium text-accent hover:underline">
                Switch
              </button>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-8">
          {commentsTotalQuestions === 0 ? (
            <div className="mx-auto max-w-2xl py-10 text-center">
              <h2 className="font-display text-2xl font-bold text-foreground">No images yet</h2>
              <p className="mt-2 text-muted-foreground">
                The organizer hasn't added any images to this session yet.
              </p>
            </div>
          ) : inLobby ? (
            <div className="mx-auto max-w-2xl py-10 text-center">
              <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
              <h2 className="font-display mt-6 text-2xl font-bold text-foreground">You're in!</h2>
              <p className="mt-2 text-muted-foreground">
                Waiting for the host to show the first image.
              </p>
            </div>
          ) : hostFinished ? (
            <div className="mx-auto max-w-2xl py-10 text-center">
              <h2 className="font-display text-2xl font-bold text-foreground">Thanks for your comments!</h2>
              <p className="mt-2 text-muted-foreground">The session has ended.</p>
            </div>
          ) : commentsQuestion ? (
            <div className="mx-auto max-w-2xl">
              <div className="rounded-2xl border border-border bg-card shadow-lg overflow-hidden">
                <img
                  src={commentsQuestion.image_url}
                  alt=""
                  className="w-full max-h-96 object-contain bg-muted"
                />
                <div className="p-6">
                  <p className="text-lg font-medium text-foreground">{commentsQuestion.text}</p>

                  {commentError && (
                    <p className="mt-4 text-sm font-medium text-destructive">{commentError}</p>
                  )}

                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      submitComment(commentsQuestion.id)
                    }}
                    className="mt-4"
                  >
                    <textarea
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value.slice(0, 500))}
                      rows="3"
                      maxLength={500}
                      placeholder="Share your thoughts on this image…"
                      className="block w-full rounded-lg border border-border px-4 py-3 text-foreground shadow-sm focus:border-ring focus:ring-2 focus:ring-ring focus:ring-opacity-20 resize-none"
                    />
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{commentDraft.length}/500</span>
                      <button
                        type="submit"
                        disabled={submittingComment || !commentDraft.trim()}
                        className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {submittingComment ? 'Sending…' : 'Send comment'}
                      </button>
                    </div>
                  </form>

                  {ownComments.length > 0 && (
                    <div className="mt-6 space-y-3 border-t border-border pt-4">
                      <p className="text-sm font-medium text-foreground">Your comments</p>
                      {ownComments.map((c) => (
                        <div key={c.comment_id} className="rounded-lg bg-muted p-3 text-sm text-foreground">
                          {c.comment_body}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {!hostMode && (
                <div className="mt-6 flex justify-between">
                  <button
                    onClick={() => setCurrentQuestionIndex((i) => Math.max(0, i - 1))}
                    disabled={currentQuestionIndex === 0}
                    className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-6 py-3 text-base font-semibold text-foreground shadow-sm hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  {currentQuestionIndex < commentsTotalQuestions - 1 && (
                    <button
                      onClick={() => setCurrentQuestionIndex((i) => i + 1)}
                      className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
                    >
                      Next image
                    </button>
                  )}
                </div>
              )}

              {hostMode && (
                <p className="mt-6 text-center text-sm text-muted-foreground">
                  The next image will appear when the host moves on.
                </p>
              )}
            </div>
          ) : null}
        </main>
      </SessionTheme>
    )
  }

  const currentQuestion = getCurrentQuestion()
  const currentOptions = getCurrentOptions()
  const totalQuestions = questions.length

  return (
    <SessionTheme theme={session.theme} className="min-h-screen bg-gradient-to-br from-background to-muted">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
            <SessionLogo theme={session.theme} className="h-10 shrink-0" />
            <div className="min-w-0">
              <h1 className="font-display text-xl font-bold text-foreground">{session.title}</h1>
              <div className="mt-1 text-sm text-muted-foreground">
                <span>{RESULTS_MODE_LABELS[session.results_mode] || session.results_mode}</span>
                {totalQuestions > 0 && !(hostMode && (hostIndex < 0 || hostIndex >= totalQuestions)) && (
                  <span className="ml-4">Question {currentQuestionIndex + 1} of {totalQuestions}</span>
                )}
              </div>
            </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-sm text-muted-foreground bg-muted px-3 py-1 rounded-full">
                {identified ? (participant?.name || participant?.external_id || 'Identified') : 'Anonymous Vote'}
              </div>
              {identified && (
                <button
                  onClick={switchParticipant}
                  className="text-sm font-medium text-accent hover:underline"
                >
                  Switch
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {questions.length === 0 ? (
          <div className="max-w-3xl mx-auto">
            <div className="rounded-2xl border border-border bg-card shadow-lg p-8 text-center">
              <div className="inline-block rounded-full bg-muted p-6 mb-4">
                <svg className="h-12 w-12 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h2 className="font-display text-2xl font-bold text-foreground">No Questions Yet</h2>
              <p className="mt-2 text-muted-foreground max-w-md mx-auto">
                The organizer hasn't added any questions to this poll yet.
                Please check back later or contact the event organizer.
              </p>
              <div className="mt-8">
                <a href="/" className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity">
                  Return to Home
                </a>
              </div>
            </div>
          </div>
        ) : hostMode && hostIndex < 0 ? (
          // Waiting room: the host has started but hasn't shown a question yet
          <div className="max-w-3xl mx-auto">
            <div className="rounded-2xl border border-border bg-card shadow-lg p-10 text-center">
              <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"></div>
              <h2 className="font-display mt-6 text-2xl font-bold text-foreground">You're in!</h2>
              <p className="mt-2 text-muted-foreground">
                Waiting for the host to start. The first question will appear here automatically.
              </p>
            </div>
          </div>
        ) : showResults ? (
          // Results View
          <div className="max-w-4xl mx-auto">
            <div className="mb-8 text-center">
              <h2 className="font-display text-3xl font-bold text-foreground">Poll Results</h2>
              <p className="mt-2 text-muted-foreground">
                Thank you for participating! Here are the results:
              </p>
            </div>

            <div className="space-y-8">
              {questions.map((question, index) => (
                <div key={question.id} className="rounded-2xl border border-border bg-card shadow-lg p-8">
                  <div className="mb-6">
                    <h3 className="text-2xl font-bold text-foreground">
                      <span className="text-accent">Q{index + 1}:</span> {question.text}
                    </h3>
                    <p className="mt-2 text-muted-foreground">
                      {index === currentQuestionIndex && votes[question.id]
                        ? `You voted: "${optionsByQuestion[question.id]?.find(o => o.id === votes[question.id])?.text}"`
                        : identified ? 'No response recorded' : 'Your vote is anonymous'}
                    </p>
                  </div>

                  {session.results_mode === 'live' ? (
                    <ResultsChart
                      options={optionsByQuestion[question.id] || []}
                      voteCounts={voteCounts}
                      live={false}
                    />
                  ) : (
                    <div className="space-y-4">
                      {(() => {
                        const qOptions = optionsByQuestion[question.id] || []
                        const qTotal = qOptions.reduce((sum, o) => sum + (voteCounts[o.id] || 0), 0)
                        return qOptions.map((option) => {
                          const count = voteCounts[option.id] || 0
                          const pct = qTotal === 0 ? 0 : Math.round((count / qTotal) * 100)
                          return (
                            <div key={option.id} className="space-y-2">
                              <div className="flex justify-between text-sm">
                                <span className="font-medium text-foreground">{option.text}</span>
                                <span className="text-muted-foreground">{pct}% • {count} vote{count !== 1 ? 's' : ''}</span>
                              </div>
                              <div className="h-3 w-full bg-muted rounded-full overflow-hidden">
                                <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent" style={{ width: `${pct}%` }}></div>
                              </div>
                            </div>
                          )
                        })
                      })()}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-8 text-center">
              <p className="text-muted-foreground mb-4">
                Results may change as more people finish voting.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
              >
                <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh for Latest Results
              </button>
            </div>
          </div>
        ) : (
          // Voting View
          <div className="max-w-3xl mx-auto">
            {/* Question Progress */}
            {totalQuestions > 1 && (
              <div className="mb-8">
                <div className="flex justify-between text-sm text-muted-foreground mb-2">
                  <span>Question {currentQuestionIndex + 1} of {totalQuestions}</span>
                  <span>{Math.round(((currentQuestionIndex + 1) / totalQuestions) * 100)}% complete</span>
                </div>
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
                    style={{ width: `${((currentQuestionIndex + 1) / totalQuestions) * 100}%` }}
                  ></div>
                </div>
              </div>
            )}

            {voteError && (
              <div className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                <p className="text-sm font-medium text-destructive">{voteError}</p>
              </div>
            )}

            {/* Poll Question */}
            {currentQuestion && questionResultsShown && (
              <h2 className="font-display mb-4 text-center text-2xl font-bold text-foreground">
                Question {currentQuestionIndex + 1} results
              </h2>
            )}
            {currentQuestion && (
              <PollQuestion
                question={currentQuestion}
                options={currentOptions}
                onVote={handleVote}
                loading={submittingVote}
                selectedOptionId={votes[currentQuestion.id]}
                showResults={questionResultsShown}
                resultsData={getResultsData()}
                voterName={identified ? (participant?.name || participant?.external_id || null) : null}
              />
            )}

            {hostMode && currentQuestion && (votes[currentQuestion.id] || resultsRevealed) && (
              <div className="mt-6 rounded-lg border border-border bg-muted p-4 text-center text-muted-foreground">
                {votes[currentQuestion.id]
                  ? 'Vote recorded. The next question will appear when the host moves on.'
                  : 'Voting is closed for this question. The next one will appear when the host moves on.'}
              </div>
            )}

            {/* Navigation - self-paced only; in host mode the presenter drives */}
            <div className={`mt-8 flex justify-between ${hostMode ? 'hidden' : ''}`}>
              <button
                onClick={prevQuestion}
                disabled={currentQuestionIndex === 0 || submittingVote}
                className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-6 py-3 text-base font-semibold text-foreground shadow-sm hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Previous
              </button>

              <div className="flex items-center space-x-4">
                <button
                    onClick={nextQuestion}
                    disabled={!votes[currentQuestion?.id] || submittingVote}
                    className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {currentQuestionIndex < totalQuestions - 1 ? (
                      <>
                        Next Question
                        <svg className="ml-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </>
                    ) : (
                      <>
                        See Results
                        <svg className="ml-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </>
                    )}
                  </button>
              </div>
            </div>

            {/* Instructions */}
            <div className="mt-8 rounded-lg bg-muted border border-border p-6">
              <h4 className="text-lg font-semibold text-foreground mb-2">Voting Instructions</h4>
              <ul className="text-muted-foreground space-y-2">
                <li className="flex items-start">
                  <span className="mr-2">📱</span>
                  <span>Select your answer by clicking on an option</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">✅</span>
                  <span>
                    {identified
                      ? 'Your answers are recorded against your name/ID and visible to the organizer'
                      : 'Your vote is anonymous and cannot be changed after submission'}
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">📊</span>
                  <span>
                    {!perQuestionResults
                      ? 'Results are shown after the last question'
                      : hostMode
                        ? "You'll see each question's results when the host reveals them"
                        : "You'll see each question's results after you vote"}
                  </span>
                </li>
              </ul>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-12 border-t border-border bg-card py-8">
        <div className="container mx-auto px-4 text-center">
          <p className="text-sm text-muted-foreground">
            Powered by LivePolls • {identified ? 'Your answers are visible to the organizer' : 'Your vote is anonymous and secure'}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Need help? Contact the event organizer.
          </p>
        </div>
      </footer>
    </SessionTheme>
  )
}