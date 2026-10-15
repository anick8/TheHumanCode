// Pure helpers for the organizer "Run hunt" page: clock text, board
// splitting and the CSV export. No React or Supabase in here.

import { formatClock } from './huntPlayer.js'

// m:ss or h:mm:ss, clamping negatives. Shared with the player page.
export const formatDuration = formatClock

// hunt: { started_at, ends_at, stopped_at } (ISO strings or null).
// now: ISO string or ms, already corrected to server time by the caller.
export function huntClock(hunt, now) {
  const nowMs = typeof now === 'number' ? now : Date.parse(now)
  if (!hunt?.started_at) return { state: 'not_started', label: '0:00' }
  const start = Date.parse(hunt.started_at)
  const end = hunt.ends_at ? Date.parse(hunt.ends_at) : null
  const stopped = hunt.stopped_at ? Date.parse(hunt.stopped_at) : null
  const countdown = end !== null
  if (stopped !== null && (end === null || stopped <= end)) {
    return { state: 'over', label: formatDuration(stopped - start), countdown }
  }
  if (countdown && nowMs >= end) return { state: 'over', label: formatDuration(0), countdown }
  return {
    state: 'running',
    label: formatDuration(countdown ? end - nowMs : nowMs - start),
    countdown,
  }
}

export function splitBoard(rows) {
  const list = rows || []
  const pending = list.filter((r) => r.approval_status === 'pending')
  const approved = list
    .filter((r) => r.approval_status === 'approved')
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
  return { pending, approved }
}

function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// clueNumbers: ordered list of clue numbers (1-based) that become columns.
// Times are shown as elapsed time since the hunt start.
export function buildHuntCsv(rows, clueNumbers, startedAt) {
  const start = startedAt ? Date.parse(startedAt) : null
  const since = (iso) => (iso && start !== null ? formatDuration(Date.parse(iso) - start) : '')
  const header = ['Rank', 'Name', 'Clues found', 'Last scan']
  for (const n of clueNumbers) header.push(`Clue ${n} scan`, `Clue ${n} pick`)
  const lines = [header]
  for (const r of splitBoard(rows).approved) {
    const line = [r.rank, r.name, r.clues_found ?? 0, since(r.last_scan_at)]
    for (const n of clueNumbers) {
      const scan = (r.scans || []).find((s) => s.clue_number === n)
      line.push(scan ? since(scan.scanned_at) : '', scan?.picked_label ?? '')
    }
    lines.push(line)
  }
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
