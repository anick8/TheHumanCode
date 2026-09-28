'use client'

import { useState, useEffect } from 'react'

// Host-paced quiz question: tap to select, change your mind freely, then
// Lock commits the choice. Once locked (or once the question is revealed)
// selection is final and the correct/wrong reveal takes over the page -
// this component only ever handles the "still open" state.
export default function QuizQuestion({
  question,
  options,
  lockedOptionId = null,
  onLock,
  locking = false,
}) {
  const [selected, setSelected] = useState(lockedOptionId)

  useEffect(() => {
    setSelected(lockedOptionId)
  }, [question?.id, lockedOptionId])

  const isLocked = Boolean(lockedOptionId)

  return (
    <div className="rounded-2xl border border-border bg-card shadow-lg p-8">
      <div className="mb-8">
        <h2 className="font-display text-2xl font-bold text-foreground">{question.text}</h2>
        <p className="mt-2 text-muted-foreground">
          {isLocked ? 'Answer locked. Waiting for the host to reveal.' : 'Select your answer, then lock it in.'}
        </p>
      </div>

      <div className="space-y-4">
        {options.map((option) => {
          const isSelected = selected === option.id
          return (
            <button
              key={option.id}
              onClick={() => !isLocked && setSelected(option.id)}
              disabled={isLocked || locking}
              className={`w-full text-left rounded-xl border p-6 transition-all duration-200 ${
                isLocked ? 'cursor-default' : 'hover:shadow-md active:scale-[0.995]'
              } ${
                isSelected
                  ? 'border-ring bg-muted ring-2 ring-primary/20'
                  : 'border-border hover:border-primary/50'
              } ${locking ? 'opacity-60' : ''}`}
            >
              <div className="flex items-center">
                <div className={`h-6 w-6 rounded-full border flex items-center justify-center mr-3 ${
                  isSelected ? 'border-primary' : 'border-border'
                }`}>
                  <div className={`h-3 w-3 rounded-full ${isSelected ? 'bg-primary' : 'bg-transparent'}`} />
                </div>
                <span className="text-lg font-medium text-foreground">{option.text}</span>
              </div>
            </button>
          )
        })}
      </div>

      <div className="mt-8">
        {isLocked ? (
          <div className="rounded-lg bg-muted p-4 text-center text-sm font-medium text-muted-foreground">
            Answer locked — waiting for the host to reveal
          </div>
        ) : (
          <button
            onClick={() => selected && onLock(selected)}
            disabled={!selected || locking}
            className="inline-flex w-full items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-base font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {locking ? 'Locking…' : 'Lock answer'}
          </button>
        )}
      </div>
    </div>
  )
}
