'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

const th = 'px-4 py-3.5 text-left text-sm font-semibold text-foreground'
const td = 'px-4 py-4 text-sm text-foreground'

// Organizer results for Pictionary: one row per revealed Round, then the final
// Leaderboard. Read-only, so it needs no Lapsed-Organizer branch; polls so an
// in-progress game fills in.
export default function PictionaryResults({ sessionId }) {
  const [supabase] = useState(() => createClient())
  const [rounds, setRounds] = useState(null)
  const [board, setBoard] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    let live = true
    const load = async () => {
      const [r, b] = await Promise.all([
        supabase.rpc('get_pictionary_results', { p_session_id: sessionId }),
        supabase.rpc('get_pictionary_leaderboard', { p_session_id: sessionId }),
      ])
      if (!live) return
      if (r.error || b.error) return setError((r.error || b.error).message)
      setError(null)
      setRounds(r.data || [])
      setBoard(b.data || [])
    }
    load()
    const t = setInterval(load, 5000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [sessionId, supabase])

  if (error) return <p className="text-destructive">Could not load results: {error}</p>
  if (!rounds) return <p className="text-muted-foreground">Loading…</p>

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-border bg-card p-8 shadow-lg">
        <h2 className="mb-6 font-display text-2xl font-bold text-foreground">Rounds</h2>
        {rounds.length === 0 ? (
          <p className="text-muted-foreground">No Rounds have finished yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead>
                <tr>
                  <th className={th}>#</th>
                  <th className={th}>Word</th>
                  <th className={th}>Drawer</th>
                  <th className={th}>Winner</th>
                  <th className={th}>Time to guess</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rounds.map((r) => (
                  <tr key={r.round_number}>
                    <td className={`${td} font-bold text-accent`}>{r.round_number}</td>
                    <td className={`${td} font-semibold`}>{r.word}</td>
                    <td className={td}>{r.drawer_name || '—'}</td>
                    <td className={td}>
                      {r.winner_name ? (
                        <>
                          {r.winner_name} <span className="text-muted-foreground">(+{r.winner_points})</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Nobody</span>
                      )}
                    </td>
                    <td className={td}>
                      {r.seconds_to_guess == null ? '—' : `${Number(r.seconds_to_guess).toFixed(1)}s`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-card p-8 shadow-lg">
        <h2 className="mb-6 font-display text-2xl font-bold text-foreground">Leaderboard</h2>
        {board.length === 0 ? (
          <p className="text-muted-foreground">No one has joined yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead>
                <tr>
                  <th className={th}>#</th>
                  <th className={th}>Participant</th>
                  <th className={th}>Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {board.map((p) => (
                  <tr key={p.participant_id} className={Number(p.rank) === 1 ? 'bg-amber-400/5' : ''}>
                    <td className={`${td} font-bold text-accent`}>{Number(p.rank)}</td>
                    <td className={td}>{p.display_name}</td>
                    <td className={`${td} font-bold`}>{p.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
