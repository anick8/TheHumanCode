import { formatDay } from '@/lib/accessStatus'
import { accessChip, accessProgress, allowanceUsage } from '@/lib/accountStats'

function Meter({ pct, label }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={label}
      className="h-2 overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full rounded-full bg-foreground transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
    </div>
  )
}

// Access window and AI allowance, from the same organizer_access_status() row
// the dashboard banner reads. Wording only; the database decides the state.
export default function PlanCard({ access, row }) {
  const chip = accessChip(access)
  const progress = accessProgress(row)
  const ai = allowanceUsage(row)
  const used = Number(row?.ai_used ?? 0)

  let windowNote
  if (access.state === 'admin') windowNote = 'No expiry'
  else if (access.state === 'upcoming' && row?.starts_at) windowNote = `Starts ${formatDay(row.starts_at)}`
  else if (access.untilLabel) windowNote = access.untilLabel.replace('Access until', 'Until')
  else if (row?.expires_at) windowNote = `Ended ${formatDay(row.expires_at)}`
  else windowNote = 'No end date'

  return (
    <div className="divide-y divide-border">
      <section className="pb-6" aria-labelledby="plan-heading">
        <h2 id="plan-heading" className="font-display text-lg font-bold text-foreground">
          Access
        </h2>
        <p className="mt-3 font-display text-2xl font-bold text-foreground">{chip.label}</p>
        <p className="mt-1 text-sm text-muted-foreground">{windowNote}</p>

        {progress !== null && (
          <div className="mt-4">
            <Meter pct={progress} label="Share of your access period used" />
            <div className="mt-2 flex justify-between text-xs text-muted-foreground">
              <span>{row.starts_at ? formatDay(row.starts_at) : ''}</span>
              <span>
                {access.daysLeft !== null && chip.live
                  ? `${access.daysLeft} ${access.daysLeft === 1 ? 'day' : 'days'} left`
                  : row.expires_at
                    ? formatDay(row.expires_at)
                    : ''}
              </span>
            </div>
          </div>
        )}
        {!chip.live && (
          <p className="mt-4 text-sm text-muted-foreground">
            {access.state === 'upcoming'
              ? 'Editing and presenting unlock when access starts.'
              : 'Your sessions and results stay available to view. Editing and presenting are paused.'}
          </p>
        )}
      </section>

      <section className="pt-6" aria-labelledby="ai-heading">
        <h2 id="ai-heading" className="font-display text-lg font-bold text-foreground">
          AI assistant
        </h2>
        {ai === null ? (
          <>
            <p className="mt-3 font-display text-2xl font-bold text-foreground">Unlimited</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {used.toLocaleString()} {used === 1 ? 'call' : 'calls'} so far in this access period.
            </p>
          </>
        ) : (
          <>
            <p className="mt-3 font-display text-2xl font-bold tabular-nums text-foreground">
              {ai.left.toLocaleString()}
              <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">
                of {ai.allowance.toLocaleString()} left
              </span>
            </p>
            <div className="mt-3">
              <Meter pct={ai.pct} label="Share of your AI allowance used" />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {ai.used.toLocaleString()} used. The count starts over when your access is renewed.
            </p>
          </>
        )}
      </section>
    </div>
  )
}
