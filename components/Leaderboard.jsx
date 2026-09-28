'use client'

// Reusable ranked leaderboard for scored quizzes. Pure display: it renders
// whatever rows it's given (already ranked by the caller). `currentId`
// highlights the viewer's own row; `podium` collapses to a top-3 reveal for
// the final "winners" moment instead of a long list.
export default function Leaderboard({
  entries = [],
  currentId = null,
  podium = false,
  total = entries.length,
}) {
  const ranked = entries
  if (podium) {
    const top = ranked.slice(0, 3)
    const medal = ['text-amber-300', 'text-slate-300', 'text-amber-600']
    const ring = [
      'border-amber-400/60 shadow-[0_0_40px_-8px_rgba(251,191,36,0.5)]',
      'border-slate-400/40 shadow-[0_0_30px_-8px_rgba(148,163,184,0.4)]',
      'border-amber-700/50 shadow-[0_0_30px_-8px_rgba(180,83,9,0.4)]',
    ]
    const order = [1, 0, 2] // display 2nd, 1st, 3rd
    const heights = ['h-24', 'h-32', 'h-20']
    return (
      <div className="flex flex-col items-center">
        <div className="flex items-end justify-center gap-4">
          {order.map((slot) => {
            const p = top[slot]
            if (!p) return null
            return (
              <div key={p.participant_id} className="flex flex-col items-center gap-3 animate-scale-in">
                <span className={`font-display text-2xl font-bold ${medal[slot]}`}>#{slot + 1}</span>
                <div className={`flex w-32 flex-col items-center justify-end rounded-xl border bg-card px-3 pb-4 pt-5 ${ring[slot]} ${heights[slot]}`}>
                  <span className="text-center text-lg font-bold leading-tight text-foreground line-clamp-2">
                    {p.display_name}
                  </span>
                  <span className="mt-1 font-display text-xl text-accent">{p.score}</span>
                </div>
              </div>
            )
          })}
        </div>
        {top.length === 0 && <p className="text-muted-foreground">No participants yet.</p>}
      </div>
    )
  }

  if (ranked.length === 0) {
    return (
      <div className="text-center text-muted-foreground">
        Waiting for players to join and answer…
      </div>
    )
  }

  return (
    <ol className="space-y-2">
      {ranked.map((p, i) => {
        const place = i + 1
        const isSelf = currentId && p.participant_id === currentId
        return (
          <li
            key={p.participant_id}
            className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-colors ${
              isSelf ? 'border-accent/50 bg-primary/10' : 'border-border'
            }`}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span
                className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  place === 1 ? 'bg-amber-400/20 text-amber-300' : 'bg-muted text-foreground'
                }`}
              >
                {place}
              </span>
              <span className="truncate font-medium text-foreground">
                {p.display_name}
                {isSelf && <span className="ml-2 text-xs font-normal text-accent">(you)</span>}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-4 text-sm">
              <span className="text-muted-foreground">
                {p.answered_count ?? 0}/{total}
              </span>
              <span className="font-bold text-accent">{p.score} pts</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}