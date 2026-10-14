import test from 'node:test'
import assert from 'node:assert/strict'
import { previewPlan } from './previewPlan.js'

const keys = (plan) => plan.tabs.map((t) => t.key)

test('each session type previews only its own screens, first tab is the default', () => {
  assert.deepEqual(keys(previewPlan({ sessionType: 'poll' })), ['voting', 'presenter', 'results'])
  assert.deepEqual(keys(previewPlan({ sessionType: 'quiz' })), ['answering', 'question', 'reveal', 'leaderboard'])
  assert.deepEqual(keys(previewPlan({ sessionType: 'comments' })), ['commenting', 'image', 'wall'])
  assert.deepEqual(keys(previewPlan({ sessionType: 'wheel' })), ['joining', 'wheel', 'pick'])
  assert.deepEqual(keys(previewPlan({ sessionType: 'treasure_hunt' })), ['clue'])
})

test('a round-by-round quiz previews the round board instead of the leaderboard', () => {
  const plan = previewPlan({ sessionType: 'quiz', quizFormat: 'round_by_round' })
  assert.deepEqual(keys(plan), ['answering', 'question', 'reveal', 'round'])
  assert.equal(plan.tabs.at(-1).label, 'Round board')
})

test('unknown or missing type falls back to the poll screens', () => {
  assert.deepEqual(keys(previewPlan({})), ['voting', 'presenter', 'results'])
  assert.deepEqual(keys(previewPlan({ sessionType: 'mystery' })), ['voting', 'presenter', 'results'])
})

test('an empty session uses sample content everywhere', () => {
  const { content } = previewPlan({ sessionType: 'quiz' })
  assert.equal(content.question.real, false)
  assert.ok(content.question.text.length > 0)
  assert.ok(content.options.length >= 2)
  assert.equal(content.correctOptionId, content.options[0].id)
  assert.equal(content.imageUrl, null)
  assert.equal(content.clue.real, false)
  assert.ok(content.clue.choices.length >= 2)
})

test('uses the first question and its options when they exist', () => {
  const questions = [{ id: 'q1', text: 'Capital of France?' }, { id: 'q2', text: 'Other' }]
  const optionsByQuestion = { q1: [{ id: 'o1', text: 'Lyon' }, { id: 'o2', text: 'Paris' }] }
  const { content } = previewPlan({ sessionType: 'poll', questions, optionsByQuestion })
  assert.equal(content.question.text, 'Capital of France?')
  assert.equal(content.question.real, true)
  assert.deepEqual(content.options.map((o) => o.text), ['Lyon', 'Paris'])
})

test('a question with no options keeps sample options but real text', () => {
  const { content } = previewPlan({ sessionType: 'poll', questions: [{ id: 'q1', text: 'Hi?' }] })
  assert.equal(content.question.text, 'Hi?')
  assert.ok(content.options.length >= 2)
})

test('quiz marks the keyed option as correct', () => {
  const questions = [{ id: 'q1', text: 'Capital?' }]
  const optionsByQuestion = { q1: [{ id: 'o1', text: 'Lyon' }, { id: 'o2', text: 'Paris' }] }
  const { content } = previewPlan({ sessionType: 'quiz', questions, optionsByQuestion, keys: { q1: 'o2' } })
  assert.equal(content.correctOptionId, 'o2')
})

test('quiz with no key (or a stale key) falls back to the first option', () => {
  const questions = [{ id: 'q1', text: 'Capital?' }]
  const optionsByQuestion = { q1: [{ id: 'o1', text: 'Lyon' }, { id: 'o2', text: 'Paris' }] }
  assert.equal(previewPlan({ sessionType: 'quiz', questions, optionsByQuestion }).content.correctOptionId, 'o1')
  assert.equal(
    previewPlan({ sessionType: 'quiz', questions, optionsByQuestion, keys: { q1: 'gone' } }).content.correctOptionId,
    'o1',
  )
})

test('comments picks the first question that has an image', () => {
  const questions = [
    { id: 'q1', text: 'No art' },
    { id: 'q2', text: 'Look at this', image_url: 'https://x/y.png' },
    { id: 'q3', text: 'Later', image_url: 'https://x/z.png' },
  ]
  const { content } = previewPlan({ sessionType: 'comments', questions })
  assert.equal(content.question.text, 'Look at this')
  assert.equal(content.imageUrl, 'https://x/y.png')
})

test('comments with no imaged question uses the first question without an image', () => {
  const { content } = previewPlan({ sessionType: 'comments', questions: [{ id: 'q1', text: 'Words only' }] })
  assert.equal(content.question.text, 'Words only')
  assert.equal(content.imageUrl, null)
})

test('treasure hunt uses the first clue and its choices', () => {
  const questions = [
    { id: 'q1', text: 'Under the stairs', clue_choices: [{ label: 'Left', reveal: 'Go left' }, { label: 'Right', reveal: 'Go right' }] },
  ]
  const { content } = previewPlan({ sessionType: 'treasure_hunt', questions })
  assert.equal(content.clue.real, true)
  assert.equal(content.clue.message, 'Under the stairs')
  assert.deepEqual(content.clue.choices, [{ label: 'Left', reveal: 'Go left' }, { label: 'Right', reveal: 'Go right' }])
})

test('a clue without choices previews with none', () => {
  const { content } = previewPlan({ sessionType: 'treasure_hunt', questions: [{ id: 'q1', text: 'Just a message' }] })
  assert.deepEqual(content.clue.choices, [])
})

test('people are always samples, even when real rows are passed in', () => {
  const real = { participants: [{ display_name: 'Real Person' }], comments: [{ body: 'Real words' }], entries: [{ name: 'Real Entry' }] }
  const { content } = previewPlan({ sessionType: 'wheel', questions: [{ id: 'q', text: 'x' }], ...real })
  assert.ok(!JSON.stringify(content.people).includes('Real'))
  assert.ok(content.people.leaderboard.length >= 3)
  assert.ok(content.people.round.length >= 3)
  assert.ok(content.people.comments.length >= 3)
  assert.ok(content.people.wheelEntries.length >= 6)
})
