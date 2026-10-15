'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { HELP_ARTICLES } from '@/lib/helpNav'

export default function HelpSearch() {
  const [query, setQuery] = useState('')
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)

  const results = useMemo(() => {
    if (terms.length === 0) return []
    return HELP_ARTICLES.filter((a) => {
      const hay = `${a.title} ${a.summary} ${a.keywords} ${a.section}`.toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  return (
    <div>
      <label htmlFor="help-search" className="sr-only">Search help</label>
      <input
        id="help-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search help, e.g. “time limit” or “export”"
        className="block w-full rounded-lg border border-border bg-card px-4 py-3 text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring"
      />
      {terms.length > 0 && (
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-card" aria-live="polite">
          {results.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">No articles match “{query}”.</li>}
          {results.map((a) => (
            <li key={a.slug}>
              <Link href={`/help/${a.slug}`} className="block px-4 py-3 hover:bg-muted">
                <span className="block text-sm font-semibold text-foreground">{a.title}</span>
                <span className="block text-sm text-muted-foreground">{a.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
