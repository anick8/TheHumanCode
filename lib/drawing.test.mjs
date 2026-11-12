import test from 'node:test'
import assert from 'node:assert/strict'
import { toNormalised, applySegment, undoStroke } from './drawing.js'

const rect = { left: 100, top: 50, width: 200, height: 200 }

test('pointer position maps to 0..1 of the canvas and is clamped', () => {
  assert.deepEqual(toNormalised(150, 100, rect), { x: 0.25, y: 0.25 })
  assert.deepEqual(toNormalised(0, 999, rect), { x: 0, y: 1 })
})

test('segments with the same id extend one stroke; new ids start a new one', () => {
  const a = applySegment([], { id: 's1', color: '#000', size: 1, points: [{ x: 0, y: 0 }] })
  const b = applySegment(a, { id: 's1', color: '#000', size: 1, points: [{ x: 1, y: 1 }] })
  const c = applySegment(b, { id: 's2', color: '#f00', size: 2, points: [{ x: 0.5, y: 0.5 }] })
  assert.equal(c.length, 2)
  assert.equal(c[0].points.length, 2)
  assert.equal(a[0].points.length, 1) // input not mutated
})

test('undo drops the last stroke, and is safe on an empty list', () => {
  assert.deepEqual(undoStroke([{ id: 'a' }, { id: 'b' }]), [{ id: 'a' }])
  assert.deepEqual(undoStroke([]), [])
})
