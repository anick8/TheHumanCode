import test from 'node:test'
import assert from 'node:assert/strict'
import { parseWords, wordsTooFew, WORD_MAX } from './pictionaryWords.js'

test('trims, drops blanks and case-insensitive duplicates, keeps order', () => {
  assert.deepEqual(parseWords('  Cat \r\n\ndog\nCAT\n bird '), ['Cat', 'dog', 'bird'])
})

test('long lines are cut to the Word length limit', () => {
  assert.equal(parseWords('x'.repeat(100))[0].length, WORD_MAX)
})

test('fewer than 3 Words is too few; empty and null are too', () => {
  assert.equal(wordsTooFew('a\nb'), true)
  assert.equal(wordsTooFew('a\nb\nA'), true)
  assert.equal(wordsTooFew('a\nb\nc'), false)
  assert.equal(wordsTooFew(null), true)
})
