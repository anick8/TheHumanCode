'use client'

import { useState } from 'react'
import { addDays, istDay } from '@/lib/grantDates'

const inputClass =
  'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-2 focus:outline-offset-2 focus:outline-ring disabled:opacity-50'

export default function GrantForm({ initialEmail = '', onSubmit }) {
  const today = istDay()
  const [email, setEmail] = useState(initialEmail)
  const [note, setNote] = useState('')
  const [startDay, setStartDay] = useState(today)
  const [endDay, setEndDay] = useState('')
  const [never, setNever] = useState(true)
  const [allowance, setAllowance] = useState('')
  const [saving, setSaving] = useState(false)

  const shortcut = (days) => {
    setNever(false)
    setEndDay(addDays(startDay || today, days))
  }

  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    const ok = await onSubmit({
      email,
      note,
      startDay: startDay || today,
      endDay: never ? null : endDay,
      aiAllowance: allowance.trim() === '' ? null : Math.max(0, parseInt(allowance, 10) || 0),
    })
    setSaving(false)
    if (ok) {
      setEmail('')
      setNote('')
      setStartDay(today)
      setEndDay('')
      setNever(true)
      setAllowance('')
    }
  }

  const canSubmit = email.trim() && (never || endDay) && !saving

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <h2 className="font-display text-lg font-bold text-foreground">Add a Grant</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs font-semibold text-muted-foreground lg:col-span-2">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="organizer@example.com"
            className={`mt-1 ${inputClass}`}
          />
        </label>
        <label className="block text-xs font-semibold text-muted-foreground lg:col-span-2">
          Note
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Who, and what for"
            className={`mt-1 ${inputClass}`}
          />
        </label>
        <label className="block text-xs font-semibold text-muted-foreground">
          Start day
          <input
            type="date"
            value={startDay}
            onChange={(e) => setStartDay(e.target.value)}
            className={`mt-1 ${inputClass}`}
          />
        </label>
        <div>
          <label className="block text-xs font-semibold text-muted-foreground">
            End day
            <input
              type="date"
              value={endDay}
              disabled={never}
              onChange={(e) => setEndDay(e.target.value)}
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <button type="button" onClick={() => shortcut(7)} className="rounded-md border border-border px-2 py-1 font-semibold text-foreground hover:bg-muted">
              +7 days
            </button>
            <button type="button" onClick={() => shortcut(30)} className="rounded-md border border-border px-2 py-1 font-semibold text-foreground hover:bg-muted">
              +30 days
            </button>
            <label className="inline-flex items-center gap-1.5 text-muted-foreground">
              <input type="checkbox" checked={never} onChange={(e) => setNever(e.target.checked)} />
              Never expires
            </label>
          </div>
        </div>
        <label className="block text-xs font-semibold text-muted-foreground">
          AI allowance (calls)
          <input
            type="number"
            min="0"
            inputMode="numeric"
            value={allowance}
            onChange={(e) => setAllowance(e.target.value)}
            placeholder="Unlimited"
            className={`mt-1 ${inputClass}`}
          />
        </label>
        <div className="flex items-end sm:justify-end">
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-5 text-sm font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {saving ? 'Adding…' : 'Add Grant'}
          </button>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        A start of today means access begins immediately; later days begin at 00:00 India time. The
        end day finishes at 23:59 India time, then a 6-hour grace applies. The AI allowance is
        counted from the start.
      </p>
    </form>
  )
}
