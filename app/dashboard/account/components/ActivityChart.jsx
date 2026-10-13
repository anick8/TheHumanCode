'use client'

import { useState } from 'react'
import { weekLabel } from '@/lib/accountStats'

const W = 600
const H = 150
const GAP = 8

// Responses per week for the last 12 weeks. The readout above the bars follows
// hover or keyboard focus and rests on the current week; the table underneath
// is the same data for screen readers.
export default function ActivityChart({ weekly }) {
  const [active, setActive] = useState(null)
  const max = Math.max(1, ...weekly.map((w) => w.responses))
  const total = weekly.reduce((sum, w) => sum + w.responses, 0)
  const current = weekly.length - 1
  const shown = active ?? current
  const point = weekly[shown]

  if (weekly.length === 0 || total === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        No responses in the last 12 weeks. Run a session and this fills in.
      </p>
    )
  }

  const barW = (W - GAP * (weekly.length - 1)) / weekly.length

  return (
    <figure>
      <figcaption className="flex items-baseline justify-between gap-4 text-sm" aria-live="polite">
        <span className="text-muted-foreground">
          Week of {weekLabel(point.weekStart)}
          {shown === current && ' (this week)'}
        </span>
        <span className="font-display text-lg font-bold tabular-nums text-foreground">
          {point.responses.toLocaleString()}
          <span className="ml-1.5 font-sans text-sm font-normal text-muted-foreground">
            {point.responses === 1 ? 'response' : 'responses'}
          </span>
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-3 h-40 w-full"
        role="img"
        aria-label={`Responses per week over the last ${weekly.length} weeks, ${total.toLocaleString()} in total`}
        onMouseLeave={() => setActive(null)}
      >
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} className="stroke-border" strokeWidth="1" />
        {weekly.map((w, i) => {
          const h = w.responses === 0 ? 2 : Math.max(4, (w.responses / max) * (H - 12))
          const x = i * (barW + GAP)
          const on = i === shown
          return (
            <g key={w.weekStart}>
              {/* full-height hit area so thin bars are easy to hover */}
              <rect
                x={x - GAP / 2}
                y="0"
                width={barW + GAP}
                height={H}
                fill="transparent"
                tabIndex={0}
                aria-label={`Week of ${weekLabel(w.weekStart)}: ${w.responses} responses`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="outline-none focus-visible:stroke-ring"
                strokeWidth="2"
              />
              <rect
                x={x}
                y={H - h - 1}
                width={barW}
                height={h}
                rx="3"
                className={`pointer-events-none transition-colors ${
                  on ? 'fill-foreground' : 'fill-muted-foreground/40'
                }`}
              />
            </g>
          )
        })}
      </svg>

      <div className="mt-2 flex justify-between text-xs text-muted-foreground" aria-hidden="true">
        <span>{weekLabel(weekly[0].weekStart)}</span>
        <span>{weekLabel(weekly[Math.floor(weekly.length / 2)].weekStart)}</span>
        <span>{weekLabel(weekly[current].weekStart)}</span>
      </div>

      <table className="sr-only">
        <caption>Responses per week</caption>
        <thead>
          <tr>
            <th scope="col">Week of</th>
            <th scope="col">Responses</th>
          </tr>
        </thead>
        <tbody>
          {weekly.map((w) => (
            <tr key={w.weekStart}>
              <th scope="row">{weekLabel(w.weekStart)}</th>
              <td>{w.responses}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
