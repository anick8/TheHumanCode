'use client'

import HelpLink from '@/components/HelpLink'
import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAccess } from '@/app/components/AccessProvider'
import SessionTheme from '@/components/SessionTheme'
import { previewPlan } from '@/lib/previewPlan'
import { DEFAULT_THEME, COLOR_PRESETS, resolveTheme } from '@/lib/theme'
import LookGallery, { matchPreset } from './LookGallery'
import FineTunePanel from './FineTunePanel'
import PreviewFor from './previews'

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
const LOGO_MAX_BYTES = 2 * 1024 * 1024

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
  const [previewTab, setPreviewTab] = useState(null)
  const [sessionContent, setSessionContent] = useState({ questions: [], optionsByQuestion: {}, keys: {} })
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
        // Real question content makes the preview truthful; people stay sample.
        // The answer key is owner-only (RLS returns nothing for others).
        const { data: qs } = await supabase
          .from('questions')
          .select('*')
          .eq('session_id', sessionId)
          .order('order_index')
        const questions = qs || []
        const optionsByQuestion = {}
        const keys = {}
        if (questions.length > 0) {
          const ids = questions.map((q) => q.id)
          const [{ data: opts }, { data: keyRows }] = await Promise.all([
            supabase.from('options').select('*').in('question_id', ids).order('order_index'),
            data.session_type === 'quiz'
              ? supabase.from('question_keys').select('question_id, option_id').in('question_id', ids)
              : Promise.resolve({ data: [] }),
          ])
          for (const o of opts || []) (optionsByQuestion[o.question_id] ||= []).push(o)
          for (const k of keyRows || []) keys[k.question_id] = k.option_id
        }
        setSessionContent({ questions, optionsByQuestion, keys })
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

  const plan = previewPlan({
    sessionType: session.session_type,
    quizFormat: session.quiz_format,
    ...sessionContent,
  })
  const TABS = plan.tabs
  const activeTab = TABS.some((t) => t.key === previewTab) ? previewTab : TABS[0].key
  const onTabKey = (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
    if (!step) return
    event.preventDefault()
    const i = TABS.findIndex((t) => t.key === activeTab)
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
            <div className="flex items-center gap-2">
              <h1 className="font-display text-xl font-bold text-foreground">Design</h1>
              <HelpLink slug="design-your-session" label="About designing a session" />
            </div>
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
          type={plan.type}
          content={plan.content}
        />
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0">
          <div className="mb-3 flex items-end justify-between gap-3 border-b border-border">
            <div role="tablist" aria-label="Preview screen" onKeyDown={onTabKey} className="flex gap-5">
              {TABS.map(({ key, label }) => {
                const active = activeTab === key
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
            aria-labelledby={`design-tab-${activeTab}`}
            className="overflow-hidden rounded-2xl border border-border"
          >
            <SessionTheme theme={draft} className="min-h-[520px]">
              <div inert>
                <PreviewFor tab={activeTab} theme={draft} title={session.title} content={plan.content} />
              </div>
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
            sessionType={plan.type}
          />
        </div>
      </div>
    </div>
  )
}
