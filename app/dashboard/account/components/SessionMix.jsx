import { typeBreakdown, typeTitle } from '@/lib/accountStats'

// Tonal steps of the foreground, so the bar never competes with the signal.
const STEPS = ['bg-foreground', 'bg-foreground/70', 'bg-foreground/50', 'bg-foreground/35', 'bg-foreground/20']

export default function SessionMix({ byType }) {
  const parts = typeBreakdown(byType)
  const total = parts.reduce((sum, p) => sum + p.count, 0)
  if (total === 0) return null

  return (
    <div>
      <div
        className="flex h-3 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={parts.map((p) => `${typeTitle(p.type)}: ${p.count}`).join(', ')}
      >
        {parts.map((p, i) => (
          <span
            key={p.type}
            className={`${STEPS[Math.min(i, STEPS.length - 1)]} border-r border-card last:border-r-0`}
            style={{ width: `${(p.count / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
        {parts.map((p, i) => (
          <li key={p.type} className="flex items-center gap-2 text-muted-foreground">
            <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-sm ${STEPS[Math.min(i, STEPS.length - 1)]}`} />
            {typeTitle(p.type)}
            <span className="font-semibold tabular-nums text-foreground">{p.count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
