import test from 'node:test'
import assert from 'node:assert/strict'
import { blanksFor } from './pictionaryBlanks.js'

test('pattern is spaced out with a wider gap between words, punctuation kept', () => {
  assert.equal(blanksFor('___'), '_ _ _')
  assert.equal(blanksFor('___ _____'), '_ _ _   _ _ _ _ _')
  assert.equal(blanksFor('_-___'), '_ - _ _ _')
  assert.equal(blanksFor(null), '')
})
