import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeStats,
  typeSummary,
  typeBreakdown,
  relativeTime,
  accessProgress,
  allowanceUsage,
  displayNameOf,
  initialOf,
  toCsv,
  weekLabel,
  sessionRows,
} from './accountStats.js'

test('normalizeStats fills every field from an empty or missing payload', () => {
  for (const raw of [null, undefined, {}]) {
    const s = normalizeStats(raw)
    assert.equal(s.totals.sessions, 0)
    assert.equal(s.totals.responses, 0)
    assert.deepEqual(s.totals.byType, {})
    assert.deepEqual(s.weekly, [])
    assert.deepEqual(s.top, [])
    assert.equal(s.totals.lastActivityAt, null)
  }
})

test('normalizeStats maps the RPC shape and coerces numbers', () => {
  const s = normalizeStats({
    totals: { sessions: '4', by_type: { poll: 3, quiz: 1 }, responses: 120, people: 40, last_activity_at: '2026-10-01T00:00:00Z' },
    weekly: [{ week_start: '2026-10-05', responses: 7 }],
    top_sessions: [{ id: 'a', title: '', slug: 'x', session_type: 'poll', responses: 9, people: 5, last_activity_at: null }],
  })
  assert.equal(s.totals.sessions, 4)
  assert.equal(s.totals.people, 40)
  assert.deepEqual(s.weekly, [{ weekStart: '2026-10-05', responses: 7 }])
  assert.equal(s.top[0].title, 'Untitled session')
})

test('typeBreakdown follows dashboard order and keeps unknown types last', () => {
  const b = typeBreakdown({ comments: 1, quiz: 2, mystery: 1, poll: 0 })
  assert.deepEqual(b.map((x) => x.type), ['quiz', 'comments', 'mystery'])
})

test('typeSummary pluralises and truncates', () => {
  assert.equal(typeSummary({}), 'None yet')
  assert.equal(typeSummary({ poll: 1, quiz: 2 }), '1 poll, 2 quizzes')
  assert.equal(
    typeSummary({ poll: 1, quiz: 1, wheel: 1, comments: 1 }),
    '1 poll, 1 quiz, 1 wheel +1 more'
  )
})

test('weekLabel does not shift across timezones', () => {
  assert.equal(weekLabel('2026-10-05', 'en-US'), 'Oct 5')
})

test('relativeTime words recent and older instants', () => {
  const now = new Date('2026-10-13T12:00:00Z')
  assert.equal(relativeTime(null, { now }), null)
  assert.equal(relativeTime('2026-10-13T11:59:30Z', { now }), 'just now')
  assert.equal(relativeTime('2026-10-13T10:00:00Z', { now }), '2 hours ago')
  assert.equal(relativeTime('2026-10-12T11:00:00Z', { now }), '1 day ago')
  assert.equal(relativeTime('2026-07-01T00:00:00Z', { now, locale: 'en-US' }), 'Jul 1, 2026')
})

test('accessProgress is a clamped percentage and null without an end', () => {
  const row = { starts_at: '2026-10-01T00:00:00Z', expires_at: '2026-10-11T00:00:00Z' }
  assert.equal(accessProgress(row, new Date('2026-10-06T00:00:00Z')), 50)
  assert.equal(accessProgress(row, new Date('2026-09-01T00:00:00Z')), 0)
  assert.equal(accessProgress(row, new Date('2026-12-01T00:00:00Z')), 100)
  assert.equal(accessProgress({ starts_at: row.starts_at, expires_at: null }), null)
  assert.equal(accessProgress(null), null)
})

test('allowanceUsage is null when unlimited and never negative past the cap', () => {
  assert.equal(allowanceUsage({ ai_allowance: null, ai_used: 5 }), null)
  assert.deepEqual(allowanceUsage({ ai_allowance: 10, ai_used: 4 }), { used: 4, allowance: 10, left: 6, pct: 40 })
  const over = allowanceUsage({ ai_allowance: 3, ai_used: 5 })
  assert.equal(over.left, 0)
  assert.equal(over.pct, 100)
})

test('displayNameOf prefers the display name, then the email local part', () => {
  assert.equal(displayNameOf({ email: 'ada@x.io', user_metadata: { display_name: ' Ada L ' } }), 'Ada L')
  assert.equal(displayNameOf({ email: 'ada@x.io', user_metadata: {} }), 'ada')
  assert.equal(initialOf({ email: 'ada@x.io' }), 'A')
  assert.equal(displayNameOf(null), 'Account')
})

test('toCsv quotes, escapes quotes and neutralises formulas', () => {
  const csv = toCsv(
    [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
    [{ a: 'plain', b: 'with, comma' }, { a: 'say "hi"', b: '=SUM(A1)' }, { a: null, b: 'line\nbreak' }]
  )
  assert.equal(
    csv,
    'A,B\r\nplain,"with, comma"\r\n"say ""hi""",\'=SUM(A1)\r\n,"line\nbreak"\r\n'
  )
})

test('sessionRows flattens sessions with their question counts', () => {
  const rows = sessionRows(
    [{ id: 's1', title: 'T', session_type: 'quiz', slug: 'abc', is_active: true, created_at: '2026-10-01T00:00:00Z' }],
    { s1: 4 }
  )
  assert.deepEqual(rows, [
    { title: 'T', type: 'Quiz', slug: 'abc', active: 'yes', questions: 4, created_at: '2026-10-01T00:00:00Z' },
  ])
})

import { accessChip } from './accountStats.js'
import { describeAccess } from './accessStatus.js'

test('accessChip words each access state and whether the account is live', () => {
  const now = new Date('2026-11-10T12:00:00Z')
  const chip = (row) => accessChip(describeAccess(row, { now, timeZone: 'UTC', locale: 'en-US' }))
  assert.deepEqual(chip({ state: 'admin' }), { label: 'Super admin', live: true })
  assert.deepEqual(chip({ state: 'active', expires_at: '2026-12-25T00:00:00Z' }), { label: 'Active', live: true })
  assert.deepEqual(chip({ state: 'active', expires_at: '2026-11-12T00:00:00Z' }), { label: 'Ending soon', live: true })
  assert.deepEqual(chip({ state: 'expired' }), { label: 'Expired', live: false })
  assert.deepEqual(chip({ state: 'revoked' }), { label: 'Withdrawn', live: false })
  assert.deepEqual(chip({ state: 'upcoming', starts_at: '2026-12-01T00:00:00Z' }), { label: 'Starts soon', live: false })
})
