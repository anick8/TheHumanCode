import Link from 'next/link'
import { relativeTime, typeTitle } from '@/lib/accountStats'

export default function TopSessions({ sessions }) {
  if (sessions.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        Your busiest sessions show up here once they have responses.
      </p>
    )
  }
  const max = Math.max(...sessions.map((s) => s.responses), 1)

  return (
    <ol className="divide-y divide-border">
      {sessions.map((s) => {
        const last = relativeTime(s.lastActivityAt)
        return (
          <li key={s.id}>
            <Link
              href={`/dashboard?s=${s.id}`}
              className="group -mx-2 flex items-center gap-4 rounded-lg px-2 py-3 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{s.title}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {typeTitle(s.type)} · {s.people.toLocaleString()} {s.people === 1 ? 'person' : 'people'}
                  {last && ` · ${last}`}
                </p>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted group-hover:bg-card">
                  <div className="h-full rounded-full bg-muted-foreground/60" style={{ width: `${(s.responses / max) * 100}%` }} />
                </div>
              </div>
              <span className="shrink-0 text-right font-display text-xl font-bold tabular-nums text-foreground">
                {s.responses.toLocaleString()}
              </span>
            </Link>
          </li>
        )
      })}
    </ol>
  )
}
