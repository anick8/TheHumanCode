// Day semantics for Grants. The admin picks whole days; India time (UTC+5:30,
// no DST) is the reference so a rental "until 14 Nov" covers all of 14 Nov
// there. Pure and dependency-free so it can be checked with `node --test`.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
export const DAY_MS = 24 * 60 * 60 * 1000
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

function assertDay(day) {
  if (!DAY_RE.test(day)) throw new Error(`Invalid day: ${day}`)
}

function dayStartMs(day) {
  assertDay(day)
  return Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS
}

/** 'YYYY-MM-DD' calendar day in India for an instant. */
export function istDay(date = new Date()) {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/** Calendar-day arithmetic on a 'YYYY-MM-DD' string. */
export function addDays(day, n) {
  assertDay(day)
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 00:00 India time on the day, as an ISO instant. */
export function startOfDayIst(day) {
  return new Date(dayStartMs(day)).toISOString()
}

/** End of the day in India time (23:59, to the last millisecond), as an ISO instant. */
export function endOfDayIst(day) {
  return new Date(dayStartMs(day) + DAY_MS - 1).toISOString()
}

/** Start day -> starts_at. Today (or earlier) means access begins now. */
export function startsAtForDay(day, now = new Date()) {
  const start = dayStartMs(day)
  return start <= now.getTime() ? now.toISOString() : new Date(start).toISOString()
}

/**
 * Renewing moves starts_at to the renewal moment so the AI allowance window
 * (counted from starts_at) restarts. A Grant that has not started yet keeps
 * its future start.
 */
export function renewalStartsAt(currentStartsAt, now = new Date()) {
  const current = currentStartsAt ? new Date(currentStartsAt).getTime() : 0
  return current > now.getTime() ? new Date(current).toISOString() : now.toISOString()
}
