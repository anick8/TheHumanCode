import test from 'node:test'
import assert from 'node:assert/strict'
import { parseWords, wordsTooFew, mergeWords, WORD_MAX } from './pictionaryWords.js'

test('mergeWords replace swaps the list, append keeps existing first, both dedupe and cap', () => {
  assert.equal(mergeWords('cat\ndog', ['Dog', 'bird'], 'replace'), 'Dog\nbird')
  assert.equal(mergeWords('cat\ndog', ['Dog', 'bird'], 'append'), 'cat\ndog\nbird')
  const many = Array.from({ length: 250 }, (_, i) => `w${i}`)
  assert.equal(mergeWords('', many, 'replace').split('\n').length, 200)
})

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
