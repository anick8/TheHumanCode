'use client'

import { tiedScores, tieNote } from '@/lib/tiebreak'

// Reusable ranked leaderboard for scored quizzes. Pure display: it renders
// whatever rows it's given (already ranked by the caller). `currentId`
// highlights the viewer's own row; `podium` collapses to a top-3 reveal for
// the final "winners" moment instead of a long list.
export default function Leaderboard({
  entries = [],
  currentId = null,
  podium = false,
  revealed = 3,
  size = 'compact',
  total = entries.length,
}) {
  const ranked = entries
  const tied = tiedScores(ranked)
  if (podium) {
    const top = ranked.slice(0, 3)
    const stage = size === 'stage'
    // Reveal order is 3rd, 2nd, 1st; with fewer players the empty places are skipped.
    const order = [2, 1, 0].filter((slot) => top[slot])
    const shown = new Set(order.slice(0, revealed))
    const look = [
      { h: stage ? 'h-56' : 'h-32', tone: 'text-amber-300 border-amber-300/50 from-amber-300/25' },
      { h: stage ? 'h-40' : 'h-24', tone: 'text-slate-300 border-slate-300/40 from-slate-300/20' },
      { h: stage ? 'h-28' : 'h-16', tone: 'text-amber-600 border-amber-600/50 from-amber-600/20' },
    ]
    return (
      <div className={`mx-auto w-full ${stage ? 'max-w-3xl' : 'max-w-md'}`}>
        <div className={`flex items-end justify-center ${stage ? 'gap-4' : 'gap-2'}`}>
          {[1, 0, 2].map((slot) => {
            const p = top[slot]
            const on = shown.has(slot)
            const isSelf = p && currentId && p.participant_id === currentId
            const note = on && p && tieNote(tied, p.score, p.total_response_ms)
            return (
              <div key={slot} className="flex min-w-0 flex-1 flex-col items-center">
                <div
                  className={`podium-name mb-3 flex w-full flex-col items-center text-center ${on ? 'is-on' : ''}`}
                  style={{ minHeight: stage ? '5.5rem' : '3.5rem' }}
                  aria-hidden={!on}
                >
                  {p && (
                    <>
                      <span className={`w-full break-words font-bold leading-tight text-foreground line-clamp-2 ${stage ? (slot === 0 ? 'text-4xl' : 'text-2xl') : 'text-sm'}`}>
                        {p.display_name}
                        {isSelf && <span className="ml-1 text-xs font-normal text-accent">(you)</span>}
                      </span>
                      <span className={`font-display tabular-nums text-accent ${stage ? 'mt-1 text-2xl' : 'text-sm'}`}>{p.score} pts</span>
                      {note && <span className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{note}</span>}
                    </>
                  )}
                </div>
                <div
                  className={`podium-step flex w-full justify-center rounded-t-2xl border border-b-0 bg-gradient-to-b to-transparent pt-3 ${look[slot].h} ${look[slot].tone} ${on ? 'is-on' : ''}`}
                >
                  <span className={`font-display font-bold leading-none ${stage ? 'text-6xl' : 'text-3xl'}`}>{p?.rank ?? slot + 1}</span>
                </div>
              </div>
            )
          })}
        </div>
        <div className="h-px w-full bg-border" />
        {top.length === 0 && <p className="mt-4 text-center text-muted-foreground">No participants yet.</p>}
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
        const place = p.rank ?? i + 1
        const note = tieNote(tied, p.score, p.total_response_ms)
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
              <span className="min-w-0">
                <span className="block truncate font-medium text-foreground">
                  {p.display_name}
                  {isSelf && <span className="ml-2 text-xs font-normal text-accent">(you)</span>}
                </span>
                {note && <span className="block truncate text-xs text-muted-foreground">{note}</span>}
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