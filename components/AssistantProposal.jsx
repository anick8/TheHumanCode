'use client'

const SESSION_TYPE_LABELS = { poll: 'Voting poll', quiz: 'Quiz', comments: 'Image & comments' }

const SETTING_LABELS = {
  title: 'Title',
  session_type: 'Session type',
  is_scored: 'Scored',
  score_time_limit_seconds: 'Time limit',
  results_mode: 'Results display',
  identity_requires_name: 'Requires name',
  identity_requires_id: 'Requires ID',
}

function formatSettingValue(key, value) {
  if (key === 'session_type') return SESSION_TYPE_LABELS[value] || value
  if (key === 'results_mode') return value === 'live' ? 'Live results' : 'After all questions'
  if (key === 'score_time_limit_seconds') return value ? `${value}s` : 'None'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

/**
 * A draft the assistant produced. Nothing here has touched the database — the
 * organizer applies it into the editor, reviews it, and saves themselves.
 */
export default function AssistantProposal({ kind, input, resolved, blockedReason, onApply, onDiscard }) {
  const isQuestions = kind === 'questions'
  const questions = input?.questions ?? []
  const settings = input?.settings ?? {}

  return (
    <div className="rounded-xl border border-border bg-muted/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground break-words">
            {isQuestions
              ? `Draft: ${questions.length} question${questions.length === 1 ? '' : 's'}`
              : 'Draft: session settings'}
          </p>
          {input?.summary && (
            <p className="mt-1 text-xs text-muted-foreground break-words">{input.summary}</p>
          )}
        </div>
        {isQuestions && input?.mode === 'replace' && (
          <span className="flex-shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
            Replaces all
          </span>
        )}
      </div>

      {isQuestions && (
        <ol className="mt-3 space-y-2">
          {questions.map((question, index) => (
            <li key={index} className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-medium text-foreground break-words">
                {index + 1}. {question.text}
              </p>
              {question.options?.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {question.options.map((option, optionIndex) => (
                    <li
                      key={optionIndex}
                      className={`text-xs break-words ${
                        question.correct_option_index === optionIndex
                          ? 'font-semibold text-emerald-300'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {question.correct_option_index === optionIndex ? '✓ ' : '• '}
                      {option.text}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}

      {!isQuestions && (
        <dl className="mt-3 space-y-1.5">
          {Object.entries(settings).map(([key, value]) => (
            <div key={key} className="flex items-baseline justify-between gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted-foreground">{SETTING_LABELS[key] || key}</dt>
              <dd className="min-w-0 break-words text-right font-medium text-foreground">{formatSettingValue(key, value)}</dd>
            </div>
          ))}
        </dl>
      )}

      {resolved ? (
        <p className="mt-3 text-xs font-medium text-muted-foreground">
          {resolved === 'applied' ? 'Applied to the editor — review it, then press Save.' : 'Discarded.'}
        </p>
      ) : (
        <>
          {blockedReason && (
            <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
              Can&apos;t apply this: {blockedReason}
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {/* Discard stays available even when Apply is blocked — the draft
                still has to be answered, or the conversation never resumes. */}
            {!blockedReason && (
              <button
                type="button"
                onClick={onApply}
                className="inline-flex items-center rounded-lg bg-gradient-to-r from-primary to-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 transition-opacity"
              >
                Apply to editor
              </button>
            )}
            <button
              type="button"
              onClick={onDiscard}
              className="inline-flex items-center rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted transition-colors"
            >
              {blockedReason ? 'Dismiss' : 'Discard'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
