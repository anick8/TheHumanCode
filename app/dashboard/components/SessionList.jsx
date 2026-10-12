'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { copyFor } from '@/lib/sessionCopy'
import { formatDate } from '@/lib/utils'

// The run sheet. Rows are buttons: click or arrow keys select, Enter opens the
// editor, P presents. `renderInline` lets the narrow layout expand the
// inspector directly beneath the selected row instead of in a side pane.
export default function SessionList({
  sessions,
  selectedId,
  onSelect,
  onOpen,
  onPresent,
  renderInline,
  totalCount,
  onClearFilters,
  readOnly = false,
}) {
  const listRef = useRef(null)

  if (totalCount === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
        <p className="font-display text-lg font-bold text-foreground">No sessions yet</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          {readOnly
            ? 'New sessions are unavailable while your account is read-only.'
            : 'Describe one above and the assistant will draft it, or start from a blank form.'}
        </p>
        {!readOnly && (
          <Link
            href="/dashboard/sessions/new"
            className="mt-5 inline-flex h-10 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
          >
            Create your first session
          </Link>
        )}
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
        <p className="text-sm font-semibold text-foreground">No sessions match</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Try a different search or type.
        </p>
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-4 inline-flex h-9 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
        >
          Clear filters
        </button>
      </div>
    )
  }

  const focusRow = (id) => {
    requestAnimationFrame(() => {
      listRef.current?.querySelector(`[data-row="${id}"]`)?.focus()
    })
  }

  const onKeyDown = (event, session, index) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = sessions[index + (event.key === 'ArrowDown' ? 1 : -1)]
      if (next) {
        onSelect(next.id)
        focusRow(next.id)
      }
    } else if (event.key === 'Enter') {
      event.preventDefault()
      onOpen(session)
    } else if (event.key === 'p' || event.key === 'P') {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      event.preventDefault()
      onSelect(session.id)
      onPresent(session)
    }
  }

  return (
    <div>
      <ul ref={listRef} className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {sessions.map((session, index) => {
          const selected = session.id === selectedId
          const typeLabel = copyFor(session.session_type).typeLabel
          return (
            <li key={session.id}>
              <button
                type="button"
                data-row={session.id}
                aria-pressed={selected}
                onClick={(event) => {
                  const collapsing = selected && renderInline
                  onSelect(collapsing ? null : session.id)
                  if (renderInline && !collapsing) {
                    const row = event.currentTarget
                    requestAnimationFrame(() =>
                      row.scrollIntoView({ block: 'start', behavior: 'smooth' })
                    )
                  }
                }}
                onKeyDown={(event) => onKeyDown(event, session, index)}
                className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
                  selected ? 'bg-muted' : 'hover:bg-muted/60'
                }`}
              >
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full border ${
                    session.is_active
                      ? 'border-foreground bg-foreground'
                      : 'border-muted-foreground bg-transparent'
                  }`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[0.95rem] font-semibold text-foreground">
                    {session.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {typeLabel}
                    <span aria-hidden="true"> · </span>
                    <span className="font-mono">{session.slug}</span>
                    {!session.is_active && <span> · Closed</span>}
                  </span>
                </span>
                <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:block">
                  {formatDate(session.created_at)}
                </span>
              </button>
              {selected && renderInline && (
                <div className="border-t border-border bg-background p-3">
                  {renderInline(session)}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <p className="mt-3 hidden px-1 text-xs text-muted-foreground lg:block">
        <kbd className="font-semibold">↑</kbd> <kbd className="font-semibold">↓</kbd> select
        <span aria-hidden="true"> · </span>
        <kbd className="font-semibold">Enter</kbd> edit
        <span aria-hidden="true"> · </span>
        <kbd className="font-semibold">P</kbd> present
        <span aria-hidden="true"> · </span>
        <kbd className="font-semibold">/</kbd> search
      </p>
    </div>
  )
}
