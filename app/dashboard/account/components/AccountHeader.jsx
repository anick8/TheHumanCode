import { accessChip, displayNameOf, initialOf, relativeTime } from '@/lib/accountStats'
import HelpLink from '@/components/HelpLink'
import { formatDay } from '@/lib/accessStatus'

// Who this is and how long they have been here. The chip is tonal on purpose:
// the page has no single action that deserves the orange signal.
export default function AccountHeader({ user, access }) {
  const chip = accessChip(access)
  const name = displayNameOf(user)
  const since = user?.created_at ? formatDay(user.created_at) : null
  const lastSeen = relativeTime(user?.last_sign_in_at)

  return (
    <header className="flex flex-wrap items-center gap-5">
      <div
        aria-hidden="true"
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted font-display text-3xl font-bold text-foreground"
      >
        {initialOf(user)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="min-w-0 truncate font-display text-3xl font-bold text-foreground">{name}</h1>
          <HelpLink slug="account-and-access" label="About your account and access" />
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-xs font-semibold text-foreground">
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 rounded-full ${chip.live ? 'bg-emerald-400' : 'bg-muted-foreground'}`}
            />
            {chip.label}
          </span>
        </div>
        <p className="mt-1 truncate text-sm text-muted-foreground">{user?.email}</p>
        {(since || lastSeen) && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {since && <>Member since {since}</>}
            {since && lastSeen && ' · '}
            {lastSeen && <>Last signed in {lastSeen}</>}
          </p>
        )}
      </div>
    </header>
  )
}
