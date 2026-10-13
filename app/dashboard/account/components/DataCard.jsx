'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { SESSION_CSV_COLUMNS, sessionRows, toCsv } from '@/lib/accountStats'
import StatusLine from './StatusLine'

function download(filename, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const buttonClass =
  'rounded-lg border border-border bg-muted px-5 py-2.5 font-semibold text-foreground transition-colors hover:border-muted-foreground disabled:cursor-not-allowed disabled:opacity-50'

// A copy of your sessions, built in the browser from what RLS lets you read.
// Individual responses and participant names are left out on purpose.
export default function DataCard({ user, stats }) {
  const supabase = useMemo(() => createClient(), [])
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)

  const fetchSessions = async () => {
    const { data, error } = await supabase
      .from('sessions')
      .select('*, questions(id, text, order_index, points, options(id, text, order_index))')
      .eq('owner_id', user.id)
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data || []).map((s) => ({
      ...s,
      questions: [...(s.questions || [])]
        .sort((a, b) => a.order_index - b.order_index)
        .map((q) => ({ ...q, options: [...(q.options || [])].sort((a, b) => a.order_index - b.order_index) })),
    }))
  }

  const run = async (kind) => {
    setBusy(kind)
    setMsg(null)
    try {
      const sessions = await fetchSessions()
      const day = new Date().toISOString().slice(0, 10)
      if (kind === 'json') {
        const payload = {
          exported_at: new Date().toISOString(),
          account: user.email,
          totals: stats?.totals ?? null,
          sessions,
        }
        download(`mc-genie-sessions-${day}.json`, 'application/json', JSON.stringify(payload, null, 2))
      } else {
        const counts = Object.fromEntries(sessions.map((s) => [s.id, s.questions.length]))
        download(
          `mc-genie-sessions-${day}.csv`,
          'text/csv;charset=utf-8',
          toCsv(SESSION_CSV_COLUMNS, sessionRows(sessions, counts))
        )
      }
      setMsg({ type: 'success', text: `Downloaded ${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}.` })
    } catch (error) {
      console.error('Export error:', error)
      setMsg({ type: 'error', text: 'Could not build the export. Try again.' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6" aria-labelledby="data-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <h2 id="data-heading" className="font-display text-lg font-bold text-foreground">
            Your data
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Download your sessions with their questions and options. JSON keeps the full structure and account totals;
            CSV is one row per session for a spreadsheet. Individual responses and participant names aren&apos;t included.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => run('json')} disabled={busy !== null} className={buttonClass}>
            {busy === 'json' ? 'Preparing…' : 'Download JSON'}
          </button>
          <button type="button" onClick={() => run('csv')} disabled={busy !== null} className={buttonClass}>
            {busy === 'csv' ? 'Preparing…' : 'Download CSV'}
          </button>
        </div>
      </div>
      <StatusLine message={msg} />
    </section>
  )
}
