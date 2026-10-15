// Pure helpers for the hunt player join page (app/hunt/[slug]).

// Maps a get_hunt_status row to the screen the player sees.
export function screenFor(status) {
  if (!status) return 'loading'
  const { approval_status: approval, hunt_state: state } = status
  if (approval === 'rejected') return 'removed'
  if (approval === 'unknown') return state === 'not_started' ? 'join' : 'closed'
  if (approval === 'pending') return state === 'not_started' ? 'pending' : 'closed'
  if (approval === 'approved') {
    if (state === 'running') return 'running'
    if (state === 'over') return 'over'
    return 'waiting'
  }
  return 'loading'
}

// serverNow (ISO) and the device time at which it was received -> ms to add to Date.now().
export function clockOffset(serverNowIso, deviceNowMs) {
  const t = Date.parse(serverNowIso)
  return Number.isNaN(t) ? 0 : t - deviceNowMs
}

export function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const ss = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

// Countdown when the hunt has a time limit, otherwise time elapsed.
export function clockLabel(status, deviceNowMs, offset = 0) {
  const now = deviceNowMs + offset
  if (status.hunt_ends_at) {
    return { kind: 'remaining', text: formatClock(Date.parse(status.hunt_ends_at) - now) }
  }
  return { kind: 'elapsed', text: formatClock(now - Date.parse(status.hunt_started_at)) }
}

// ?next= is only honoured for clue pages on this site.
export function safeNext(next) {
  if (typeof next !== 'string') return null
  return /^\/h\/[A-Za-z0-9_-]+$/.test(next) ? next : null
}

export function progressLabel(found, total) {
  return `${found} of ${total} clue${total === 1 ? '' : 's'} found`
}

export function ordinal(n) {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'
  return `${n}${suffix}`
}
