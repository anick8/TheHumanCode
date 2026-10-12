'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { endOfDayIst, renewalStartsAt, startsAtForDay } from '@/lib/grantDates'
import GrantForm from './components/GrantForm'
import GrantsTable from './components/GrantsTable'
import LeadsList from './components/LeadsList'

export default function AdminPage() {
  const supabase = useMemo(() => createClient(), [])
  const [grants, setGrants] = useState(null)
  const [leads, setLeads] = useState([])
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  // `nonce` re-keys the form so "Grant access" can pre-fill an already-mounted form.
  const [draft, setDraft] = useState({ email: '', nonce: 0 })

  const load = useCallback(async () => {
    const [grantsRes, leadsRes] = await Promise.all([
      supabase.rpc('admin_list_grants'),
      supabase.from('leads').select('id, email, created_at').order('created_at', { ascending: false }),
    ])
    if (grantsRes.error) {
      setLoadError(grantsRes.error.message)
      return
    }
    setLoadError('')
    setGrants(grantsRes.data || [])
    setLeads(leadsRes.data || [])
  }, [supabase])

  useEffect(() => {
    load()
  }, [load])

  // Run a write against allowed_emails, then refresh. RLS is the gate.
  const write = async (request) => {
    setActionError('')
    const { error } = await request
    if (error) {
      setActionError(
        error.code === '23505'
          ? 'That email already has a Grant. Extend it from the table instead.'
          : error.message
      )
      return false
    }
    await load()
    return true
  }

  const addGrant = ({ email, note, startDay, endDay, aiAllowance }) =>
    write(
      supabase.from('allowed_emails').insert({
        email: email.trim().toLowerCase(),
        note: note.trim() || null,
        starts_at: startsAtForDay(startDay),
        expires_at: endDay ? endOfDayIst(endDay) : null,
        ai_allowance: aiAllowance,
      })
    )

  // Extending also moves starts_at to now so the AI allowance window restarts.
  const extendGrant = (grant, endDay) =>
    write(
      supabase
        .from('allowed_emails')
        .update({
          starts_at: renewalStartsAt(grant.starts_at),
          expires_at: endDay ? endOfDayIst(endDay) : null,
        })
        .eq('email', grant.email)
    )

  const setRevoked = (grant, revoked) =>
    write(
      supabase
        .from('allowed_emails')
        .update({ revoked_at: revoked ? new Date().toISOString() : null })
        .eq('email', grant.email)
    )

  const deleteGrant = (grant) =>
    write(supabase.from('allowed_emails').delete().eq('email', grant.email))

  const grantedEmails = new Set((grants || []).map((g) => g.email))
  const openLeads = leads.filter((lead) => !grantedEmails.has(lead.email.toLowerCase()))

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-wide text-foreground">Access</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Grant organizer access for a date range. Days run on India time; dates below are shown in
          your local time zone.
        </p>
      </header>

      {loadError && (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-card px-4 py-3 text-sm text-destructive">
          Could not load Grants: {loadError}
        </p>
      )}
      {actionError && (
        <p role="alert" className="rounded-xl border border-destructive/40 bg-card px-4 py-3 text-sm text-destructive">
          {actionError}
        </p>
      )}

      <GrantForm key={draft.nonce} initialEmail={draft.email} onSubmit={addGrant} />

      <GrantsTable
        grants={grants}
        onExtend={extendGrant}
        onRevoke={(g) => setRevoked(g, true)}
        onUnrevoke={(g) => setRevoked(g, false)}
        onDelete={deleteGrant}
      />

      <LeadsList
        leads={openLeads}
        onGrant={(email) => {
          setDraft((d) => ({ email, nonce: d.nonce + 1 }))
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      />
    </div>
  )
}
