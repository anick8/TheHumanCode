export const GUESS_COOLDOWN_MS = 2000

// Milliseconds until the next Guess is allowed (0 = ready). The server enforces the same 2s.
export function cooldownLeft(lastGuessAt, now, cooldownMs = GUESS_COOLDOWN_MS) {
  if (lastGuessAt == null) return 0
  return Math.min(cooldownMs, Math.max(0, lastGuessAt + cooldownMs - now))
}

// Letter blanks from the public word_pattern ("__ _-_"): an array of words, each an array of marks.
// Null when the Round exposes no pattern (the Word stays hidden until reveal).
export function blankWords(pattern) {
  if (typeof pattern !== 'string' || !pattern.trim()) return null
  return pattern.trim().split(/\s+/).map((w) => Array.from(w))
}

// Whole seconds left on a deadline (ISO string), never negative.
export function secondsLeft(deadline, now) {
  if (!deadline) return 0
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000))
}
