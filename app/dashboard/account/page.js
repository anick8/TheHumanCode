'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import InstagramBadge from '@/components/InstagramBadge'
import { parseInstagramHandle } from '@/lib/instagram'

export default function AccountPage() {
  const supabase = useMemo(() => createClient(), [])
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(null) // handle currently stored, or null
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      const handle = parseInstagramHandle(user?.user_metadata?.instagram)
      setSaved(handle)
      setText(handle ? `@${handle}` : '')
      setLoading(false)
    }
    load()
  }, [supabase])

  const parsed = parseInstagramHandle(text)
  const blank = text.trim() === ''
  const invalid = !blank && parsed === null
  const dirty = (parsed ?? null) !== saved && !invalid

  const write = async (handle) => {
    setSaving(true)
    setMessage(null)
    const { error } = await supabase.auth.updateUser({ data: { instagram: handle } })
    if (error) {
      setMessage({ type: 'error', text: error.message || 'Could not save your Instagram.' })
    } else {
      setSaved(handle)
      setText(handle ? `@${handle}` : '')
      setMessage({
        type: 'success',
        text: handle ? 'Saved. It shows on the presenter screen the next time you open one.' : 'Removed. Presenter screens no longer show an Instagram code.',
      })
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="py-8 animate-pulse">
        <div className="mb-8 h-8 w-48 rounded bg-muted"></div>
        <div className="h-64 rounded-lg bg-muted"></div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl py-8">
      <h1 className="font-display text-3xl font-bold text-foreground">Account</h1>
      <p className="mt-1 text-muted-foreground">Settings that follow you across every session.</p>

      {message && (
        <div
          className={`mt-6 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'error'
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          }`}
        >
          {message.text}
        </div>
      )}

      <form
        className="mt-6 rounded-2xl border border-border bg-card p-6"
        onSubmit={(e) => {
          e.preventDefault()
          if (dirty && !saving) write(parsed)
        }}
      >
        <h2 className="font-display text-lg font-bold text-foreground">Instagram</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Shown as a small QR code in the corner of every presenter screen you run, so the room can follow you.
        </p>

        <label htmlFor="instagram" className="mt-5 block text-sm font-medium text-foreground">
          Handle or profile link
        </label>
        <input
          id="instagram"
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setMessage(null)
          }}
          placeholder="@yourhandle"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid}
          aria-describedby="instagram-hint"
          className="mt-2 w-full rounded-lg border border-border bg-input px-3 py-2 text-foreground focus:border-primary focus:outline-none"
        />
        <p id="instagram-hint" className={`mt-2 text-sm ${invalid ? 'text-destructive' : 'text-muted-foreground'}`}>
          {invalid
            ? "That doesn't look like an Instagram handle. Use @name or a profile link."
            : parsed
              ? `Will show as @${parsed}`
              : 'Leave blank to show nothing.'}
        </p>

        {parsed && (
          <div className="mt-5">
            <p className="mb-2 text-sm font-medium text-foreground">What the room sees</p>
            <InstagramBadge handle={parsed} className="inline-flex" />
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={!dirty || saving}
            className="rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 font-semibold text-white shadow-sm hover:opacity-90 transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
          {saved && (
            <button
              type="button"
              onClick={() => write(null)}
              disabled={saving}
              className="rounded-lg border border-border px-5 py-3 font-semibold text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
