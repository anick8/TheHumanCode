import { blankWords } from './pictionaryPhone.js'

// Display text for the public word_pattern ("___ _-__"): spaced marks, a wider gap between words.
export function blanksFor(pattern) {
  return (blankWords(pattern) ?? []).map((w) => w.join(' ')).join('   ')
}
