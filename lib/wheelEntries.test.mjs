import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEntryLines, WHEEL_LABEL_MAX } from './wheelEntries.js'

test('splits pasted text into one trimmed label per line, dropping blanks', () => {
  assert.deepEqual(parseEntryLines('  Asha \n\n Ben\r\n   \nChloe'), ['Asha', 'Ben', 'Chloe'])
})

test('truncates labels to the 24 character wheel limit', () => {
  const [label] = parseEntryLines('x'.repeat(40))
  assert.equal(label.length, 24)
  assert.equal(WHEEL_LABEL_MAX, 24)
})

test('keeps duplicates and returns [] for blank input', () => {
  assert.deepEqual(parseEntryLines('Sam\nSam'), ['Sam', 'Sam'])
  assert.deepEqual(parseEntryLines('  \n '), [])
  assert.deepEqual(parseEntryLines(undefined), [])
})
