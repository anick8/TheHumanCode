'use client'

import Link from 'next/link'
import { PlusIcon, SparkleIcon } from './icons'

// The create row: describe a session and let the assistant draft it, or open
// the blank form. Draft it stays a tonal control (filled Paper White once there
// is text) so Present keeps the page's only orange.
export default function CreateBar({ value, onChange, onSubmit, creating, error }) {
  const hasText = value.trim().length > 0

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <label htmlFor="ai-prompt" className="sr-only">
            Describe the quiz or poll to draft with AI
          </label>
          <SparkleIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="ai-prompt"
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Describe a session: a 6-question quiz on renewable energy for a non-technical crowd"
            className="h-11 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-2 focus:outline-offset-2 focus:outline-ring"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={creating || !hasText}
            className={`inline-flex h-11 flex-1 items-center justify-center rounded-xl border px-5 text-sm font-semibold transition-colors sm:flex-none ${
              hasText && !creating
                ? 'border-foreground bg-foreground text-background hover:bg-foreground/90'
                : 'border-border bg-muted text-muted-foreground'
            } disabled:cursor-not-allowed`}
          >
            {creating ? 'Starting…' : 'Draft it'}
          </button>
          <Link
            href="/dashboard/sessions/new"
            className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted sm:flex-none"
          >
            <PlusIcon />
            New
          </Link>
        </div>
      </div>
      <p className="mt-2 px-1 text-xs text-muted-foreground">
        The type is picked from your description, and you review every question before anything
        is saved.
      </p>
      {error && (
        <p role="alert" className="mt-1 px-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
