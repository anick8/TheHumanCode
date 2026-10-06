// Helpers for explaining a Quiz Leaderboard tie. Participants who share a Score
// are ordered by cumulative Response time; the time is shown only for them.

// 41234 -> "41.2s"
export function formatResponseTime(ms) {
  return `${(Number(ms) / 1000).toFixed(1)}s`
}

// Scores that more than one entry shares.
export function tiedScores(entries, scoreOf = (e) => e.score) {
  const seen = new Set()
  const tied = new Set()
  for (const entry of entries) {
    const score = scoreOf(entry)
    if (seen.has(score)) tied.add(score)
    seen.add(score)
  }
  return tied
}

// "tie broken by time · 41.2s" for an entry whose Score is shared, else null.
// Nothing shows until a question has been revealed: before then every
// cumulative time is 0, and "tied at 0.0s" would explain nothing.
export function tieNote(tied, score, totalResponseMs) {
  if (!tied.has(score) || !(Number(totalResponseMs) > 0)) return null
  return `tie broken by time · ${formatResponseTime(totalResponseMs)}`
}
