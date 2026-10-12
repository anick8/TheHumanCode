'use client'

import { Fragment, useState } from 'react'
import { addDays, istDay } from '@/lib/grantDates'
import { formatDay } from '@/lib/accessStatus'

const STATUS_STYLE = {
  active: 'text-foreground',
  upcoming: 'text-muted-foreground',
  expired: 'text-muted-foreground',
  revoked: 'text-destructive',
}

const fmt = (value) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

const fmtDay = (value) => (value ? formatDay(value) : 'Never')

const btn =
  'rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50'

function ExtendPanel({ grant, onExtend, onDone }) {
  const today = istDay()
  const currentEnd = grant.expires_at ? istDay(new Date(grant.expires_at)) : today
  const base = currentEnd > today ? currentEnd : today
  const [endDay, setEndDay] = useState(grant.expires_at ? currentEnd : '')
  const [never, setNever] = useState(!grant.expires_at)
  const [allowance, setAllowance] = useState(grant.ai_allowance == null ? '' : String(grant.ai_allowance))
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    const aiAllowance = allowance.trim() === '' ? null : Math.max(0, parseInt(allowance, 10) || 0)
    const ok = await onExtend(grant, never ? null : endDay, aiAllowance)
    setSaving(false)
    if (ok) onDone()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`end-${grant.email}`}>
        New end day for {grant.email}
      </label>
      <input
        id={`end-${grant.email}`}
        type="date"
        value={endDay}
        disabled={never}
        onChange={(e) => setEndDay(e.target.value)}
        className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground disabled:opacity-50"
      />
      <button type="button" className={btn} onClick={() => { setNever(false); setEndDay(addDays(base, 7)) }}>
        +7 days
      </button>
      <button type="button" className={btn} onClick={() => { setNever(false); setEndDay(addDays(base, 30)) }}>
        +30 days
      </button>
      <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <input type="checkbox" checked={never} onChange={(e) => setNever(e.target.checked)} />
        Never
      </label>
      <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        AI allowance
        <input
          type="number"
          min="0"
          inputMode="numeric"
          value={allowance}
          placeholder="Unlimited"
          onChange={(e) => setAllowance(e.target.value)}
          className="h-8 w-24 rounded-md border border-border bg-background px-2 text-xs text-foreground"
        />
      </label>
      <button
        type="button"
        disabled={saving || (!never && !endDay)}
        onClick={save}
        className="rounded-md border border-foreground bg-foreground px-3 py-1 text-xs font-semibold text-background disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button type="button" className={btn} onClick={onDone}>
        Cancel
      </button>
      <p className="basis-full text-xs text-muted-foreground">
        Saving moves the start to now, which restarts this Organizer&apos;s access window, so their
        AI allowance count starts again from zero. Leave the allowance blank for unlimited.
      </p>
    </div>
  )
}

export default function GrantsTable({ grants, onExtend, onRevoke, onUnrevoke, onDelete }) {
  const [extending, setExtending] = useState(null)
  const [busy, setBusy] = useState(null)

  const run = async (email, fn) => {
    setBusy(email)
    await fn()
    setBusy(null)
  }

  return (
    <section aria-labelledby="grants-heading" className="rounded-2xl border border-border bg-card">
      <div className="flex items-baseline justify-between px-4 pt-4 sm:px-5">
        <h2 id="grants-heading" className="font-display text-lg font-bold text-foreground">
          Grants
        </h2>
        {grants && <span className="text-xs text-muted-foreground">{grants.length} total</span>}
      </div>

      {grants === null ? (
        <p className="px-4 py-8 text-sm text-muted-foreground sm:px-5">Loading…</p>
      ) : grants.length === 0 ? (
        <p className="px-4 py-8 text-sm text-muted-foreground sm:px-5">No Grants yet. Add one above.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr className="border-y border-border text-xs text-muted-foreground">
                <th className="px-4 py-2 font-semibold sm:px-5">Organizer</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Start</th>
                <th className="px-3 py-2 font-semibold">End</th>
                <th className="px-3 py-2 font-semibold">AI used</th>
                <th className="px-3 py-2 font-semibold">Sessions</th>
                <th className="px-3 py-2 font-semibold">Last sign-in</th>
                <th className="px-4 py-2 text-right font-semibold sm:px-5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <Fragment key={g.email}>
                  <tr className="border-b border-border align-top last:border-b-0">
                    <td className="px-4 py-3 sm:px-5">
                      <div className="font-medium text-foreground">{g.email}</div>
                      {g.note && <div className="text-xs text-muted-foreground">{g.note}</div>}
                    </td>
                    <td className={`px-3 py-3 font-semibold capitalize ${STATUS_STYLE[g.status] || ''}`}>
                      {g.status}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground" title={fmt(g.starts_at) || ''}>
                      {fmtDay(g.starts_at)}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground" title={fmt(g.expires_at) || ''}>
                      {fmtDay(g.expires_at)}
                    </td>
                    <td className="px-3 py-3 font-display text-foreground">
                      {g.ai_used}
                      <span className="text-muted-foreground"> / {g.ai_allowance ?? '∞'}</span>
                    </td>
                    <td className="px-3 py-3 font-display text-foreground">{g.session_count}</td>
                    <td className="px-3 py-3 text-muted-foreground">{fmt(g.last_sign_in_at) || 'Never'}</td>
                    <td className="px-4 py-3 sm:px-5">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button type="button" className={btn} onClick={() => setExtending(extending === g.email ? null : g.email)}>
                          Extend
                        </button>
                        {g.revoked_at ? (
                          <button
                            type="button"
                            className={btn}
                            disabled={busy === g.email}
                            onClick={() => run(g.email, () => onUnrevoke(g))}
                          >
                            Un-revoke
                          </button>
                        ) : (
                          <button
                            type="button"
                            className={btn}
                            disabled={busy === g.email}
                            onClick={() => {
                              if (window.confirm(`Revoke access for ${g.email} now? There is no grace period.`)) {
                                run(g.email, () => onRevoke(g))
                              }
                            }}
                          >
                            Revoke
                          </button>
                        )}
                        <button
                          type="button"
                          className={`${btn} hover:text-destructive`}
                          disabled={busy === g.email}
                          onClick={() => {
                            if (window.confirm(`Delete the Grant for ${g.email}? This cannot be undone.`)) {
                              run(g.email, () => onDelete(g))
                            }
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                  {extending === g.email && (
                    <tr className="border-b border-border bg-muted/40">
                      <td colSpan={8} className="px-4 py-3 sm:px-5">
                        <ExtendPanel grant={g} onExtend={onExtend} onDone={() => setExtending(null)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
