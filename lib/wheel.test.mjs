// Run with: node --test lib/wheel.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { finalRotation, entryAtPointer, LABEL_HIDE_ABOVE } from './wheel.js'

const entries = (n, label = (i) => `E${i}`) =>
  Array.from({ length: n }, (_, i) => ({ id: `id${i}`, label: label(i) }))

test('lands exactly on the requested entry for every index and jitter', () => {
  for (const n of [2, 3, 7, 40, 150]) {
    const list = entries(n)
    for (const start of [0, 123.4, 4000]) {
      for (const jitter of [-0.45, 0, 0.3, 0.45]) {
        for (let i = 0; i < n; i++) {
          const rot = finalRotation({ entries: list, entryId: `id${i}`, currentRotation: start, turns: 6, jitter })
          assert.equal(entryAtPointer(list, rot).id, `id${i}`)
        }
      }
    }
  }
})

test('lands by entry id even when several entries share a label', () => {
  const list = entries(6, () => 'Sam')
  for (let i = 0; i < 6; i++) {
    const rot = finalRotation({ entries: list, entryId: `id${i}`, currentRotation: 10, turns: 5, jitter: 0 })
    assert.equal(entryAtPointer(list, rot).id, `id${i}`)
  }
})

test('always turns forward by at least the requested full turns', () => {
  const list = entries(5)
  for (const start of [0, 90, 359.9, 1000]) {
    const rot = finalRotation({ entries: list, entryId: 'id3', currentRotation: start, turns: 5, jitter: 0 })
    assert.ok(rot - start >= 5 * 360 && rot - start < 6 * 360)
  }
})

test('returns null when the entry is not on the wheel', () => {
  assert.equal(finalRotation({ entries: entries(3), entryId: 'nope', currentRotation: 0 }), null)
})

test('labels are hidden above the threshold constant', () => {
  assert.equal(LABEL_HIDE_ABOVE, 40)
})
