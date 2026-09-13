'use client'

import { useState, useEffect } from 'react'

export default function PollQuestion({
  question,
  options,
  onVote,
  loading = false,
  selectedOptionId = null,
  showResults = false,
  resultsData = null
}) {
  const [selected, setSelected] = useState(selectedOptionId)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setSelected(selectedOptionId)
  }, [selectedOptionId])

  const handleVote = async (optionId) => {
    if (showResults) return // Can't change vote when viewing results

    setSelected(optionId)
    setSubmitting(true)

    try {
      await onVote(optionId)
    } finally {
      setSubmitting(false)
    }
  }

  const totalVotes = resultsData?.totalVotes || 0

  // Calculate percentages for results display
  const getOptionPercentage = (optionId) => {
    if (!resultsData || totalVotes === 0) return 0
    const optionVotes = resultsData.optionVotes[optionId] || 0
    return Math.round((optionVotes / totalVotes) * 100)
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-lg p-8">
      {/* Question Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-bold text-foreground">{question.text}</h2>
          {showResults && totalVotes > 0 && (
            <span className="inline-flex items-center rounded-full bg-primary/15 px-3 py-1 text-sm font-medium text-accent">
              {totalVotes} vote{totalVotes !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <p className="mt-2 text-muted-foreground">
          {showResults
            ? 'Your vote is in. Results so far:'
            : 'Select your answer below:'}
        </p>
      </div>

      {/* Options */}
      <div className="space-y-4">
        {options.map((option, index) => {
          const isSelected = selected === option.id
          const optionVotes = resultsData?.optionVotes[option.id] || 0
          const percentage = getOptionPercentage(option.id)
          const isLeading = showResults &&
            resultsData?.leadingOptionId === option.id &&
            totalVotes > 0

          return (
            <button
              key={option.id}
              onClick={() => handleVote(option.id)}
              disabled={loading || submitting || showResults}
              className={`w-full text-left rounded-xl border transition-all duration-200 ${
                showResults
                  ? 'cursor-default'
                  : 'hover:shadow-md active:scale-[0.995]'
              } ${
                isSelected
                  ? 'border-ring bg-muted ring-2 ring-blue-500 ring-opacity-20'
                  : 'border-border hover:border-primary/50'
              } ${loading || submitting ? 'opacity-60' : ''}`}
            >
              <div className="p-6">
                {/* Option header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center">
                    <div className={`h-6 w-6 rounded-full border flex items-center justify-center mr-3 ${
                      isSelected ? 'border-primary' : 'border-border'
                    }`}>
                      <div className={`h-3 w-3 rounded-full ${
                        isSelected ? 'bg-primary' : 'bg-transparent'
                      }`} />
                    </div>
                    <span className="text-lg font-medium text-foreground">
                      {option.text}
                    </span>
                  </div>
                  {showResults && (
                    <span className={`text-lg font-bold ${
                      isLeading ? 'text-emerald-400' : 'text-foreground'
                    }`}>
                      {percentage}%
                    </span>
                  )}
                </div>

                {/* Results bar (when showing results) */}
                {showResults && (
                  <div className="mt-4">
                    <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
                      <span>{optionVotes} vote{optionVotes !== 1 ? 's' : ''}</span>
                      <span>{percentage}%</span>
                    </div>
                    <div className="h-3 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-1000 ${
                          isLeading ? 'bg-emerald-500' : 'bg-primary'
                        }`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* Status */}
      {(loading || submitting) && (
        <div className="mt-8 text-center">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-solid border-primary border-r-transparent"></div>
          <p className="mt-2 text-muted-foreground">
            {submitting ? 'Submitting your vote...' : 'Loading...'}
          </p>
        </div>
      )}

      {showResults && totalVotes === 0 && (
        <div className="mt-8 text-center text-muted-foreground">
          No votes yet. Be the first to vote!
        </div>
      )}

      {/* Instructions */}
      {!showResults && !loading && !submitting && (
        <div className="mt-8 rounded-lg bg-muted p-4">
          <div className="flex items-center text-sm text-muted-foreground">
            <svg className="h-5 w-5 mr-2 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>
              Your vote is anonymous. You can't change your vote after submitting,
              but you can continue to next question.
            </span>
          </div>
        </div>
      )}

      {/* Voting completed indicator */}
      {showResults && selected && (
        <div className="mt-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-4">
          <div className="flex items-center text-emerald-300">
            <svg className="h-5 w-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="font-medium">
              You voted for "{options.find(o => o.id === selected)?.text || 'your choice'}"
            </span>
          </div>
        </div>
      )}
    </div>
  )
}