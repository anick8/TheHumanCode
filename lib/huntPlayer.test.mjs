import test from 'node:test'
import assert from 'node:assert/strict'
import { screenFor, clockOffset, clockLabel, formatClock, safeNext, progressLabel, ordinal } from './huntPlayer.js'

test('screenFor: no status yet is loading', () => {
  assert.equal(screenFor(null), 'loading')
})

test('screenFor: unseen token joins while the hunt has not started, else joining is closed', () => {
  assert.equal(screenFor({ approval_status: 'unknown', hunt_state: 'not_started' }), 'join')
  assert.equal(screenFor({ approval_status: 'unknown', hunt_state: 'running' }), 'closed')
  assert.equal(screenFor({ approval_status: 'unknown', hunt_state: 'over' }), 'closed')
})

test('screenFor: pending, approved and rejected players', () => {
  assert.equal(screenFor({ approval_status: 'pending', hunt_state: 'not_started' }), 'pending')
  assert.equal(screenFor({ approval_status: 'pending', hunt_state: 'running' }), 'closed')
  assert.equal(screenFor({ approval_status: 'approved', hunt_state: 'not_started' }), 'waiting')
  assert.equal(screenFor({ approval_status: 'approved', hunt_state: 'running' }), 'running')
  assert.equal(screenFor({ approval_status: 'approved', hunt_state: 'over' }), 'over')
  assert.equal(screenFor({ approval_status: 'rejected', hunt_state: 'running' }), 'removed')
})

test('formatClock', () => {
  assert.equal(formatClock(0), '0:00')
  assert.equal(formatClock(65_000), '1:05')
  assert.equal(formatClock(3_725_000), '1:02:05')
  assert.equal(formatClock(-5000), '0:00')
})

test('clock is corrected with server_now', () => {
  const offset = clockOffset('2026-10-16T12:00:00Z', Date.parse('2026-10-16T12:00:10Z'))
  assert.equal(offset, -10_000)
  const st = { hunt_started_at: '2026-10-16T11:50:00Z', hunt_ends_at: '2026-10-16T12:30:00Z' }
  // device clock says 12:00:30, server says 12:00:20 -> 29m40s left
  assert.deepEqual(clockLabel(st, Date.parse('2026-10-16T12:00:30Z'), offset), { kind: 'remaining', text: '29:40' })
  const open = { hunt_started_at: '2026-10-16T11:50:00Z', hunt_ends_at: null }
  assert.deepEqual(clockLabel(open, Date.parse('2026-10-16T12:00:30Z'), offset), { kind: 'elapsed', text: '10:20' })
})

test('safeNext only allows clue paths', () => {
  assert.equal(safeNext('/h/abc123'), '/h/abc123')
  assert.equal(safeNext('//evil.com'), null)
  assert.equal(safeNext('https://evil.com'), null)
  assert.equal(safeNext('/dashboard'), null)
  assert.equal(safeNext(null), null)
})

test('progressLabel and ordinal', () => {
  assert.equal(progressLabel(2, 7), '2 of 7 clues found')
  assert.equal(progressLabel(1, 1), '1 of 1 clue found')
  assert.equal(ordinal(1), '1st')
  assert.equal(ordinal(2), '2nd')
  assert.equal(ordinal(3), '3rd')
  assert.equal(ordinal(11), '11th')
  assert.equal(ordinal(22), '22nd')
})

test('joinFailure maps a failed join by hunt state, not error text', async () => {
  const { joinFailure } = await import('./huntPlayer.js')
  assert.deepEqual(joinFailure({ hunt_state: 'running' }, 'whatever'), { kind: 'closed' })
  assert.deepEqual(joinFailure({ hunt_state: 'over' }, 'boom'), { kind: 'closed' })
  assert.deepEqual(joinFailure({ hunt_state: 'not_started' }, 'This session is full'), {
    kind: 'error',
    message: 'This session is full',
  })
  assert.deepEqual(joinFailure(null, ''), { kind: 'error', message: 'Could not join. Please try again.' })
})
