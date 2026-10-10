'use client'

// Round-by-round quiz displays. Pure and presentational: they render rows the
// server already ranked (get_question_leaderboard / get_round_recap). There is
// no Score or running total anywhere - only who got a question right, and how
// fast.

const seconds = (ms) => `${(Number(ms) / 1000).toFixed(1)}s`

// The board for one question. `limit` caps the rows shown (the presenter);
// phones pass none and see everyone who got it right.
export function RoundBoard({ entries = [], currentId = null, limit = null }) {
  if (entries.length === 0) {
    return <p className="text-center text-muted-foreground">Nobody got this one.</p>
  }

  const shown = limit ? entries.slice(0, limit) : entries
  const hidden = entries.length - shown.length

  return (
    <div>
      <ol className="space-y-2">
        {shown.map((p) => {
          const isSelf = currentId && p.participant_id === currentId
          return (
            <li
              key={p.participant_id}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                isSelf ? 'border-accent/50 bg-primary/10' : 'border-border'
              }`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span
                  className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    p.rank === 1 ? 'bg-amber-400/20 text-amber-300' : 'bg-muted text-foreground'
                  }`}
                >
                  {p.rank}
                </span>
                <span className="truncate font-medium text-foreground">
                  {p.display_name}
                  {isSelf && <span className="ml-2 text-xs font-normal text-accent">(you)</span>}
                </span>
              </span>
              <span className="shrink-0 text-sm font-bold text-accent">{seconds(p.response_ms)}</span>
            </li>
          )
        })}
      </ol>
      {hidden > 0 && (
        <p className="mt-3 text-center text-sm text-muted-foreground">+{hidden} more got it right</p>
      )}
    </div>
  )
}

// End-of-quiz recap: each revealed question with its fastest correct
// Participant(s). Deliberately no tally of wins - that would be a cumulative
// result. `currentId` marks the questions the viewer won.
export function RoundRecap({ rows = [], currentId = null }) {
  if (rows.length === 0) {
    return <p className="text-center text-muted-foreground">No questions were revealed.</p>
  }

  return (
    <ol className="space-y-2">
      {rows.map((row, i) => {
        const nobody = row.winner_names.length === 0
        const won = Boolean(currentId) && row.winner_ids.includes(currentId)
        return (
          <li
            key={row.question_id}
            className={`rounded-xl border px-4 py-3 text-left ${
              won ? 'border-accent/50 bg-primary/10' : 'border-border'
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Question {i + 1}
            </p>
            <p className="mt-1 font-medium text-foreground">{row.question_text}</p>
            <p className="mt-2 text-sm">
              {nobody ? (
                <span className="text-muted-foreground">Nobody got this one</span>
              ) : (
                <>
                  <span className="font-semibold text-foreground">{row.winner_names.join(', ')}</span>
                  <span className="ml-2 font-bold text-accent">{seconds(row.winner_ms)}</span>
                  {won && <span className="ml-2 text-xs text-accent">(you won this one)</span>}
                </>
              )}
            </p>
          </li>
        )
      })}
    </ol>
  )
}
