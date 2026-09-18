'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { generateJoinToken } from '@/lib/utils'

export default function JoinGate({ session, onJoined }) {
  const [name, setName] = useState('')
  const [externalId, setExternalId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const supabase = createClient()

  const requiresName = session?.identity_requires_name !== false
  const requiresId = Boolean(session?.identity_requires_id)
  const collected = requiresName && requiresId ? 'name and ID' : requiresName ? 'name' : 'ID'

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)

    if (requiresName && !name.trim()) {
      setError('Enter your name to join.')
      return
    }
    if (requiresId && !externalId.trim()) {
      setError('Enter your ID to join.')
      return
    }

    setSubmitting(true)
    try {
      const joinToken = generateJoinToken()
      const { data, error: rpcError } = await supabase.rpc('join_session', {
        p_session_id: session.id,
        p_name: name.trim() || null,
        p_external_id: externalId.trim() || null,
        p_join_token: joinToken,
      })
      if (rpcError) throw rpcError

      const row = data?.[0]
      if (!row) throw new Error('Could not join this session.')

      onJoined({
        id: row.participant_id,
        name: row.participant_name,
        external_id: row.participant_external_id,
        join_token: joinToken,
      })
    } catch (err) {
      setError(err.message || 'Could not join. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-md py-8">
      <div className="rounded-2xl border border-border bg-card p-8 shadow-lg">
        <h1 className="font-display text-2xl font-bold text-foreground">Join this session</h1>
        <p className="mt-2 text-muted-foreground">
          {session?.title} collects your {collected} so the organizer can see who responded.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {requiresName && (
            <div>
              <label htmlFor="join-name" className="block text-sm font-medium text-foreground mb-2">
                Name
              </label>
              <input
                id="join-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="block w-full rounded-lg border border-border px-4 py-3 text-foreground shadow-sm focus:border-ring focus:ring-2 focus:ring-ring focus:ring-opacity-20"
                placeholder="Your name"
              />
            </div>
          )}

          {requiresId && (
            <div>
              <label htmlFor="join-id" className="block text-sm font-medium text-foreground mb-2">
                ID
              </label>
              <input
                id="join-id"
                type="text"
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                className="block w-full rounded-lg border border-border px-4 py-3 text-foreground shadow-sm focus:border-ring focus:ring-2 focus:ring-ring focus:ring-opacity-20"
                placeholder="Employee / student number or email"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Recognises you if you rejoin from another device. It is not verified.
              </p>
            </div>
          )}

          {error && (
            <p className="text-sm font-medium text-destructive">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-base font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Joining…' : 'Join and vote'}
          </button>
        </form>

        <p className="mt-4 text-xs text-muted-foreground">
          Your answers are stored with your {collected} and visible to the organizer. Only your first answer
          on each question is recorded.
        </p>
      </div>
    </div>
  )
}
