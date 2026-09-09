'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import ResultsChart from '@/components/ResultsChart'
import { formatDateTime } from '@/lib/utils'

export default function SessionResultsPage() {
  const params = useParams()
  const [session, setSession] = useState(null)
  const [questions, setQuestions] = useState([])
  const [optionsByQuestion, setOptionsByQuestion] = useState({})
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview') // 'overview', 'questions', 'export'
  const [realtimeEnabled, setRealtimeEnabled] = useState(true)
  const supabase = createClient()

  const sessionId = params.sessionId

  useEffect(() => {
    if (sessionId) {
      loadSession()
      loadQuestionsAndOptions()
    }
  }, [sessionId])

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
      // For demo, use sample data
      setQuestions(getSampleQuestions())
      setOptionsByQuestion(getSampleOptions())
    } finally {
      setLoading(false)
    }
  }

  const getSampleQuestions = () => {
    return [
      {
        id: 'q1',
        session_id: sessionId,
        text: "How would you rate today's event?",
        order_index: 0,
        created_at: new Date().toISOString()
      },
      {
        id: 'q2',
        session_id: sessionId,
        text: "What topic interests you most for future sessions?",
        order_index: 1,
        created_at: new Date().toISOString()
      },
      {
        id: 'q3',
        session_id: sessionId,
        text: "How likely are you to attend again?",
        order_index: 2,
        created_at: new Date().toISOString()
      }
    ]
  }

  const getSampleOptions = () => {
    return {
      'q1': [
        { id: 'o1', question_id: 'q1', text: 'Excellent', order_index: 0 },
        { id: 'o2', question_id: 'q1', text: 'Good', order_index: 1 },
        { id: 'o3', question_id: 'q1', text: 'Average', order_index: 2 },
        { id: 'o4', question_id: 'q1', text: 'Needs improvement', order_index: 3 }
      ],
      'q2': [
        { id: 'o5', question_id: 'q2', text: 'AI & Machine Learning', order_index: 0 },
        { id: 'o6', question_id: 'q2', text: 'Web Development', order_index: 1 },
        { id: 'o7', question_id: 'q2', text: 'Mobile Apps', order_index: 2 },
        { id: 'o8', question_id: 'q2', text: 'DevOps & Cloud', order_index: 3 }
      ],
      'q3': [
        { id: 'o9', question_id: 'q3', text: 'Very likely', order_index: 0 },
        { id: 'o10', question_id: 'q3', text: 'Likely', order_index: 1 },
        { id: 'o11', question_id: 'q3', text: 'Neutral', order_index: 2 },
        { id: 'o12', question_id: 'q3', text: 'Unlikely', order_index: 3 }
      ]
    }
  }

  const getVoteStats = () => {
    return {
      totalVotes: 147,
      uniqueVoters: 89,
      questionsAnswered: questions.length,
      averageTimePerVote: '45 seconds',
      completionRate: '78%'
    }
  }

  const exportResults = () => {
    const data = {
      session,
      questions,
      optionsByQuestion,
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

  const getTopQuestion = () => {
    if (questions.length === 0) return null
    return questions[0] // For demo, return first question
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
          <div className="h-8 bg-gray-200 rounded w-48 mb-8"></div>
          <div className="h-64 bg-gray-100 rounded-lg"></div>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="py-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900">Session not found</h2>
        <p className="mt-2 text-gray-600">The session you're looking for doesn't exist.</p>
      </div>
    )
  }

  const stats = getVoteStats()
  const topQuestion = getTopQuestion()
  const topOptions = getTopOptions()

  return (
    <div className="py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Results: {session.title}</h1>
            <div className="mt-2 text-gray-600">
              <span className="capitalize">{session.results_mode} results • </span>
              <span>Updated {formatDateTime(new Date().toISOString())}</span>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <button
              onClick={exportResults}
              className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-6 py-3 text-base font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
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
                  ? 'bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:opacity-90'
                  : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {realtimeEnabled ? (
                <>
                  <div className="mr-2 h-3 w-3 rounded-full bg-green-300 animate-pulse"></div>
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
      <div className="mb-8 border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('overview')}
            className={`whitespace-nowrap py-4 px-1 border-b-2 text-sm font-medium ${
              activeTab === 'overview'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
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
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
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
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
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
          {/* Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="text-3xl font-bold text-gray-900">{stats.totalVotes}</div>
              <div className="text-sm text-gray-600">Total Votes</div>
              <div className="mt-2 text-xs text-gray-500">
                Across all questions
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="text-3xl font-bold text-gray-900">{stats.uniqueVoters}</div>
              <div className="text-sm text-gray-600">Unique Voters</div>
              <div className="mt-2 text-xs text-gray-500">
                People who participated
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="text-3xl font-bold text-gray-900">{stats.completionRate}</div>
              <div className="text-sm text-gray-600">Completion Rate</div>
              <div className="mt-2 text-xs text-gray-500">
                Answered all questions
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="text-3xl font-bold text-gray-900">{stats.averageTimePerVote}</div>
              <div className="text-sm text-gray-600">Average Time</div>
              <div className="mt-2 text-xs text-gray-500">
                Per voting session
              </div>
            </div>
          </div>

          {/* Top Question */}
          {topQuestion && (
            <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-lg">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Most Active Question</h2>
                <p className="mt-1 text-gray-600">
                  Question with the highest voter engagement
                </p>
              </div>

              <div className="mb-8">
                <h3 className="text-xl font-semibold text-gray-900">{topQuestion.text}</h3>
                <div className="mt-2 text-sm text-gray-600">
                  {topOptions.length} options • {stats.totalVotes} total votes
                </div>
              </div>

              <ResultsChart
                questionId={topQuestion.id}
                sessionId={session.id}
                options={topOptions}
                subscriptionEnabled={realtimeEnabled}
              />
            </div>
          )}

          {/* QR Code Reminder */}
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-8">
            <div className="flex items-start">
              <svg className="h-6 w-6 text-blue-600 mr-3 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <div>
                <h3 className="text-lg font-semibold text-blue-900 mb-2">Share these results</h3>
                <p className="text-blue-800">
                  Use the QR code from the session page to continue collecting votes.
                  Results update automatically as more people vote.
                </p>
                <div className="mt-4">
                  <a
                    href={`/dashboard/sessions/${sessionId}`}
                    className="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-800"
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
            <div key={question.id} className="rounded-2xl border border-gray-200 bg-white p-8 shadow-lg">
              <div className="mb-6">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium text-sm mr-4">
                      {index + 1}
                    </span>
                    <h3 className="text-xl font-semibold text-gray-900 inline">{question.text}</h3>
                  </div>
                  <div className="text-sm text-gray-600">
                    {optionsByQuestion[question.id]?.length || 0} options
                  </div>
                </div>
                <p className="mt-2 text-gray-600">
                  See how participants voted on this question.
                </p>
              </div>

              <ResultsChart
                questionId={question.id}
                sessionId={session.id}
                options={optionsByQuestion[question.id] || []}
                subscriptionEnabled={realtimeEnabled}
              />

              {/* Option Details */}
              {optionsByQuestion[question.id] && optionsByQuestion[question.id].length > 0 && (
                <div className="mt-8 pt-8 border-t border-gray-200">
                  <h4 className="text-lg font-semibold text-gray-900 mb-4">Option Details</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-300">
                      <thead>
                        <tr>
                          <th className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Option</th>
                          <th className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Votes</th>
                          <th className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Percentage</th>
                          <th className="px-4 py-3.5 text-left text-sm font-semibold text-gray-900">Trend</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {optionsByQuestion[question.id].map((option, optionIndex) => {
                          const votes = Math.floor(Math.random() * 50) + 10
                          const percentage = Math.round((votes / 147) * 100)
                          const trend = Math.random() > 0.5 ? 'up' : 'down'
                          const trendAmount = Math.floor(Math.random() * 15) + 1

                          return (
                            <tr key={option.id}>
                              <td className="px-4 py-4 text-sm text-gray-900">
                                <div className="flex items-center">
                                  <span className="mr-2 text-gray-500">{String.fromCharCode(65 + optionIndex)}</span>
                                  {option.text}
                                </div>
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-900">{votes}</td>
                              <td className="px-4 py-4 text-sm text-gray-900">
                                <div className="flex items-center">
                                  <span className="font-medium">{percentage}%</span>
                                  <div className="ml-2 h-2 w-24 bg-gray-200 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500" style={{ width: `${percentage}%` }}></div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-4 text-sm">
                                <div className={`flex items-center ${trend === 'up' ? 'text-green-600' : 'text-red-600'}`}>
                                  <svg className="h-4 w-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                    {trend === 'up' ? (
                                      <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                                    ) : (
                                      <path fillRule="evenodd" d="M14.707 10.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L9 12.586V5a1 1 0 012 0v7.586l2.293-2.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    )}
                                  </svg>
                                  {trendAmount}%
                                </div>
                              </td>
                            </tr>
                          )
                        })}
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
            <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100">
                <svg className="h-6 w-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900">JSON Export</h3>
              <p className="mt-2 text-gray-600">
                Download complete results as JSON for analysis in Excel, Python, or other tools.
              </p>
              <button
                onClick={exportResults}
                className="mt-6 w-full inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
              >
                <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download JSON
              </button>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-green-100">
                <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-gray-900">CSV Export</h3>
              <p className="mt-2 text-gray-600">
                Export vote data as CSV for easy analysis in spreadsheet software.
              </p>
              <button
                onClick={exportResults}
                className="mt-6 w-full inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-6 py-3 text-base font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
              >
                <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Download CSV
              </button>
            </div>
          </div>

          {/* Share Results */}
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
            <h3 className="text-2xl font-semibold text-gray-900 mb-6">Share Results</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h4 className="text-lg font-semibold text-gray-900 mb-4">Public Results Page</h4>
                <p className="text-gray-600 mb-4">
                  Create a shareable link to a read-only results page.
                </p>
                <div className="flex">
                  <div className="flex-1">
                    <input
                      type="text"
                      readOnly
                      value={`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/vote/${session.slug}/results`}
                      className="block w-full rounded-l-lg border border-r-0 border-gray-300 px-4 py-3 text-gray-900 bg-gray-50"
                    />
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/vote/${session.slug}/results`)}
                    className="inline-flex items-center rounded-r-lg border border-l-0 border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div>
                <h4 className="text-lg font-semibold text-gray-900 mb-4">Embed Code</h4>
                <p className="text-gray-600 mb-4">
                  Embed live results in your website or presentation.
                </p>
                <button
                  onClick={() => alert('Embed feature coming soon!')}
                  className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
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
    </div>
  )
}