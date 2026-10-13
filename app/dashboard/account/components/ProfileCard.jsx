'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import InstagramBadge from '@/components/InstagramBadge'
import { parseInstagramHandle } from '@/lib/instagram'
import StatusLine from './StatusLine'

const NAME_MAX = 40

const inputClass =
  'mt-2 w-full rounded-lg border border-border bg-input px-3 py-2 text-foreground focus:border-primary focus:outline-none'
const saveClass =
  'rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-2.5 font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'

// Display name and Instagram: both live in the account's user metadata and
// follow the organizer across sessions. Each field saves on its own.
export default function ProfileCard({ user }) {
  const supabase = useMemo(() => createClient(), [])
  const savedName = String(user?.user_metadata?.display_name ?? '').trim()
  const savedHandle = parseInstagramHandle(user?.user_metadata?.instagram)

  const [name, setName] = useState(savedName)
  const [nameBusy, setNameBusy] = useState(false)
  const [nameMsg, setNameMsg] = useState(null)
  const [stored, setStored] = useState(savedName)

  const [text, setText] = useState(savedHandle ? `@${savedHandle}` : '')
  const [handle, setHandle] = useState(savedHandle)
  const [igBusy, setIgBusy] = useState(false)
  const [igMsg, setIgMsg] = useState(null)

  const trimmed = name.trim()
  const nameDirty = trimmed !== stored

  const parsed = parseInstagramHandle(text)
  const blank = text.trim() === ''
  const invalid = !blank && parsed === null
  const igDirty = (parsed ?? null) !== handle && !invalid

  const saveName = async (event) => {
    event.preventDefault()
    if (!nameDirty || nameBusy) return
    setNameBusy(true)
    setNameMsg(null)
    const { error } = await supabase.auth.updateUser({ data: { display_name: trimmed || null } })
    if (error) {
      setNameMsg({ type: 'error', text: error.message || 'Could not save your name.' })
    } else {
      setStored(trimmed)
      setName(trimmed)
      setNameMsg({ type: 'success', text: trimmed ? 'Saved.' : 'Removed. Your email is used instead.' })
    }
    setNameBusy(false)
  }

  const writeHandle = async (next) => {
    setIgBusy(true)
    setIgMsg(null)
    const { error } = await supabase.auth.updateUser({ data: { instagram: next } })
    if (error) {
      setIgMsg({ type: 'error', text: error.message || 'Could not save your Instagram.' })
    } else {
      setHandle(next)
      setText(next ? `@${next}` : '')
      setIgMsg({
        type: 'success',
        text: next
          ? 'Saved. It shows on the presenter screen the next time you open one.'
          : 'Removed. Presenter screens no longer show an Instagram code.',
      })
    }
    setIgBusy(false)
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6" aria-labelledby="profile-heading">
      <h2 id="profile-heading" className="font-display text-lg font-bold text-foreground">
        Profile
      </h2>

      <form className="mt-4" onSubmit={saveName}>
        <label htmlFor="display-name" className="block text-sm font-medium text-foreground">
          Display name
        </label>
        <input
          id="display-name"
          type="text"
          value={name}
          maxLength={NAME_MAX}
          autoComplete="name"
          placeholder="How you'd like to appear"
          onChange={(e) => {
            setName(e.target.value)
            setNameMsg(null)
          }}
          aria-describedby="display-name-hint"
          className={inputClass}
        />
        <p id="display-name-hint" className="mt-2 text-sm text-muted-foreground">
          Shown in the dashboard menu and on this page. Your audience never sees it.
        </p>
        <div className="mt-4">
          <button type="submit" disabled={!nameDirty || nameBusy} className={saveClass}>
            {nameBusy ? 'Saving…' : nameDirty ? 'Save name' : 'Saved'}
          </button>
        </div>
        <StatusLine message={nameMsg} />
      </form>

      <hr className="my-6 border-border" />

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (igDirty && !igBusy) writeHandle(parsed)
        }}
      >
        <label htmlFor="instagram" className="block text-sm font-medium text-foreground">
          Instagram handle or profile link
        </label>
        <input
          id="instagram"
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setIgMsg(null)
          }}
          placeholder="@yourhandle"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid}
          aria-describedby="instagram-hint"
          className={inputClass}
        />
        <p id="instagram-hint" className={`mt-2 text-sm ${invalid ? 'text-destructive' : 'text-muted-foreground'}`}>
          {invalid
            ? "That doesn't look like an Instagram handle. Use @name or a profile link."
            : parsed
              ? `Shown as a small QR code on every presenter screen you run, as @${parsed}.`
              : 'Shown as a small QR code on every presenter screen you run. Leave blank to show nothing.'}
        </p>

        {parsed && (
          <div className="mt-4">
            <p className="mb-2 text-sm font-medium text-foreground">What the room sees</p>
            <InstagramBadge handle={parsed} className="inline-flex" />
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-3">
          <button type="submit" disabled={!igDirty || igBusy} className={saveClass}>
            {igBusy ? 'Saving…' : igDirty ? 'Save Instagram' : 'Saved'}
          </button>
          {handle && (
            <button
              type="button"
              onClick={() => writeHandle(null)}
              disabled={igBusy}
              className="rounded-lg border border-border px-5 py-2.5 font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
        <StatusLine message={igMsg} />
      </form>
    </section>
  )
}
