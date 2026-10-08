'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { parseEntryLines, WHEEL_LABEL_MAX } from '@/lib/wheelEntries'

/**
 * Organizer controls for a Wheel of Fortune's Entries: add one, paste many
 * (one per line), remove, and Restore. Removed Entries stay listed, greyed out.
 *
 * Self-contained: loads and writes Entries itself (direct read under RLS plus
 * the add_wheel_entries / remove_wheel_entry / restore_wheel_entry RPCs), so
 * the session editor and the presenter screen can drop it in unchanged.
 *
 * Props
 *  - sessionId (string, required): the wheel session.
 *  - pollMs (number, default 0): refetch interval in ms, so Entries added by
 *    joining Participants appear. 0 disables polling.
 *  - onEntriesChange (fn, optional): called with the full entries array
 *    (id, session_id, participant_id, label, kind, removed_at) after every load.
 *  - disabled (bool, default false): hides add/remove/restore controls; the
 *    list stays visible.
 *  - className (string, optional): extra classes on the outer wrapper.
 */
export default function WheelEntriesPanel({
  sessionId,
  pollMs = 0,
  onEntriesChange,
  disabled = false,
  className = '',
}) {
  const supabase = useMemo(() => createClient(), [])
  const [entries, setEntries] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [single, setSingle] = useState('')
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const onChangeRef = useRef(onEntriesChange)
  onChangeRef.current = onEntriesChange

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from('wheel_entries')
      .select('id, session_id, participant_id, label, kind, removed_at')
      .eq('session_id', sessionId)
      .order('created_at')
      .order('id')
    if (loadError) {
      setError(loadError.message)
      return
    }
    setEntries(data || [])
    setLoaded(true)
    onChangeRef.current?.(data || [])
  }, [supabase, sessionId])

  useEffect(() => {
    if (sessionId) load()
  }, [sessionId, load])

  useEffect(() => {
    if (!pollMs || !sessionId) return
    const timer = setInterval(load, pollMs)
    return () => clearInterval(timer)
  }, [pollMs, sessionId, load])

  const run = async (action, doneMessage) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    const { error: rpcError } = await action()
    setBusy(false)
    if (rpcError) {
      setError(rpcError.message)
      return false
    }
    if (doneMessage) setNotice(doneMessage)
    await load()
    return true
  }

  const addLabels = async (labels, reset) => {
    if (labels.length === 0) return
    const ok = await run(
      () => supabase.rpc('add_wheel_entries', { p_session_id: sessionId, p_labels: labels }),
      `Added ${labels.length} ${labels.length === 1 ? 'entry' : 'entries'}.`
    )
    if (ok) reset()
  }

  const submitSingle = (e) => {
    e.preventDefault()
    addLabels(parseEntryLines(single).slice(0, 1), () => setSingle(''))
  }

  const pastedLabels = parseEntryLines(pasted)
  const active = entries.filter((e) => !e.removed_at)
  const removedCount = entries.length - active.length

  return (
    <div className={`rounded-2xl border border-border bg-card p-6 shadow-sm ${className}`}>
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="font-display text-lg font-semibold text-foreground">Entries</h3>
        <p className="text-sm text-muted-foreground" data-testid="entries-count">
          {active.length} on the wheel{removedCount > 0 ? `, ${removedCount} removed` : ''}
        </p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        People who scan the QR code and join are added automatically. Add anyone else here.
      </p>

      {!disabled && (
        <div className="mt-5 space-y-5">
          <form onSubmit={submitSingle} className="flex gap-2">
            <input
              type="text"
              value={single}
              onChange={(e) => setSingle(e.target.value)}
              maxLength={WHEEL_LABEL_MAX}
              placeholder="Add one entry"
              aria-label="Add one entry"
              className="block w-full rounded-lg border border-border px-4 py-2.5 text-foreground shadow-sm focus:border-ring focus:ring-2 focus:ring-ring focus:ring-opacity-20"
            />
            <button
              type="submit"
              disabled={busy || !single.trim()}
              className="shrink-0 rounded-lg bg-gradient-to-r from-primary to-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </form>

          <div>
            <label htmlFor={`wheel-paste-${sessionId}`} className="block text-sm font-medium text-foreground mb-1.5">
              Paste a list
            </label>
            <textarea
              id={`wheel-paste-${sessionId}`}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={4}
              placeholder={'One entry per line\nAsha\nBen\nChloe'}
              className="block w-full rounded-lg border border-border px-4 py-2.5 text-foreground shadow-sm focus:border-ring focus:ring-2 focus:ring-ring focus:ring-opacity-20"
            />
            <div className="mt-2 flex items-center justify-between gap-4">
              <p className="text-xs text-muted-foreground">
                Blank lines are skipped; names are cut at {WHEEL_LABEL_MAX} characters.
              </p>
              <button
                type="button"
                onClick={() => addLabels(pastedLabels, () => setPasted(''))}
                disabled={busy || pastedLabels.length === 0}
                className="shrink-0 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pastedLabels.length > 0 ? `Add ${pastedLabels.length} from list` : 'Add from list'}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm font-medium text-destructive">{error}</p>
      )}
      {notice && !error && (
        <p role="status" className="mt-4 text-sm font-medium text-emerald-300">{notice}</p>
      )}

      <ul className="mt-5 divide-y divide-border rounded-lg border border-border" aria-label="Entries">
        {loaded && entries.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            No entries yet. Add some above, or wait for people to join.
          </li>
        )}
        {entries.map((entry) => {
          const removed = Boolean(entry.removed_at)
          return (
            <li
              key={entry.id}
              data-removed={removed ? 'true' : 'false'}
              className={`flex items-center justify-between gap-3 px-4 py-2.5 ${removed ? 'bg-muted/40' : ''}`}
            >
              <span className="min-w-0">
                <span className={`block truncate text-sm ${removed ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                  {entry.label}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {entry.kind === 'joined' ? 'Joined' : 'Added by you'}
                  {removed ? ' · removed' : ''}
                </span>
              </span>
              {!disabled && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      supabase.rpc(removed ? 'restore_wheel_entry' : 'remove_wheel_entry', { p_entry_id: entry.id })
                    )
                  }
                  className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                    removed
                      ? 'border border-border text-foreground hover:bg-muted'
                      : 'text-destructive hover:bg-destructive/10'
                  }`}
                >
                  {removed ? 'Restore' : 'Remove'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
