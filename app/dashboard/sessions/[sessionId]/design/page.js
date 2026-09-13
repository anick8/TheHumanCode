'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import PollQuestion from '@/components/PollQuestion'
import ResultsChart from '@/components/ResultsChart'
import SessionTheme from '@/components/SessionTheme'
import SessionLogo from '@/components/SessionLogo'
import {
  DEFAULT_THEME,
  FONT_OPTIONS,
  COLOR_PRESETS,
  resolveTheme,
  contrastRatio,
  isHexColor,
} from '@/lib/theme'

const COLOR_FIELDS = [
  { key: 'primary', label: 'Primary (buttons, highlights)' },
  { key: 'background', label: 'Background' },
  { key: 'foreground', label: 'Text' },
  { key: 'card', label: 'Cards' },
]

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
const LOGO_MAX_BYTES = 2 * 1024 * 1024

const SAMPLE_OPTIONS = [
  { id: 'a', text: 'Absolutely' },
  { id: 'b', text: 'Somewhat' },
  { id: 'c', text: 'Not really' },
]
const SAMPLE_COUNTS = { a: 12, b: 7, c: 3 }

// Store only what differs from the default, so "Reset" saves '{}' and
// default-looking sessions keep using the global stylesheet untouched.
function toStoredTheme(draft) {
  const stored = {}
  for (const [key, value] of Object.entries(draft)) {
    if (value && value !== DEFAULT_THEME[key]) stored[key] = value
  }
  return stored
}

export default function SessionDesignPage() {
  const params = useParams()
  const sessionId = params.sessionId
  const supabase = createClient()

  const [session, setSession] = useState(null)
  const [userId, setUserId] = useState(null)
  const [draft, setDraft] = useState(DEFAULT_THEME)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState(null)
  const [previewTab, setPreviewTab] = useState('voting')

  useEffect(() => {
    if (!sessionId) return
    const load = async () => {
      const [{ data: { user } }, { data, error }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('sessions').select('*').eq('id', sessionId).single(),
      ])
      if (!error) {
        setSession(data)
        setDraft(resolveTheme(data.theme))
      }
      setUserId(user?.id ?? null)
      setLoading(false)
    }
    load()
  }, [sessionId])

  const isOwner = Boolean(userId && session && userId === session.owner_id)
  const saved = JSON.stringify(toStoredTheme(resolveTheme(session?.theme)))
  const dirty = JSON.stringify(toStoredTheme(draft)) !== saved

  const set = (patch) => {
    setDraft((prev) => ({ ...prev, ...patch }))
    setMessage(null)
  }

  const uploadLogo = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!LOGO_TYPES.includes(file.type)) {
      setMessage({ type: 'error', text: 'Logo must be a PNG, JPG, SVG or WebP image.' })
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      setMessage({ type: 'error', text: 'Logo must be 2 MB or smaller.' })
      return
    }
    setUploading(true)
    setMessage(null)
    // Storage RLS only allows writes under the uploader's own uid folder.
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
    const path = `${userId}/${sessionId}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('session-logos').upload(path, file, {
      contentType: file.type,
      cacheControl: '31536000',
    })
    if (error) {
      setMessage({ type: 'error', text: `Upload failed: ${error.message}` })
    } else {
      const { data } = supabase.storage.from('session-logos').getPublicUrl(path)
      set({ logoUrl: data.publicUrl })
    }
    setUploading(false)
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    const theme = toStoredTheme(draft)
    // RLS turns a non-owner UPDATE into 0 rows, not an error - check rows.
    const { data, error } = await supabase
      .from('sessions')
      .update({ theme })
      .eq('id', sessionId)
      .select('id')
    if (error || !data?.length) {
      setMessage({ type: 'error', text: error?.message || 'Could not save. Only the session owner can edit its design.' })
    } else {
      setSession((prev) => ({ ...prev, theme }))
      setMessage({ type: 'success', text: 'Design saved. Open voting and presenter screens update live.' })
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="py-8 animate-pulse">
        <div className="h-8 w-48 rounded bg-muted mb-8"></div>
        <div className="h-96 rounded-lg bg-muted"></div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="py-8 text-center">
        <h2 className="font-display text-2xl font-bold text-foreground">Session not found</h2>
        <Link href="/dashboard" className="mt-4 inline-block text-accent hover:underline">Back to dashboard</Link>
      </div>
    )
  }

  const textContrast = contrastRatio(draft.foreground, draft.background)
  const buttonContrast = contrastRatio('#ffffff', draft.primary)
  const warnings = []
  if (textContrast !== null && textContrast < 4.5) {
    warnings.push(`Text on background has low contrast (${textContrast.toFixed(1)}:1, aim for 4.5:1).`)
  }
  if (buttonContrast !== null && buttonContrast < 3) {
    warnings.push(`White button text on the primary color is hard to read (${buttonContrast.toFixed(1)}:1).`)
  }

  const inputClass =
    'w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none'

  return (
    <div className="py-8">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href={`/dashboard/sessions/${sessionId}`} className="text-sm text-accent hover:underline">
            ← {session.title}
          </Link>
          <h1 className="mt-1 font-display text-3xl font-bold text-foreground">Design</h1>
          <p className="mt-1 text-muted-foreground">
            Fonts, colors and logo for this session&apos;s voting, presenter and results screens.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => set({ ...DEFAULT_THEME })}
            disabled={!isOwner || saving}
            className="rounded-lg border border-border bg-card px-5 py-3 font-semibold text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            Reset to default
          </button>
          <button
            onClick={save}
            disabled={!isOwner || saving || !dirty}
            className="rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 font-semibold text-white shadow-sm hover:opacity-90 transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : dirty ? 'Save design' : 'Saved'}
          </button>
        </div>
      </div>

      {!isOwner && (
        <div className="mb-6 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Only the session owner can change its design.
        </div>
      )}
      {message && (
        <div
          className={`mb-6 rounded-lg border px-4 py-3 text-sm ${
            message.type === 'error'
              ? 'border-destructive/30 bg-destructive/10 text-destructive'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* Controls */}
        <fieldset disabled={!isOwner} className="space-y-6">
          <section className="rounded-2xl border border-border bg-card p-6">
            <h2 className="font-display text-lg font-bold text-foreground">Logo</h2>
            <div className="mt-4 flex min-h-20 items-center justify-center rounded-lg border border-dashed border-border bg-muted p-4">
              {draft.logoUrl ? (
                <SessionLogo theme={draft} className="h-14" />
              ) : (
                <span className="text-sm text-muted-foreground">No logo</span>
              )}
            </div>
            <div className="mt-4 flex gap-3">
              <label className="flex-1 cursor-pointer rounded-lg border border-border px-4 py-2 text-center text-sm font-medium text-foreground hover:bg-muted transition-colors">
                {uploading ? 'Uploading…' : draft.logoUrl ? 'Replace logo' : 'Upload logo'}
                <input type="file" accept={LOGO_TYPES.join(',')} onChange={uploadLogo} disabled={uploading} className="sr-only" />
              </label>
              {draft.logoUrl && (
                <button
                  type="button"
                  onClick={() => set({ logoUrl: null })}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">PNG, JPG, SVG or WebP, up to 2 MB. Transparent PNG or SVG works best.</p>
          </section>

          <section className="rounded-2xl border border-border bg-card p-6">
            <h2 className="font-display text-lg font-bold text-foreground">Colors</h2>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {COLOR_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => set({ primary: preset.primary, background: preset.background, foreground: preset.foreground, card: preset.card })}
                  title={preset.name}
                  className="rounded-lg border border-border p-2 text-left hover:border-primary transition-colors"
                >
                  <div className="flex h-8 overflow-hidden rounded" style={{ background: preset.background }}>
                    <span className="m-1.5 w-1/3 rounded-sm" style={{ background: preset.primary }} />
                    <span className="my-1.5 mr-1.5 flex-1 rounded-sm" style={{ background: preset.card }} />
                  </div>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">{preset.name}</span>
                </button>
              ))}
            </div>
            <div className="mt-6 space-y-4">
              {COLOR_FIELDS.map(({ key, label }) => (
                <ColorField key={key} label={label} value={draft[key]} onChange={(value) => set({ [key]: value })} inputClass={inputClass} />
              ))}
            </div>
            {warnings.length > 0 && (
              <ul className="mt-4 space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
                {warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-card p-6">
            <h2 className="font-display text-lg font-bold text-foreground">Fonts</h2>
            <div className="mt-4 space-y-4">
              {[
                { key: 'headingFont', label: 'Headings' },
                { key: 'bodyFont', label: 'Body text' },
              ].map(({ key, label }) => (
                <label key={key} className="block">
                  <span className="mb-1 block text-sm font-medium text-foreground">{label}</span>
                  <select value={draft[key]} onChange={(e) => set({ [key]: e.target.value })} className={inputClass}>
                    {FONT_OPTIONS.map((font) => (
                      <option key={font} value={font}>{font}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>
        </fieldset>

        {/* Live preview */}
        <div className="min-w-0">
          <div className="mb-4 flex gap-2">
            {[
              { key: 'voting', label: 'Voting' },
              { key: 'presenter', label: 'Presenter' },
              { key: 'results', label: 'Results' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setPreviewTab(key)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  previewTab === key ? 'bg-primary text-primary-foreground' : 'border border-border text-foreground hover:bg-muted'
                }`}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto self-center text-xs text-muted-foreground">Live preview{dirty ? ' · unsaved' : ''}</span>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border">
            <SessionTheme theme={draft} className="min-h-[520px]">
              {previewTab === 'voting' && <VotingPreview theme={draft} title={session.title} />}
              {previewTab === 'presenter' && <PresenterPreview theme={draft} title={session.title} />}
              {previewTab === 'results' && <ResultsPreview theme={draft} title={session.title} />}
            </SessionTheme>
          </div>
        </div>
      </div>
    </div>
  )
}

function ColorField({ label, value, onChange, inputClass }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={isHexColor(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="h-10 w-12 shrink-0 cursor-pointer rounded border border-border bg-transparent"
        />
        <input
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (isHexColor(e.target.value)) onChange(e.target.value.toLowerCase())
          }}
          maxLength={7}
          className={`${inputClass} font-mono`}
        />
      </div>
    </div>
  )
}

function PreviewHeader({ theme, title, subtitle }) {
  return (
    <div className="flex items-center gap-4 border-b border-border bg-card px-6 py-4">
      <SessionLogo theme={theme} className="h-9 shrink-0" />
      <div className="min-w-0">
        <p className="truncate font-display text-lg font-bold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  )
}

function VotingPreview({ theme, title }) {
  return (
    <div className="bg-gradient-to-br from-background to-muted min-h-[520px]">
      <PreviewHeader theme={theme} title={title} subtitle="Question 1 of 3" />
      <div className="p-6">
        <PollQuestion
          question={{ text: 'Did you enjoy the session?' }}
          options={SAMPLE_OPTIONS}
          onVote={async () => {}}
        />
      </div>
    </div>
  )
}

function PresenterPreview({ theme, title }) {
  return (
    <div className="flex min-h-[520px] flex-col">
      <PreviewHeader theme={theme} title={title} subtitle="Question 1 of 3" />
      <div className="flex-1 px-8 py-10">
        <p className="text-sm font-semibold uppercase tracking-widest text-accent">Question 1 of 3</p>
        <h2 className="mt-3 font-display text-3xl font-bold leading-tight text-foreground">Did you enjoy the session?</h2>
        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          {SAMPLE_OPTIONS.map((option, i) => (
            <div key={option.id} className="flex items-center rounded-xl border border-border bg-card px-5 py-4 text-lg text-foreground">
              <span className="mr-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 font-display text-accent">
                {String.fromCharCode(65 + i)}
              </span>
              {option.text}
            </div>
          ))}
        </div>
      </div>
      <div className="flex justify-end border-t border-border px-6 py-4">
        <span className="rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 font-semibold text-white">Next question →</span>
      </div>
    </div>
  )
}

function ResultsPreview({ theme, title }) {
  return (
    <div className="p-6">
      <SessionLogo theme={theme} className="mb-4 h-10" />
      <h2 className="font-display text-2xl font-bold text-foreground">Results: {title}</h2>
      <p className="mt-1 text-muted-foreground">22 votes · Did you enjoy the session?</p>
      <div className="mt-6 rounded-2xl border border-border bg-card p-6">
        <ResultsChart options={SAMPLE_OPTIONS} voteCounts={SAMPLE_COUNTS} live={false} />
      </div>
    </div>
  )
}
