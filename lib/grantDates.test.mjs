import test from 'node:test'
import assert from 'node:assert/strict'
import {
  istDay,
  addDays,
  startOfDayIst,
  endOfDayIst,
  startsAtForDay,
  renewalStartsAt,
} from './grantDates.js'

test('istDay gives the India calendar day of an instant', () => {
  // 2026-11-13 19:00 UTC is 00:30 on the 14th in India.
  assert.equal(istDay(new Date('2026-11-13T19:00:00Z')), '2026-11-14')
  assert.equal(istDay(new Date('2026-11-13T18:29:59Z')), '2026-11-13')
})

test('addDays walks calendar days across month and year ends', () => {
  assert.equal(addDays('2026-11-14', 7), '2026-11-21')
  assert.equal(addDays('2026-12-25', 30), '2027-01-24')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
})

test('start day is 00:00 IST, end day is 23:59 IST', () => {
  assert.equal(startOfDayIst('2026-11-14'), '2026-11-13T18:30:00.000Z')
  assert.equal(endOfDayIst('2026-11-14'), '2026-11-14T18:29:59.999Z')
})

test('a start of today means now, a future day means 00:00 IST', () => {
  const now = new Date('2026-11-14T08:00:00Z') // 13:30 IST on the 14th
  assert.equal(startsAtForDay('2026-11-14', now), now.toISOString())
  assert.equal(startsAtForDay('2026-11-15', now), '2026-11-14T18:30:00.000Z')
})

test('renewal restarts the window at now unless the grant has not started', () => {
  const now = new Date('2026-11-14T08:00:00Z')
  assert.equal(renewalStartsAt('2026-10-01T00:00:00Z', now), now.toISOString())
  assert.equal(renewalStartsAt('2026-12-01T00:00:00Z', now), '2026-12-01T00:00:00.000Z')
})
