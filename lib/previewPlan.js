// Pure preview plan for the Design page: which screens the current session's
// type previews, and what content each uses. Real question content is used
// when it exists; anything missing, and every person, is a built-in sample so
// real participants never appear on a settings page. No React, no data loading.

const TABS_BY_TYPE = {
  poll: [
    { key: 'voting', label: 'Voting' },
    { key: 'presenter', label: 'Presenter' },
    { key: 'results', label: 'Results' },
  ],
  quiz: [
    { key: 'answering', label: 'Answering' },
    { key: 'question', label: 'Question' },
    { key: 'reveal', label: 'Reveal' },
  ],
  comments: [
    { key: 'commenting', label: 'Commenting' },
    { key: 'image', label: 'Image' },
    { key: 'wall', label: 'Comment wall' },
  ],
  wheel: [
    { key: 'joining', label: 'Joining' },
    { key: 'wheel', label: 'Wheel' },
    { key: 'pick', label: 'Pick' },
  ],
  treasure_hunt: [{ key: 'clue', label: 'Clue' }],
}

export const SAMPLE_QUESTION = 'Did you enjoy the session?'
export const SAMPLE_OPTIONS = [
  { id: 'a', text: 'Absolutely' },
  { id: 'b', text: 'Somewhat' },
  { id: 'c', text: 'Not really' },
]
export const SAMPLE_COUNTS = { a: 12, b: 7, c: 3 }
const SAMPLE_CLUE = {
  message: 'Look where the light comes in, then follow the cold air.',
  choices: [
    { label: 'Check the window', reveal: 'Behind the curtain, taped under the sill.' },
    { label: 'Check the fridge', reveal: 'Under the butter dish, inside the door.' },
  ],
}

const SAMPLE_PEOPLE = {
  leaderboard: [
    { participant_id: 's1', display_name: 'Alex', score: 4200, total_response_ms: 21000, rank: 1 },
    { participant_id: 's2', display_name: 'Sam', score: 3800, total_response_ms: 24000, rank: 2 },
    { participant_id: 's3', display_name: 'Jordan', score: 3100, total_response_ms: 26000, rank: 3 },
    { participant_id: 's4', display_name: 'Riley', score: 2600, total_response_ms: 30000, rank: 4 },
  ],
  round: [
    { participant_id: 's1', display_name: 'Alex', response_ms: 2100, rank: 1 },
    { participant_id: 's2', display_name: 'Sam', response_ms: 3400, rank: 2 },
    { participant_id: 's3', display_name: 'Jordan', response_ms: 5200, rank: 3 },
  ],
  comments: [
    { id: 'c1', name: 'Alex', body: 'Love the colours here.' },
    { id: 'c2', name: 'Sam', body: 'Reminds me of a summer evening.' },
    { id: 'c3', name: 'Jordan', body: 'The light on the left is perfect.' },
  ],
  wheelEntries: ['Alex', 'Sam', 'Jordan', 'Riley', 'Casey', 'Morgan', 'Taylor', 'Jamie'].map((name, i) => ({
    id: `w${i}`,
    label: name,
  })),
}

export function previewPlan({
  sessionType,
  quizFormat = null,
  questions = [],
  optionsByQuestion = {},
  keys = {},
} = {}) {
  const type = Object.hasOwn(TABS_BY_TYPE, sessionType) ? sessionType : 'poll'

  let tabs = TABS_BY_TYPE[type]
  if (type === 'quiz') {
    tabs = [
      ...tabs,
      quizFormat === 'round_by_round'
        ? { key: 'round', label: 'Round board' }
        : { key: 'leaderboard', label: 'Leaderboard' },
    ]
  }

  // Comments previews real artwork, so prefer the first imaged question.
  const source =
    (type === 'comments' ? questions.find((q) => q?.image_url) : null) || questions[0] || null

  const realOptions = source ? optionsByQuestion[source.id] || [] : []
  const options = realOptions.length > 0 ? realOptions : SAMPLE_OPTIONS
  const keyed = source ? keys[source.id] : null
  const correctOptionId = options.some((o) => o.id === keyed) ? keyed : options[0].id

  const rawChoices = source && Array.isArray(source.clue_choices) ? source.clue_choices : []
  const clue = source
    ? {
        real: true,
        message: source.text,
        choices: rawChoices.map((c) => ({ label: c?.label ?? '', reveal: c?.reveal ?? '' })),
      }
    : { real: false, ...SAMPLE_CLUE }

  return {
    type,
    tabs,
    content: {
      question: { real: Boolean(source), text: source?.text || SAMPLE_QUESTION },
      options,
      correctOptionId,
      imageUrl: source?.image_url || null,
      clue,
      people: SAMPLE_PEOPLE,
    },
  }
}
