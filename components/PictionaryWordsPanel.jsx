'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { parseWords, wordsTooFew, WORD_MAX, WORDS_MAX, WORDS_MIN } from '@/lib/pictionaryWords'

/**
 * Organizer's Word list for a Pictionary session: one Word per line.
 * Reads and writes through get_pictionary_words / set_pictionary_words (the
 * Words are hidden from every client table). Read-only once a Round exists.
 *
 * Props
 *  - sessionId (string, required)
 *  - locked (bool): a Round exists, so the list can no longer change.
 *  - disabled (bool): the viewer cannot edit (not the owner, or read-only access).
 */
export default function PictionaryWordsPanel({ sessionId, locked = false, disabled = false }) {
  const supabase = useMemo(() => createClient(), [])
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(null) // text as last loaded/saved; null until loaded
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase.rpc('get_pictionary_words', { p_session_id: sessionId }).then(({ data, error: loadError }) => {
      if (cancelled) return
      if (loadError) {
        setError(loadError.message)
        return
      }
      setText(data || '')
      setSaved(data || '')
    })
    return () => {
      cancelled = true
    }
  }, [supabase, sessionId])

  const count = parseWords(text).length
  const readOnly = locked || disabled
  const dirty = saved !== null && text !== saved

  const save = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    const { data, error: saveError } = await supabase.rpc('set_pictionary_words', {
      p_session_id: sessionId,
      p_words: text,
    })
    setBusy(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    // Show the list as the server stored it (trimmed, de-duplicated).
    setText(parseWords(text).join('\n'))
    setSaved(parseWords(text).join('\n'))
    setNotice(`Saved ${data} ${data === 1 ? 'word' : 'words'}.`)
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
      <h2 className="font-display text-2xl font-semibold text-foreground">Word list</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        One word or phrase per line, up to {WORD_MAX} characters each and {WORDS_MAX} words. Each round offers the
        drawer three unused words; the two they don&apos;t pick stay in the list for later rounds.
      </p>

      <label htmlFor="pictionary-words" className="sr-only">Word list</label>
      <textarea
        id="pictionary-words"
        value={text}
        onChange={(e) => setText(e.target.value)}
        readOnly={readOnly}
        rows={12}
        placeholder={'lighthouse\nbicycle\nthunderstorm'}
        className="mt-4 block w-full rounded-lg border border-border bg-background px-4 py-3 font-mono text-sm text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring read-only:opacity-70"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p data-testid="word-count" className="text-sm text-muted-foreground">
          {count} {count === 1 ? 'word' : 'words'}
        </p>
        {!readOnly && (
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Saving...' : 'Save word list'}
          </button>
        )}
      </div>

      {saved !== null && wordsTooFew(text) && (
        <p role="status" data-testid="words-warning" className="mt-3 text-sm font-medium text-amber-300">
          Add at least {WORDS_MIN} words: each round offers the drawer three to choose from, so the game can&apos;t start with fewer.
        </p>
      )}
      {locked && (
        <p className="mt-3 text-sm text-muted-foreground">
          The word list is locked because the first round has started.
        </p>
      )}
      {notice && <p role="status" className="mt-3 text-sm font-medium text-emerald-300">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm font-medium text-destructive">{error}</p>}
    </div>
  )
}
