function shuffle(items, random) {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Spread correct answers across positions so a drafted quiz isn't all "A".
// Questions without a valid correct_option_index (polls, comments) pass through.
export function spreadCorrectAnswers(questions, random = Math.random) {
  const slots = shuffle(questions.map((_, i) => i), random)
  return questions.map((q, i) => {
    const options = q.options ?? []
    const correct = q.correct_option_index
    if (!Number.isInteger(correct) || !options[correct]) return q
    const target = slots[i] % options.length
    const wrong = shuffle(options.filter((_, k) => k !== correct), random)
    wrong.splice(target, 0, options[correct])
    return { ...q, options: wrong, correct_option_index: target }
  })
}
