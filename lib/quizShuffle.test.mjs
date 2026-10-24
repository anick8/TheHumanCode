import test from 'node:test'
import assert from 'node:assert/strict'
import { spreadCorrectAnswers } from './quizShuffle.js'

const quiz = Array.from({ length: 6 }, (_, i) => ({
  text: `Q${i}`,
  options: ['right', 'x', 'y', 'z'].map((text) => ({ text })),
  correct_option_index: 0,
}))

test('correct answers are spread and still point at the right option', () => {
  for (let run = 0; run < 50; run++) {
    const out = spreadCorrectAnswers(quiz)
    assert.ok(out.every((q) => q.options[q.correct_option_index].text === 'right'))
    assert.ok(new Set(out.map((q) => q.correct_option_index)).size > 1)
    const counts = {}
    out.forEach((q) => { counts[q.correct_option_index] = (counts[q.correct_option_index] ?? 0) + 1 })
    assert.ok(Object.values(counts).every((n) => n <= 2))
  }
})

test('questions without a key are untouched', () => {
  const poll = { text: 'P', options: [{ text: 'a' }, { text: 'b' }] }
  assert.equal(spreadCorrectAnswers([poll])[0], poll)
})
