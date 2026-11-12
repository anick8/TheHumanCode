// Display text for the public word_pattern ("___ _-__"): spaced marks, a wider gap between words.
export function blanksFor(pattern) {
  return String(pattern ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => [...w].join(' '))
    .join('   ')
}
