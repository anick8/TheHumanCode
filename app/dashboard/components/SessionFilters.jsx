'use client'

import { forwardRef } from 'react'
import { copyFor } from '@/lib/sessionCopy'
import { SearchIcon } from './icons'

// Search plus one chip per session type the organizer actually has. `counts`
// is { all, byType: { poll: 3, ... } } for the unfiltered list.
const SessionFilters = forwardRef(function SessionFilters(
  { query, onQuery, typeFilter, onType, counts, types },
  searchRef
) {
  const chips = [
    { value: 'all', label: 'All', count: counts.all },
    ...types.map((type) => ({
      value: type,
      label: copyFor(type).typeLabel,
      count: counts.byType[type] || 0,
    })),
  ]

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="relative w-full lg:max-w-xs">
        <label htmlFor="session-search" className="sr-only">
          Search sessions by title or code
        </label>
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={searchRef}
          id="session-search"
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search sessions"
          className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-2 focus:outline-offset-2 focus:outline-ring"
        />
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 text-[10px] font-semibold text-muted-foreground lg:inline-block">
          /
        </kbd>
      </div>

      <div
        role="radiogroup"
        aria-label="Filter by session type"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
      >
        {chips.map((chip) => {
          const selected = typeFilter === chip.value
          return (
            <button
              key={chip.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onType(chip.value)}
              className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors ${
                selected
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground'
              }`}
            >
              {chip.label}
              <span className={`text-xs tabular-nums ${selected ? 'text-background/70' : ''}`}>
                {chip.count}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
})

export default SessionFilters
