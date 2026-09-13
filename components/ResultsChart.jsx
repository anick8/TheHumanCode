'use client'

import { useState, useEffect } from 'react'

export default function ResultsChart({
  questionId,
  sessionId,
  options = [],
  subscriptionEnabled = true
}) {
  const [voteCounts, setVoteCounts] = useState({})
  const [totalVotes, setTotalVotes] = useState(0)
  const [loading, setLoading] = useState(true)
  const [subscription, setSubscription] = useState(null)

  // Initialize vote counts
  useEffect(() => {
    if (options.length > 0) {
      const initialCounts = {}
      options.forEach(option => {
        initialCounts[option.id] = 0
      })
      setVoteCounts(initialCounts)
      setLoading(false)
    }
  }, [options])

  // For demo purposes, simulate real-time voting
  useEffect(() => {
    if (!subscriptionEnabled || options.length === 0) return

    // Simulate receiving votes
    const interval = setInterval(() => {
      // Only simulate if we have less than 100 votes (for demo)
      if (totalVotes < 100) {
        const randomOptionIndex = Math.floor(Math.random() * options.length)
        const optionId = options[randomOptionIndex].id

        setVoteCounts(prev => ({
          ...prev,
          [optionId]: (prev[optionId] || 0) + 1
        }))
        setTotalVotes(prev => prev + 1)
      }
    }, 3000) // Add a vote every 3 seconds

    return () => clearInterval(interval)
  }, [options, subscriptionEnabled, totalVotes])

  // Calculate percentages and find leading option
  const getOptionPercentage = (optionId) => {
    if (totalVotes === 0) return 0
    const count = voteCounts[optionId] || 0
    return Math.round((count / totalVotes) * 100)
  }

  const leadingOptionId = options.length > 0 && totalVotes > 0
    ? options.reduce((leading, option) => {
        const currentCount = voteCounts[option.id] || 0
        const leadingCount = voteCounts[leading?.id] || 0
        return currentCount > leadingCount ? option : leading
      }, options[0]).id
    : null

  return (
    <div className="rounded-2xl border border-border bg-card p-8 shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="font-display text-2xl font-bold text-foreground">Live Results</h2>
          <p className="mt-1 text-muted-foreground">
            Votes update in real-time as participants submit their choices.
          </p>
        </div>
        <div className="flex items-center">
          {subscriptionEnabled && (
            <div className="flex items-center mr-4">
              <div className="h-3 w-3 rounded-full bg-emerald-500 mr-2 animate-pulse"></div>
              <span className="text-sm font-medium text-emerald-300">Live</span>
            </div>
          )}
          <div className="inline-flex items-center rounded-full bg-primary/15 px-3 py-1 text-sm font-medium text-accent">
            <svg className="mr-1.5 h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
            </svg>
            {totalVotes} vote{totalVotes !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="space-y-6">
        {options.map((option) => {
          const count = voteCounts[option.id] || 0
          const percentage = getOptionPercentage(option.id)
          const isLeading = leadingOptionId === option.id && totalVotes > 0

          return (
            <div key={option.id} className="space-y-3">
              {/* Option header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  {isLeading && (
                    <span className="mr-2 inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
                      <svg className="mr-1 h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z" clipRule="evenodd" />
                      </svg>
                      Leading
                    </span>
                  )}
                  <span className="text-lg font-medium text-foreground">{option.text}</span>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-foreground">{percentage}%</div>
                  <div className="text-sm text-muted-foreground">{count} vote{count !== 1 ? 's' : ''}</div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="h-4 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    isLeading ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' : 'bg-gradient-to-r from-primary to-accent'
                  }`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="mt-8 pt-8 border-t border-border">
        <div className="flex flex-wrap items-center justify-center gap-6 text-sm">
          <div className="flex items-center">
            <div className="h-3 w-8 rounded-full bg-gradient-to-r from-primary to-accent mr-2"></div>
            <span className="text-muted-foreground">Option results</span>
          </div>
          <div className="flex items-center">
            <div className="h-3 w-8 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 mr-2"></div>
            <span className="text-muted-foreground">Currently leading</span>
          </div>
          {subscriptionEnabled && (
            <div className="flex items-center">
              <div className="h-3 w-3 rounded-full bg-emerald-500 mr-2 animate-pulse"></div>
              <span className="text-muted-foreground">Live updates</span>
            </div>
          )}
        </div>
      </div>

      {/* Empty State */}
      {totalVotes === 0 && !loading && (
        <div className="mt-8 text-center py-12">
          <div className="inline-block rounded-full bg-muted p-6 mb-4">
            <svg className="h-12 w-12 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-foreground">Waiting for votes</h3>
          <p className="mt-2 text-muted-foreground max-w-md mx-auto">
            No votes have been submitted yet. Share the QR code with attendees to start seeing results.
          </p>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="mt-8 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-solid border-primary border-r-transparent"></div>
          <p className="mt-2 text-muted-foreground">Loading results...</p>
        </div>
      )}

      {/* Integration Note */}
      <div className="mt-8 rounded-lg bg-muted border border-border p-4">
        <div className="flex items-start">
          <svg className="h-5 w-5 text-accent mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="text-sm font-medium text-foreground">Real-time updates</p>
            <p className="mt-1 text-sm text-accent">
              {subscriptionEnabled
                ? "Votes are simulated for this demo. In production, this will connect to Supabase Realtime for live updates."
                : "Connect to Supabase Realtime to enable live vote updates as attendees submit their choices."
              }
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}