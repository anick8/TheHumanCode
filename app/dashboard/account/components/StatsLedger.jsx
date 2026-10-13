import { typeSummary } from '@/lib/accountStats'

const fmt = (n) => n.toLocaleString()

// One row of figures divided by hairlines, not four cards: it reads as a
// ledger of the account's work.
export default function StatsLedger({ totals }) {
  const items = [
    { label: 'Sessions', value: totals.sessions, note: typeSummary(totals.byType) },
    {
      label: 'Run live',
      value: totals.sessionsRun,
      note: totals.sessions > 0 ? `of ${fmt(totals.sessions)} created` : 'Nothing run yet',
    },
    {
      label: 'Responses',
      value: totals.responses,
      note:
        totals.comments > 0
          ? `${fmt(totals.votes)} votes, ${fmt(totals.comments)} comments`
          : `${fmt(totals.questions)} questions asked`,
    },
    {
      label: 'People reached',
      value: totals.people,
      note: totals.wheelSpins > 0 ? `${fmt(totals.wheelSpins)} wheel spins` : 'Distinct voters and players',
    },
  ]

  return (
    <dl className="grid grid-cols-2 divide-border sm:grid-cols-4 sm:divide-x">
      {items.map((item, i) => (
        <div
          key={item.label}
          className={`px-0 py-4 sm:px-5 sm:py-1 sm:first:pl-0 ${i % 2 === 1 ? 'pl-5 sm:pl-5' : ''} ${
            i >= 2 ? 'border-t border-border sm:border-t-0' : ''
          } ${i % 2 === 1 ? 'border-l border-border sm:border-l-0' : ''}`}
        >
          <dt className="text-sm font-medium text-muted-foreground">{item.label}</dt>
          <dd className="mt-1 font-display text-3xl font-bold tabular-nums text-foreground">{fmt(item.value)}</dd>
          <dd className="mt-1 text-xs text-muted-foreground">{item.note}</dd>
        </div>
      ))}
    </dl>
  )
}
