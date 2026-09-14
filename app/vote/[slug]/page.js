'use client'

import { useState, useEffect, useRef } from 'react'
import SessionTheme from '@/components/SessionTheme'
import SessionLogo from '@/components/SessionLogo'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import PollQuestion from '@/components/PollQuestion'
import ResultsChart from '@/components/ResultsChart'
import { generateVoterToken } from '@/lib/utils'

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
  const supabase = createClient()

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
        .select('current_question_index, results_revealed, theme')
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

      // Load questions and options
      await loadQuestionsAndOptions(data.id)
      await loadVoteCounts(data.id)
    } catch (error) {
      console.error('Error loading session:', error)
      // Session might not exist or be inactive
    } finally {
      setLoading(false)
    }
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

  const handleVote = async (optionId) => {
    if (!session || !voterToken) return

    const currentQuestion = questions[currentQuestionIndex]
    if (!currentQuestion) return

    setSubmittingVote(true)
    setVoteError(null)

    try {
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
                <span className="capitalize">{session.results_mode} results</span>
                {totalQuestions > 0 && !(hostMode && (hostIndex < 0 || hostIndex >= totalQuestions)) && (
                  <span className="ml-4">Question {currentQuestionIndex + 1} of {totalQuestions}</span>
                )}
              </div>
            </div>
            </div>
            <div className="flex items-center">
              <div className="text-sm text-muted-foreground bg-muted px-3 py-1 rounded-full">
                Anonymous Vote
              </div>
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
                        : 'Your vote is anonymous'}
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
                  <span>Your vote is anonymous and cannot be changed after submission</span>
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
            Powered by LivePolls • Your vote is anonymous and secure
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Need help? Contact the event organizer.
          </p>
        </div>
      </footer>
    </SessionTheme>
  )
}