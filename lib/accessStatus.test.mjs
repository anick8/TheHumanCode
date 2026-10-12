import test from 'node:test'
import assert from 'node:assert/strict'
import { describeAccess, accessStateOf } from './accessStatus.js'

const NOW = new Date('2026-11-10T12:00:00Z')
const opts = { now: NOW, timeZone: 'UTC', locale: 'en-US' }
const row = (over) => ({ state: 'active', starts_at: null, expires_at: null, ai_used: 0, ai_allowance: null, ...over })

test('admin is never read-only and shows no date or banner', () => {
  const a = describeAccess(row({ state: 'admin' }), opts)
  assert.equal(a.readOnly, false)
  assert.equal(a.untilLabel, null)
  assert.equal(a.banner, null)
})

test('active with a far expiry shows the date and no banner', () => {
  const a = describeAccess(row({ expires_at: '2026-12-25T00:00:00Z' }), opts)
  assert.equal(a.readOnly, false)
  assert.equal(a.untilLabel, 'Access until Dec 25, 2026')
  assert.equal(a.banner, null)
})

test('active with no expiry omits the date', () => {
  const a = describeAccess(row({ expires_at: null }), opts)
  assert.equal(a.untilLabel, null)
  assert.equal(a.banner, null)
})

test('banner appears at 3 days or fewer and not at 4', () => {
  const three = describeAccess(row({ expires_at: '2026-11-13T12:00:00Z' }), opts)
  assert.equal(three.daysLeft, 3)
  assert.equal(three.banner.kind, 'expiring')
  assert.match(three.banner.message, /3 days/)
  const four = describeAccess(row({ expires_at: '2026-11-14T12:00:00Z' }), opts)
  assert.equal(four.daysLeft, 4)
  assert.equal(four.banner, null)
})

test('part of a day remaining counts as 1 day', () => {
  const a = describeAccess(row({ expires_at: '2026-11-10T20:00:00Z' }), opts)
  assert.equal(a.daysLeft, 1)
  assert.match(a.banner.message, /1 day\b/)
})

test('in grace (active but past expiry) is still writable with a renew banner', () => {
  const a = describeAccess(row({ expires_at: '2026-11-09T12:00:00Z' }), opts)
  assert.equal(a.readOnly, false)
  assert.equal(a.daysLeft, 0)
  assert.equal(a.banner.kind, 'expiring')
  assert.match(a.banner.message, /few hours left/)
  assert.doesNotMatch(a.banner.message, /^Your access period has ended\. Contact/)
})

test('accessStateOf reads an array of rows, a single row, or nothing', () => {
  assert.equal(accessStateOf([{ state: 'active' }]), 'active')
  assert.equal(accessStateOf({ state: 'expired' }), 'expired')
  assert.equal(accessStateOf([]), null)
  assert.equal(accessStateOf(null), null)
})

test('expired is read-only with a renew message', () => {
  const a = describeAccess(row({ state: 'expired', expires_at: '2026-11-01T00:00:00Z' }), opts)
  assert.equal(a.readOnly, true)
  assert.equal(a.banner.kind, 'expired')
  assert.match(a.banner.message, /Access expired, contact us to renew/)
})

test('revoked says access was withdrawn', () => {
  const a = describeAccess(row({ state: 'revoked' }), opts)
  assert.equal(a.readOnly, true)
  assert.equal(a.banner.kind, 'revoked')
  assert.match(a.banner.message, /withdrawn/)
})

test('upcoming is read-only and says when access starts', () => {
  const a = describeAccess(row({ state: 'upcoming', starts_at: '2026-11-20T00:00:00Z' }), opts)
  assert.equal(a.readOnly, true)
  assert.equal(a.banner.kind, 'upcoming')
  assert.match(a.banner.message, /Nov 20, 2026/)
})

test('none and missing rows are read-only without a banner', () => {
  assert.equal(describeAccess(row({ state: 'none' }), opts).readOnly, true)
  const missing = describeAccess(null, opts)
  assert.equal(missing.readOnly, true)
  assert.equal(missing.banner, null)
})
