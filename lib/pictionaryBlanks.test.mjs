import test from 'node:test'
import assert from 'node:assert/strict'
import { blanksFor } from './pictionaryBlanks.js'

test('one blank per letter, wider gap between words, punctuation kept', () => {
  assert.equal(blanksFor('cat'), '_ _ _')
  assert.equal(blanksFor('ice  cream'), '_ _ _   _ _ _ _ _')
  assert.equal(blanksFor('x-ray'), '_ - _ _ _')
  assert.equal(blanksFor(null), '')
})
