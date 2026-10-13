'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import ConfirmDialog from '@/components/ConfirmDialog'
import StatusLine from './StatusLine'

// Same minimum the sign-up form enforces.
const MIN_PASSWORD = 6

const inputClass =
  'mt-2 w-full rounded-lg border border-border bg-input px-3 py-2 text-foreground focus:border-primary focus:outline-none'

export default function SecurityCard({ user }) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState(null)

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD
  const mismatch = confirm.length > 0 && confirm !== password
  const ready = password.length >= MIN_PASSWORD && confirm === password

  const changePassword = async (event) => {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setMsg({ type: 'error', text: error.message || 'Could not update your password.' })
    } else {
      setPassword('')
      setConfirm('')
      setMsg({ type: 'success', text: 'Password updated. Use it the next time you sign in.' })
    }
    setBusy(false)
  }

  const signOutEverywhere = async () => {
    setSigningOut(true)
    setSignOutError(null)
    const { error } = await supabase.auth.signOut({ scope: 'global' })
    if (error) {
      setSignOutError(error.message || 'Could not sign you out everywhere. Try again.')
      setSigningOut(false)
      return
    }
    router.push('/login')
    router.refresh()
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6" aria-labelledby="security-heading">
      <h2 id="security-heading" className="font-display text-lg font-bold text-foreground">
        Security
      </h2>

      <div className="mt-4">
        <p className="text-sm font-medium text-foreground">Email</p>
        <p className="mt-1 break-all text-foreground">{user?.email}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Your access is tied to this address, so it can&apos;t be changed here.
        </p>
      </div>

      <hr className="my-6 border-border" />

      <form onSubmit={changePassword} noValidate>
        <label htmlFor="new-password" className="block text-sm font-medium text-foreground">
          New password
        </label>
        <input
          id="new-password"
          type="password"
          value={password}
          autoComplete="new-password"
          onChange={(e) => {
            setPassword(e.target.value)
            setMsg(null)
          }}
          aria-invalid={tooShort}
          aria-describedby="new-password-hint"
          className={inputClass}
        />
        <p id="new-password-hint" className={`mt-2 text-sm ${tooShort ? 'text-destructive' : 'text-muted-foreground'}`}>
          At least {MIN_PASSWORD} characters.
        </p>

        <label htmlFor="confirm-password" className="mt-4 block text-sm font-medium text-foreground">
          Confirm new password
        </label>
        <input
          id="confirm-password"
          type="password"
          value={confirm}
          autoComplete="new-password"
          onChange={(e) => {
            setConfirm(e.target.value)
            setMsg(null)
          }}
          aria-invalid={mismatch}
          aria-describedby={mismatch ? 'confirm-password-hint' : undefined}
          className={inputClass}
        />
        {mismatch && (
          <p id="confirm-password-hint" className="mt-2 text-sm text-destructive">
            The two passwords don&apos;t match.
          </p>
        )}

        <button
          type="submit"
          disabled={!ready || busy}
          className="mt-4 rounded-lg border border-border bg-muted px-5 py-2.5 font-semibold text-foreground transition-colors hover:border-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Updating…' : 'Update password'}
        </button>
        <StatusLine message={msg} />
      </form>

      <hr className="my-6 border-border" />

      <div>
        <p className="text-sm font-medium text-foreground">Devices</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Signed in on a venue laptop or a shared screen? End every session on every device, including this one.
        </p>
        <button
          type="button"
          onClick={() => {
            setSignOutError(null)
            setConfirmOpen(true)
          }}
          className="mt-4 rounded-lg border border-border px-5 py-2.5 font-semibold text-destructive transition-colors hover:bg-destructive/10"
        >
          Sign out everywhere
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Sign out everywhere?"
        confirmLabel="Sign out everywhere"
        busyLabel="Signing out…"
        busy={signingOut}
        error={signOutError}
        onConfirm={signOutEverywhere}
        onCancel={() => setConfirmOpen(false)}
      >
        <p className="mt-2 text-sm text-muted-foreground">
          You&apos;ll be signed out on this device and every other one. Any presenter screen that&apos;s open will stop
          responding to controls until you sign in again.
        </p>
      </ConfirmDialog>
    </section>
  )
}
