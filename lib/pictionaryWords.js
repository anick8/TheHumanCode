// Mirrors set_pictionary_words(): one Word per line, trimmed to 40 characters,
// blanks dropped, duplicates (any case) dropped, at most 200. Used for the live
// count and the under-3 warning only; the server is the authority.

export const WORD_MAX = 40
export const WORDS_MAX = 200
export const WORDS_MIN = 3

export function parseWords(text) {
  const seen = new Set()
  const words = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const word = line.trim().slice(0, WORD_MAX).trim()
    const key = word.toLowerCase()
    if (!word || seen.has(key)) continue
    seen.add(key)
    words.push(word)
  }
  return words
}

export const wordsTooFew = (text) => parseWords(text).length < WORDS_MIN
