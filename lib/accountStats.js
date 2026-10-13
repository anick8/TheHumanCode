// Pure helpers for the Account page: shaping the account_stats() payload,
// wording, the access-window meter and the data export. No React, no network,
// so it can be checked with `node --test`.

import { DAY_MS } from './grantDates.js'

export const TYPE_ORDER = ['poll', 'quiz', 'wheel', 'treasure_hunt', 'comments']

const TYPE_LABELS = {
  poll: { one: 'poll', many: 'polls', title: 'Voting poll' },
  quiz: { one: 'quiz', many: 'quizzes', title: 'Quiz' },
  wheel: { one: 'wheel', many: 'wheels', title: 'Wheel' },
  treasure_hunt: { one: 'treasure hunt', many: 'treasure hunts', title: 'Treasure hunt' },
  comments: { one: 'comments board', many: 'comments boards', title: 'Image & comments' },
}

export function typeTitle(type) {
  return TYPE_LABELS[type]?.title ?? type
}

export function typeCount(type, n) {
  const l = TYPE_LABELS[type]
  return `${n} ${l ? (n === 1 ? l.one : l.many) : type}`
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

/** account_stats() payload with every field present, whatever the server sent. */
export function normalizeStats(raw) {
  const t = raw?.totals ?? {}
  const byType = {}
  for (const [k, v] of Object.entries(t.by_type ?? {})) byType[k] = num(v)
  const weekly = Array.isArray(raw?.weekly)
    ? raw.weekly.map((w) => ({ weekStart: w.week_start, responses: num(w.responses) }))
    : []
  const top = Array.isArray(raw?.top_sessions)
    ? raw.top_sessions.map((s) => ({
        id: s.id,
        title: s.title || 'Untitled session',
        slug: s.slug,
        type: s.session_type,
        responses: num(s.responses),
        people: num(s.people),
        lastActivityAt: s.last_activity_at ?? null,
      }))
    : []
  return {
    totals: {
      sessions: num(t.sessions),
      byType,
      questions: num(t.questions),
      votes: num(t.votes),
      comments: num(t.comments),
      responses: num(t.responses),
      people: num(t.people),
      participants: num(t.participants),
      anonymousVoters: num(t.anonymous_voters),
      wheelSpins: num(t.wheel_spins),
      sessionsRun: num(t.sessions_run),
      lastActivityAt: t.last_activity_at ?? null,
    },
    weekly,
    top,
  }
}

/** Types present, in dashboard order, with unknown ones after. */
export function typeBreakdown(byType) {
  const present = Object.keys(byType).filter((k) => byType[k] > 0)
  const ordered = [
    ...TYPE_ORDER.filter((t) => present.includes(t)),
    ...present.filter((t) => !TYPE_ORDER.includes(t)),
  ]
  return ordered.map((type) => ({ type, count: byType[type] }))
}

/** "3 polls, 1 quiz" - the ledger's sub-line for Sessions. */
export function typeSummary(byType, max = 3) {
  const parts = typeBreakdown(byType).map((b) => typeCount(b.type, b.count))
  if (parts.length === 0) return 'None yet'
  return parts.length > max ? `${parts.slice(0, max).join(', ')} +${parts.length - max} more` : parts.join(', ')
}

/** "Mon 12 Oct" for a 'YYYY-MM-DD' week start (UTC-stable, no timezone shift). */
export function weekLabel(day, locale) {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`)
  )
}

/** "just now", "2 hours ago", "3 days ago", else the date. */
export function relativeTime(iso, { now = new Date(), locale } = {}) {
  if (!iso) return null
  const then = new Date(iso)
  const ms = now.getTime() - then.getTime()
  if (!Number.isFinite(ms)) return null
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} ${min === 1 ? 'minute' : 'minutes'} ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ${hr === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(ms / DAY_MS)
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(then)
}

/**
 * Where "now" sits between a Grant's start and end, for the Plan meter.
 * null when there is no end (Super admin, open-ended Grant) or no start.
 */
export function accessProgress(row, now = new Date()) {
  if (!row?.starts_at || !row?.expires_at) return null
  const start = new Date(row.starts_at).getTime()
  const end = new Date(row.expires_at).getTime()
  if (!(end > start)) return null
  const pct = ((now.getTime() - start) / (end - start)) * 100
  return Math.min(100, Math.max(0, Math.round(pct)))
}

/** How full the AI meter is, 0-100, or null when the allowance is unlimited. */
export function allowanceUsage(row) {
  const allowance = row?.ai_allowance
  if (allowance === null || allowance === undefined) return null
  const used = num(row.ai_used)
  if (allowance <= 0) return { used, allowance, left: 0, pct: 100 }
  return {
    used,
    allowance,
    left: Math.max(allowance - used, 0),
    pct: Math.min(100, Math.round((used / allowance) * 100)),
  }
}

/** Name shown for the account: display name, else the part of the email before @. */
export function displayNameOf(user) {
  const name = String(user?.user_metadata?.display_name ?? '').trim()
  if (name) return name
  return String(user?.email ?? '').split('@')[0] || 'Account'
}

export function initialOf(user) {
  return displayNameOf(user).charAt(0).toUpperCase() || '?'
}

// ----- export ----------------------------------------------------------------

// A cell starting with = + - @ is read as a formula by spreadsheets; session
// titles are user text, so neutralise them before they land in a CSV.
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(columns, rows) {
  const head = columns.map((c) => csvCell(c.label)).join(',')
  const body = rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(','))
  return [head, ...body].join('\r\n') + '\r\n'
}

export const SESSION_CSV_COLUMNS = [
  { key: 'title', label: 'Title' },
  { key: 'type', label: 'Type' },
  { key: 'slug', label: 'Slug' },
  { key: 'active', label: 'Active' },
  { key: 'questions', label: 'Questions' },
  { key: 'created_at', label: 'Created' },
]

/** One flat row per session for the CSV, from sessions + their question counts. */
export function sessionRows(sessions, questionCounts = {}) {
  return sessions.map((s) => ({
    title: s.title,
    type: typeTitle(s.session_type),
    slug: s.slug,
    active: s.is_active ? 'yes' : 'no',
    questions: questionCounts[s.id] ?? 0,
    created_at: s.created_at,
  }))
}

// ----- plan chip ---------------------------------------------------------------

/**
 * Short state wording for the Account header and Plan card, from a
 * describeAccess() result. `live` is true when editing and presenting work.
 */
export function accessChip(access) {
  switch (access.state) {
    case 'admin':
      return { label: 'Super admin', live: true }
    case 'active':
      return access.banner?.kind === 'expiring'
        ? { label: 'Ending soon', live: true }
        : { label: 'Active', live: true }
    case 'upcoming':
      return { label: 'Starts soon', live: false }
    case 'expired':
      return { label: 'Expired', live: false }
    case 'revoked':
      return { label: 'Withdrawn', live: false }
    default:
      return { label: 'No access', live: false }
  }
}
