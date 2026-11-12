// Letter blanks for a Word: one "_" per letter or digit, a wider gap between words,
// other characters (hyphens, apostrophes) shown as they are. "ice cream" -> "_ _ _   _ _ _ _ _".
export function blanksFor(word) {
  return String(word ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => [...w].map((c) => (/[\p{L}\p{N}]/u.test(c) ? '_' : c)).join(' '))
    .join('   ')
}
