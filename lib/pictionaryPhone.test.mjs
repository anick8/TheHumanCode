import test from 'node:test'
import assert from 'node:assert/strict'
import { cooldownLeft, blankWords, secondsLeft } from './pictionaryPhone.js'

test('cooldown counts down from 2s and is zero before the first guess', () => {
  assert.equal(cooldownLeft(null, 5000), 0)
  assert.equal(cooldownLeft(1000, 1000), 2000)
  assert.equal(cooldownLeft(1000, 2500), 500)
  assert.equal(cooldownLeft(1000, 3000), 0)
  assert.equal(cooldownLeft(1000, 900), 2000) // clock jitter never exceeds the cooldown
})

test('blanks keep word gaps and ignore missing patterns', () => {
  assert.deepEqual(blankWords('ab cde'), [['_', '_'], ['_', '_', '_']])
  assert.deepEqual(blankWords('_-_'), [['_', '-', '_']])
  assert.equal(blankWords(null), null)
  assert.equal(blankWords('  '), null)
})

test('secondsLeft rounds up and floors at zero', () => {
  const now = Date.parse('2026-01-01T00:00:00Z')
  assert.equal(secondsLeft('2026-01-01T00:00:01.2Z', now), 2)
  assert.equal(secondsLeft('2025-12-31T23:59:00Z', now), 0)
  assert.equal(secondsLeft(null, now), 0)
})
