'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAccess } from '@/app/components/AccessProvider'
import PollQuestion from '@/components/PollQuestion'
import ResultsChart from '@/components/ResultsChart'
import SessionTheme from '@/components/SessionTheme'
import SessionLogo from '@/components/SessionLogo'
import { DEFAULT_THEME, COLOR_PRESETS, resolveTheme } from '@/lib/theme'
import LookGallery, { matchPreset } from './LookGallery'
import FineTunePanel from './FineTunePanel'

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
  const router = useRouter()
  const { access } = useAccess()

  // Read-only accounts cannot change the design; RLS and storage refuse it too.
  useEffect(() => {
    if (access.readOnly && sessionId) router.replace(`/dashboard/sessions/${sessionId}`)
  }, [access.readOnly, sessionId, router])

  const [session, setSession] = useState(null)
  const [userId, setUserId] = useState(null)
  const [draft, setDraft] = useState(DEFAULT_THEME)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState(null)
  const [previewTab, setPreviewTab] = useState('voting')
  const colorsRef = useRef(null)

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

  const TABS = [
    { key: 'voting', label: 'Voting' },
    { key: 'presenter', label: 'Presenter' },
    { key: 'results', label: 'Results' },
  ]
  const onTabKey = (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
    if (!step) return
    event.preventDefault()
    const i = TABS.findIndex((t) => t.key === previewTab)
    const next = TABS[(i + step + TABS.length) % TABS.length].key
    setPreviewTab(next)
    document.getElementById(`design-tab-${next}`)?.focus()
  }

  const selectedLook = matchPreset(draft, COLOR_PRESETS) || 'Custom'
  // Offer the saved look as its own card only when it is not already a preset.
  const savedTheme = resolveTheme(session.theme)
  const savedIsCustom = !matchPreset(savedTheme, COLOR_PRESETS)
  const currentSelected = savedIsCustom && JSON.stringify(toStoredTheme(draft)) === JSON.stringify(toStoredTheme(savedTheme))
  const pickLook = (look) => {
    set({ primary: look.primary, background: look.background, foreground: look.foreground, card: look.card })
  }

  return (
    <div className="pb-8">
      {/* Sticky action bar: Save never scrolls away. */}
      <div className="sticky top-14 z-20 -mx-4 border-b border-border bg-background px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
          <div className="min-w-0">
            <Link href={`/dashboard/sessions/${sessionId}`} className="block truncate text-sm text-muted-foreground hover:text-foreground">
              ← {session.title}
            </Link>
            <h1 className="font-display text-xl font-bold text-foreground">Design</h1>
          </div>
          <div className="flex items-center gap-3">
            <p
              role={message?.type === 'error' ? 'alert' : 'status'}
              className={`hidden text-sm sm:block ${message?.type === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {message
                ? message.text
                : dirty
                  ? 'Unsaved changes'
                  : 'All changes saved'}
            </p>
            <button
              onClick={() => set({ ...DEFAULT_THEME })}
              disabled={!isOwner || saving}
              className="h-11 rounded-xl border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              Reset to default
            </button>
            <button
              onClick={save}
              disabled={!isOwner || saving || !dirty}
              className="h-11 rounded-xl bg-gradient-to-r from-primary to-accent px-6 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? 'Saving…' : dirty ? 'Save design' : 'Saved'}
            </button>
          </div>
        </div>
        {message && (
          <p
            role={message.type === 'error' ? 'alert' : 'status'}
            className={`pb-3 text-sm sm:hidden ${message.type === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {message.text}
          </p>
        )}
      </div>

      {!isOwner && (
        <div className="mt-6 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Only the session owner can change its design.
        </div>
      )}

      <section aria-labelledby="look-heading" className="mt-6">
        <h2 id="look-heading" className="mb-3 font-display text-lg font-bold text-foreground">Pick a look</h2>
        <LookGallery
          presets={COLOR_PRESETS}
          draft={draft}
          saved={savedIsCustom ? savedTheme : null}
          selected={currentSelected ? 'Current' : selectedLook}
          onPick={pickLook}
          onCustom={() => {
            if (colorsRef.current) {
              colorsRef.current.open = true
              colorsRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
            }
          }}
          disabled={!isOwner}
        />
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0">
          <div className="mb-3 flex items-end justify-between gap-3 border-b border-border">
            <div role="tablist" aria-label="Preview screen" onKeyDown={onTabKey} className="flex gap-5">
              {TABS.map(({ key, label }) => {
                const active = previewTab === key
                return (
                  <button
                    key={key}
                    id={`design-tab-${key}`}
                    role="tab"
                    type="button"
                    aria-selected={active}
                    aria-controls="design-preview"
                    tabIndex={active ? 0 : -1}
                    onClick={() => setPreviewTab(key)}
                    className={`-mb-px h-11 border-b-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                      active
                        ? 'border-foreground text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            <span className="pb-3 text-xs text-muted-foreground">Live preview{dirty ? ' · unsaved' : ''}</span>
          </div>

          <div
            id="design-preview"
            role="tabpanel"
            aria-labelledby={`design-tab-${previewTab}`}
            className="overflow-hidden rounded-2xl border border-border"
          >
            <SessionTheme theme={draft} className="min-h-[520px]">
              {previewTab === 'voting' && <VotingPreview theme={draft} title={session.title} />}
              {previewTab === 'presenter' && <PresenterPreview theme={draft} title={session.title} />}
              {previewTab === 'results' && <ResultsPreview theme={draft} title={session.title} />}
            </SessionTheme>
          </div>
        </div>

        <div className="min-w-0 lg:sticky lg:top-[calc(3.5rem+4rem+1.5rem)]">
          <FineTunePanel
            draft={draft}
            set={set}
            disabled={!isOwner}
            uploading={uploading}
            onUpload={uploadLogo}
            logoTypes={LOGO_TYPES}
            colorsRef={colorsRef}
          />
        </div>
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
