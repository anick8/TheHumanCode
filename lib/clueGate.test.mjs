// Run with: node --test lib/clueGate.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { gateScreen, joinRequiredAction, huntPlayerKey, POLL_MS } from './clueGate.js'

test('player token key is per session', () => {
  assert.equal(huntPlayerKey('abc'), 'hunt_player:abc')
})

test('pending shows the waiting screen and polls', () => {
  const s = gateScreen('pending')
  assert.equal(s.title, 'Waiting for the organizer to let you in')
  assert.equal(s.poll, true)
})

test('not_started shows the not-started screen and polls', () => {
  const s = gateScreen('not_started')
  assert.equal(s.title, "The hunt hasn't started yet")
  assert.equal(s.poll, true)
})

test('over links back to the join page and does not poll', () => {
  const s = gateScreen('over')
  assert.equal(s.title, 'The hunt is over')
  assert.equal(s.poll, false)
  assert.equal(s.joinLink, true)
})

test('removed screen', () => {
  const s = gateScreen('removed')
  assert.equal(s.title, 'You were removed from this hunt')
  assert.equal(s.poll, false)
})

test('statuses without a gate screen return null', () => {
  for (const st of ['live', 'closed', 'not_live', 'missing', 'join_required']) {
    assert.equal(gateScreen(st), null)
  }
})

test('join_required with a stored token refetches with it', () => {
  assert.deepEqual(joinRequiredAction({ storedToken: 'p_x', sessionSlug: 'ab', currentPath: '/h/t1' }), {
    action: 'refetch',
    token: 'p_x',
  })
})

test('join_required without a token redirects to the join page with next', () => {
  assert.deepEqual(joinRequiredAction({ storedToken: null, sessionSlug: 'ab', currentPath: '/h/t 1' }), {
    action: 'redirect',
    href: '/hunt/ab?next=%2Fh%2Ft%201',
  })
})

test('join_required without a slug cannot redirect', () => {
  assert.equal(joinRequiredAction({ storedToken: null, sessionSlug: null, currentPath: '/h/t' }).action, 'missing')
})

test('poll interval is 4 seconds', () => {
  assert.equal(POLL_MS, 4000)
})
