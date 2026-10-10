import test from 'node:test'
import assert from 'node:assert/strict'
import { parseInstagramHandle, instagramUrl } from './instagram.js'

test('accepts a bare handle with or without the @', () => {
  assert.equal(parseInstagramHandle('mcgenie'), 'mcgenie')
  assert.equal(parseInstagramHandle('  @mc.genie_1 '), 'mc.genie_1')
})

test('extracts the handle from profile links', () => {
  assert.equal(parseInstagramHandle('instagram.com/mcgenie'), 'mcgenie')
  assert.equal(parseInstagramHandle('https://www.instagram.com/mcgenie/?igsh=abc'), 'mcgenie')
  assert.equal(parseInstagramHandle('http://m.instagram.com/mcgenie#top'), 'mcgenie')
})

test('rejects blank, malformed and over-long input', () => {
  assert.equal(parseInstagramHandle(''), null)
  assert.equal(parseInstagramHandle('   '), null)
  assert.equal(parseInstagramHandle(undefined), null)
  assert.equal(parseInstagramHandle('two words'), null)
  assert.equal(parseInstagramHandle('bad/handle'), null)
  assert.equal(parseInstagramHandle('x'.repeat(31)), null)
  assert.equal(parseInstagramHandle('https://example.com/mcgenie'), null)
})

test('builds the profile url', () => {
  assert.equal(instagramUrl('mcgenie'), 'https://instagram.com/mcgenie')
})
