'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import ResultsChart from '@/components/ResultsChart'
import { formatDateTime } from '@/lib/utils'
import SessionTheme from '@/components/SessionTheme'
import SessionLogo from '@/components/SessionLogo'

export default function SessionResultsPage() {
  const params = useParams()
  const [session, setSession] = useState(null)
  const [questions, setQuestions] = useState([])
  const [optionsByQuestion, setOptionsByQuestion] = useState({})
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview') // 'overview', 'questions', 'export'
  const [realtimeEnabled, setRealtimeEnabled] = useState(true)
  // {optionId: count}, computed from a direct votes read (see loadVotes).
  const [voteCounts, setVoteCounts] = useState({})
  // Distinct voter_token count across the whole session - a real stat,
  // unlike completion-rate/average-time which the schema has no basis for.
  const [uniqueVoters, setUniqueVoters] = useState(0)
  const [lastUpdated, setLastUpdated] = useState(null)
  const supabase = createClient()

  const sessionId = params.sessionId

  useEffect(() => {
    if (sessionId) {
      loadSession()
      loadQuestionsAndOptions()
    }
  }, [sessionId])

  // Poll for new votes while "Live Updates" is on. This mirrors the pattern
  // the voter-facing page already uses (reload counts after a write) rather
  // than a Postgres changefeed subscription - simpler, and matches how the
  // votes table's realtime publication isn't otherwise consumed anywhere.
  useEffect(() => {
    if (!realtimeEnabled || questions.length === 0) return
    const interval = setInterval(() => loadVotes(questions), 5000)
    return () => clearInterval(interval)
  }, [realtimeEnabled, questions])

  const loadSession = async () => {
    try {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .single()

      if (error) throw error
      setSession(data)
    } catch (error) {
      console.error('Error loading session:', error)
    }
  }

  const loadQuestionsAndOptions = async () => {
    try {
      const { data: questionsData, error: questionsError } = await supabase
        .from('questions')
        .select('*')
        .eq('session_id', sessionId)
        .order('order_index')

      if (questionsError) throw questionsError
      const loadedQuestions = questionsData || []

      const optionsMap = {}
      for (const question of loadedQuestions) {
        const { data: optionsData, error: optionsError } = await supabase
          .from('options')
          .select('*')
          .eq('question_id', question.id)
          .order('order_index')

        if (optionsError) throw optionsError
        optionsMap[question.id] = optionsData || []
      }

      setQuestions(loadedQuestions)
      setOptionsByQuestion(optionsMap)
      await loadVotes(loadedQuestions)
    } catch (error) {
      console.error('Error loading questions:', error)
      setQuestions([])
      setOptionsByQuestion({})
    } finally {
      setLoading(false)
    }
  }

  // Direct votes read rather than the get_vote_counts RPC: the RPC exists so
  // anonymous attendees can see aggregates without table access; the session
  // owner already has row-level SELECT on votes (database-setup.sql's "Users
  // can view votes in their sessions" policy), which also exposes voter_token
  // - needed for a real unique-voter count that the RPC doesn't return.
  const loadVotes = async (questionList) => {
    try {
      const questionIds = questionList.map((q) => q.id)
      if (questionIds.length === 0) {
        setVoteCounts({})
        setUniqueVoters(0)
        return
      }

      const { data, error } = await supabase
        .from('votes')
        .select('option_id, voter_token')
        .in('question_id', questionIds)

      if (error) throw error

      const counts = {}
      const voters = new Set()
      for (const v of data || []) {
        counts[v.option_id] = (counts[v.option_id] || 0) + 1
        voters.add(v.voter_token)
      }
      setVoteCounts(counts)
      setUniqueVoters(voters.size)
      setLastUpdated(new Date().toISOString())
    } catch (error) {
      console.error('Error loading votes:', error)
    }
  }

  const getQuestionVoteCount = (questionId) =>
    (optionsByQuestion[questionId] || []).reduce(
      (sum, o) => sum + (voteCounts[o.id] || 0),
      0
    )

  // totalVotes and uniqueVoters are real (loadVotes). completionRate and
  // averageTimePerVote have no basis in the schema - nothing here tracks
  // per-voter progress through a session or timing - so they're left out
  // rather than shown as invented numbers.
  const getVoteStats = () => {
    const totalVotes = Object.values(voteCounts).reduce((a, b) => a + b, 0)
    return {
      totalVotes,
      uniqueVoters,
      questionsAnswered: questions.length
    }
  }

  const exportResults = () => {
    const data = {
      session,
      questions: questions.map((q) => ({
        ...q,
        options: (optionsByQuestion[q.id] || []).map((o) => ({
          ...o,
          votes: voteCounts[o.id] || 0
        }))
      })),
      stats: getVoteStats(),
      exportedAt: new Date().toISOString()
    }

    const dataStr = JSON.stringify(data, null, 2)
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr)

    const exportFileDefaultName = `poll-results-${session?.slug || 'session'}-${new Date().toISOString().slice(0, 10)}.json`

    const linkElement = document.createElement('a')
    linkElement.setAttribute('href', dataUri)
    linkElement.setAttribute('download', exportFileDefaultName)
    linkElement.click()
  }

  const exportResultsCSV = () => {
    const rows = [['Question', 'Option', 'Votes', 'Percentage']]
    for (const q of questions) {
      const qOptions = optionsByQuestion[q.id] || []
      const qTotal = getQuestionVoteCount(q.id)
      for (const o of qOptions) {
        const count = voteCounts[o.id] || 0
        const pct = qTotal === 0 ? 0 : Math.round((count / qTotal) * 100)
        // Quote every field and escape embedded quotes (RFC 4180) - question
        // and option text are free-form user input and may contain commas.
        const escape = (v) => `"${String(v).replace(/"/g, '""')}"`
        rows.push([escape(q.text), escape(o.text), count, `${pct}%`])
      }
    }
    const csv = rows.map((r) => r.join(',')).join('\n')
    const dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
    const exportFileDefaultName = `poll-results-${session?.slug || 'session'}-${new Date().toISOString().slice(0, 10)}.csv`

    const linkElement = document.createElement('a')
    linkElement.setAttribute('href', dataUri)
    linkElement.setAttribute('download', exportFileDefaultName)
    linkElement.click()
  }

  // "Most Active" means highest vote count, not "whatever is first" - pick
  // by actual votes now that real counts exist.
  const getTopQuestion = () => {
    if (questions.length === 0) return null
    return questions.reduce((top, q) =>
      getQuestionVoteCount(q.id) > getQuestionVoteCount(top.id) ? q : top
    , questions[0])
  }

  const getTopOptions = () => {
    const topQuestion = getTopQuestion()
    if (!topQuestion) return []
    return optionsByQuestion[topQuestion.id] || []
  }

  if (loading) {
    return (
      <div className="py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-muted rounded w-48 mb-8"></div>
          <div className="h-64 bg-muted rounded-lg"></div>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="py-8 text-center">
        <h2 className="font-display text-2xl font-bold text-foreground">Session not found</h2>
        <p className="mt-2 text-muted-foreground">The session you're looking for doesn't exist.</p>
      </div>
    )
  }

  const stats = getVoteStats()
  const topQuestion = getTopQuestion()
  const topOptions = getTopOptions()

  return (
    <SessionTheme theme={session.theme} className="my-8 rounded-2xl px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <SessionLogo theme={session.theme} className="mb-4 h-12" />
            <h1 className="font-display text-3xl font-bold text-foreground">Results: {session.title}</h1>
            <div className="mt-2 text-muted-foreground">
              <span className="capitalize">{session.results_mode} results • </span>
              <span>{lastUpdated ? `Updated ${formatDateTime(lastUpdated)}` : 'Loading…'}</span>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <button
              onClick={exportResults}
              className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-6 py-3 text-base font-semibold text-foreground shadow-sm hover:bg-muted transition-colors"
            >
              <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export Results
            </button>
            <button
              onClick={() => setRealtimeEnabled(!realtimeEnabled)}
              className={`inline-flex items-center justify-center rounded-lg px-6 py-3 text-base font-semibold shadow-sm transition-colors ${
                realtimeEnabled
                  ? 'bg-gradient-to-r from-emerald-600 to-emerald-500 text-white hover:opacity-90'
                  : 'border border-border bg-card text-foreground hover:bg-muted'
              }`}
            >
              {realtimeEnabled ? (
                <>
                  <div className="mr-2 h-3 w-3 rounded-full bg-emerald-400 animate-pulse"></div>
                  Live Updates On
                </>
              ) : (
                <>
                  <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.59 6.59m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                  Live Updates Off
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-8 border-b border-border">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('overview')}
            className={`whitespace-nowrap py-4 px-1 border-b-2 text-sm font-medium ${
              activeTab === 'overview'
                ? 'border-ring text-accent'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            <svg className="mr-2 h-5 w-5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Overview
          </button>
          <button
            onClick={() => setActiveTab('questions')}
            className={`whitespace-nowrap py-4 px-1 border-b-2 text-sm font-medium ${
              activeTab === 'questions'
                ? 'border-ring text-accent'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            <svg className="mr-2 h-5 w-5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            All Questions ({questions.length})
          </button>
          <button
            onClick={() => setActiveTab('export')}
            className={`whitespace-nowrap py-4 px-1 border-b-2 text-sm font-medium ${
              activeTab === 'export'
                ? 'border-ring text-accent'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            <svg className="mr-2 h-5 w-5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Export & Share
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-8">
          {/* Stats Cards - only stats the schema can actually support.
              Completion rate and average time were removed rather than
              faked: nothing tracks a voter's progress through a session or
              how long they took. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
              <div className="text-3xl font-bold text-foreground">{stats.totalVotes}</div>
              <div className="text-sm text-muted-foreground">Total Votes</div>
              <div className="mt-2 text-xs text-muted-foreground">
                Across all questions
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
              <div className="text-3xl font-bold text-foreground">{stats.uniqueVoters}</div>
              <div className="text-sm text-muted-foreground">Unique Voters</div>
              <div className="mt-2 text-xs text-muted-foreground">
                Distinct voter tokens
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
              <div className="text-3xl font-bold text-foreground">{stats.questionsAnswered}</div>
              <div className="text-sm text-muted-foreground">Questions</div>
              <div className="mt-2 text-xs text-muted-foreground">
                In this session
              </div>
            </div>
          </div>

          {/* Top Question */}
          {topQuestion && (
            <div className="rounded-2xl border border-border bg-card p-8 shadow-lg">
              <div className="mb-6">
                <h2 className="font-display text-2xl font-bold text-foreground">Most Active Question</h2>
                <p className="mt-1 text-muted-foreground">
                  Question with the highest voter engagement
                </p>
              </div>

              <div className="mb-8">
                <h3 className="text-xl font-semibold text-foreground">{topQuestion.text}</h3>
                <div className="mt-2 text-sm text-muted-foreground">
                  {topOptions.length} options • {stats.totalVotes} total votes
                </div>
              </div>

              <ResultsChart
                options={topOptions}
                voteCounts={voteCounts}
                live={realtimeEnabled}
              />
            </div>
          )}

          {/* QR Code Reminder */}
          <div className="rounded-2xl border border-border bg-muted p-8">
            <div className="flex items-start">
              <svg className="h-6 w-6 text-accent mr-3 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-2">Share these results</h3>
                <p className="text-accent">
                  Use the QR code from the session page to continue collecting votes.
                  Results update automatically as more people vote.
                </p>
                <div className="mt-4">
                  <a
                    href={`/dashboard/sessions/${sessionId}`}
                    className="inline-flex items-center text-sm font-medium text-accent hover:text-accent"
                  >
                    <svg className="mr-1.5 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Back to session page for QR code
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'questions' && (
        <div className="space-y-8">
          {questions.map((question, index) => (
            <div key={question.id} className="rounded-2xl border border-border bg-card p-8 shadow-lg">
              <div className="mb-6">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-gradient-to-r from-primary to-accent text-white font-medium text-sm mr-4">
                      {index + 1}
                    </span>
                    <h3 className="text-xl font-semibold text-foreground inline">{question.text}</h3>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {optionsByQuestion[question.id]?.length || 0} options
                  </div>
                </div>
                <p className="mt-2 text-muted-foreground">
                  See how participants voted on this question.
                </p>
              </div>

              <ResultsChart
                options={optionsByQuestion[question.id] || []}
                voteCounts={voteCounts}
                live={realtimeEnabled}
              />

              {/* Option Details. No "Trend" column: nothing in the schema
                  tracks vote history over time, so there is no real trend to
                  show - it was previously Math.random(), removed rather than
                  replaced with another fake number. */}
              {optionsByQuestion[question.id] && optionsByQuestion[question.id].length > 0 && (
                <div className="mt-8 pt-8 border-t border-border">
                  <h4 className="text-lg font-semibold text-foreground mb-4">Option Details</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-border">
                      <thead>
                        <tr>
                          <th className="px-4 py-3.5 text-left text-sm font-semibold text-foreground">Option</th>
                          <th className="px-4 py-3.5 text-left text-sm font-semibold text-foreground">Votes</th>
                          <th className="px-4 py-3.5 text-left text-sm font-semibold text-foreground">Percentage</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {(() => {
                          const qOptions = optionsByQuestion[question.id]
                          const qTotal = getQuestionVoteCount(question.id)
                          return qOptions.map((option, optionIndex) => {
                            const votes = voteCounts[option.id] || 0
                            const percentage = qTotal === 0 ? 0 : Math.round((votes / qTotal) * 100)

                            return (
                              <tr key={option.id}>
                                <td className="px-4 py-4 text-sm text-foreground">
                                  <div className="flex items-center">
                                    <span className="mr-2 text-muted-foreground">{String.fromCharCode(65 + optionIndex)}</span>
                                    {option.text}
                                  </div>
                                </td>
                                <td className="px-4 py-4 text-sm text-foreground">{votes}</td>
                                <td className="px-4 py-4 text-sm text-foreground">
                                  <div className="flex items-center">
                                    <span className="font-medium">{percentage}%</span>
                                    <div className="ml-2 h-2 w-24 bg-muted rounded-full overflow-hidden">
                                      <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent" style={{ width: `${percentage}%` }}></div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )
                          })
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'export' && (
        <div className="space-y-8">
          {/* Export Options */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/15">
                <svg className="h-6 w-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-foreground">JSON Export</h3>
              <p className="mt-2 text-muted-foreground">
                Download complete results as JSON for analysis in Excel, Python, or other tools.
              </p>
              <button
                onClick={exportResults}
                className="mt-6 w-full inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
              >
                <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download JSON
              </button>
            </div>

            <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-500/15">
                <svg className="h-6 w-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-foreground">CSV Export</h3>
              <p className="mt-2 text-muted-foreground">
                Export vote data as CSV for easy analysis in spreadsheet software.
              </p>
              <button
                onClick={exportResultsCSV}
                className="mt-6 w-full inline-flex items-center justify-center rounded-lg border border-border bg-card px-6 py-3 text-base font-semibold text-foreground shadow-sm hover:bg-muted transition-colors"
              >
                <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download CSV
              </button>
            </div>
          </div>

          {/* Share Results */}
          <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
            <h3 className="text-2xl font-semibold text-foreground mb-6">Share Results</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h4 className="text-lg font-semibold text-foreground mb-4">Public Results Page</h4>
                <p className="text-muted-foreground mb-4">
                  Create a shareable link to a read-only results page.
                </p>
                {/* /vote/[slug]/results has no route yet - matches the Embed
                    button's honest "coming soon" pattern rather than handing
                    out a URL that 404s. */}
                <button
                  onClick={() => alert('Public results page coming soon!')}
                  className="w-full inline-flex items-center justify-center rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground hover:bg-muted transition-colors"
                >
                  Generate Results Link
                </button>
              </div>

              <div>
                <h4 className="text-lg font-semibold text-foreground mb-4">Embed Code</h4>
                <p className="text-muted-foreground mb-4">
                  Embed live results in your website or presentation.
                </p>
                <button
                  onClick={() => alert('Embed feature coming soon!')}
                  className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
                >
                  <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Generate Embed Code
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </SessionTheme>
  )
}