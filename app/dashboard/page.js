'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { generateSlug } from '@/lib/utils'

import { createClient } from '@/lib/supabase/client'
import { useAccess } from '@/app/components/AccessProvider'
import { startPresentation } from '@/lib/presenting'
import ConfirmDialog from '@/components/ConfirmDialog'
import CreateBar from './components/CreateBar'
import SessionFilters from './components/SessionFilters'
import SessionList from './components/SessionList'
import SessionInspector from './components/SessionInspector'

/*
  THESIS: the dashboard is a run sheet with a stage manager's inspector. Select
  a session and everything needed to run it (QR, join link, Active switch,
  Present) is beside it, instead of a grid of cards you click into.
  OWN-WORLD: Stage Charcoal ground, Card Slate panels, 1px Hairline rules,
  titles in Orbitron, tonal controls. One orange element per screen: Present.
  STORY: arrive, scan the list, filter or search, select, run it. Or describe a
  session and draft it.
  FIRST VIEWPORT: console nav, full-width create bar, search + type chips, then
  the list (~60%) with a sticky inspector (~40%) on the most recent session.
  FORM: list + inspector, structure 6 of 7, seed 658f4c4d.
  FINISH: unreviewed and undocumented is unfinished; this build ends with the
  finish review, the verdict, DESIGN.md, and every shipping raster carrying its
  provenance.
*/

// Preferred chip order; any unknown future type is appended after these.
const TYPE_ORDER = ['poll', 'quiz', 'wheel', 'treasure_hunt', 'comments']

const DESKTOP_QUERY = '(min-width: 1024px)'

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY)
    const update = () => setIsDesktop(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])
  return isDesktop
}

export default function DashboardHome() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [aiPrompt, setAiPrompt] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [questionCount, setQuestionCount] = useState(null)
  const [presenting, setPresenting] = useState(false)
  const [inspectorError, setInspectorError] = useState(null)
  // The session whose Delete confirmation is open.
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const searchRef = useRef(null)
  const isDesktop = useIsDesktop()
  const { access } = useAccess()
  const readOnly = access.readOnly

  // ----- data ---------------------------------------------------------------

  useEffect(() => {
    const load = async () => {
      try {
        // RLS also exposes every *active* session publicly (attendees need
        // that), so filter to the user's own - otherwise public demo sessions
        // show up here as editable and fail on save.
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) {
          setSessions([])
          return
        }
        const { data, error } = await supabase
          .from('sessions')
          .select('*')
          .eq('owner_id', user.id)
          .order('created_at', { ascending: false })

        if (error) throw error
        setSessions(data || [])
      } catch (error) {
        console.error('Error loading sessions:', error)
        setSessions([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [supabase])

  // Restore the selection from ?s= once the list is in.
  const restoredRef = useRef(false)
  useEffect(() => {
    if (loading || restoredRef.current) return
    restoredRef.current = true
    const fromUrl = new URLSearchParams(window.location.search).get('s')
    if (fromUrl && sessions.some((s) => s.id === fromUrl)) setSelectedId(fromUrl)
  }, [loading, sessions])

  // ----- derived list ---------------------------------------------------------

  const counts = useMemo(() => {
    const byType = {}
    for (const s of sessions) byType[s.session_type] = (byType[s.session_type] || 0) + 1
    return { all: sessions.length, byType }
  }, [sessions])

  const types = useMemo(() => {
    const present = Object.keys(counts.byType)
    return [
      ...TYPE_ORDER.filter((t) => present.includes(t)),
      ...present.filter((t) => !TYPE_ORDER.includes(t)),
    ]
  }, [counts])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return sessions.filter((s) => {
      if (typeFilter !== 'all' && s.session_type !== typeFilter) return false
      if (!needle) return true
      return (
        (s.title || '').toLowerCase().includes(needle) ||
        (s.slug || '').toLowerCase().includes(needle)
      )
    })
  }, [sessions, query, typeFilter])

  // A filter can hide the selected session; if the type chip vanished (its last
  // session was deleted) fall back to All.
  useEffect(() => {
    if (typeFilter !== 'all' && !types.includes(typeFilter)) setTypeFilter('all')
  }, [types, typeFilter])

  // Desktop always shows an inspector: keep the selection on a visible row,
  // defaulting to the most recent. Narrow layouts start collapsed.
  useEffect(() => {
    if (loading || !restoredRef.current) return
    const stillVisible = visible.some((s) => s.id === selectedId)
    if (stillVisible) return
    if (isDesktop && visible.length > 0) setSelectedId(visible[0].id)
    else if (selectedId !== null) setSelectedId(null)
  }, [loading, visible, selectedId, isDesktop])

  // Keep ?s= in step with the selection without adding history entries.
  useEffect(() => {
    if (loading || !restoredRef.current) return
    const url = new URL(window.location.href)
    if (selectedId) url.searchParams.set('s', selectedId)
    else url.searchParams.delete('s')
    window.history.replaceState(window.history.state, '', url)
  }, [selectedId, loading])

  const selected = useMemo(
    () => sessions.find((s) => s.id === selectedId) || null,
    [sessions, selectedId]
  )

  // Question count for the selected session; a wheel has no questions.
  useEffect(() => {
    setInspectorError(null)
    setQuestionCount(null)
    if (!selected || selected.session_type === 'wheel') return
    let cancelled = false
    supabase
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', selected.id)
      .then(({ count, error }) => {
        if (cancelled) return
        if (error) {
          console.error('Error counting questions:', error)
          setQuestionCount(0)
        } else {
          setQuestionCount(count ?? 0)
        }
      })
    return () => {
      cancelled = true
    }
  }, [selected?.id, selected?.session_type, supabase]) // eslint-disable-line react-hooks/exhaustive-deps

  // "/" focuses search from anywhere that is not already a text field.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // ----- actions ------------------------------------------------------------

  const clearFilters = useCallback(() => {
    setQuery('')
    setTypeFilter('all')
  }, [])

  const openEditor = (session) => router.push(`/dashboard/sessions/${session.id}`)

  const present = async (session) => {
    if (presenting || readOnly) return
    setPresenting(true)
    setInspectorError(null)

    // The count can still be loading when P is pressed; resuming depends on it,
    // so fetch it here rather than risk resetting a run in progress.
    let count = session.id === selected?.id ? questionCount : null
    if (count === null && session.session_type !== 'wheel') {
      const { count: fetched } = await supabase
        .from('questions')
        .select('id', { count: 'exact', head: true })
        .eq('session_id', session.id)
      count = fetched ?? 0
    }

    const { error } = await startPresentation(supabase, session, count ?? 0)
    if (error) {
      setInspectorError(error)
      setPresenting(false)
      return
    }
    router.push(`/present/${session.id}`)
  }

  const toggleActive = async (session) => {
    if (readOnly) return
    const next = !session.is_active
    setInspectorError(null)
    setSessions((prev) => prev.map((s) => (s.id === session.id ? { ...s, is_active: next } : s)))
    const { data, error } = await supabase
      .from('sessions')
      .update({ is_active: next })
      .eq('id', session.id)
      .select('id')
    if (error || !data?.length) {
      setSessions((prev) =>
        prev.map((s) => (s.id === session.id ? { ...s, is_active: !next } : s))
      )
      setInspectorError(error?.message || 'Could not update the session. Try again.')
    }
  }

  const askDelete = (session) => {
    setDeleteError(null)
    setPendingDelete(session)
  }

  const deleteSession = async () => {
    if (!pendingDelete || readOnly) return
    setDeleting(true)
    setDeleteError(null)
    const { error } = await supabase.from('sessions').delete().eq('id', pendingDelete.id)
    setDeleting(false)
    if (error) {
      console.error('Error deleting session:', error)
      setDeleteError('Failed to delete session. Please try again.')
      return
    }
    setSessions((prev) => prev.filter((s) => s.id !== pendingDelete.id))
    setPendingDelete(null)
  }

  // "Create with AI" makes an empty session with the same payload the normal
  // New Session form submits, then hands the prompt to the assistant in the
  // editor. The editor stays the only place questions are written.
  const createWithAi = async (event) => {
    event.preventDefault()
    const prompt = aiPrompt.trim()
    if (!prompt || creating || readOnly) return

    setCreating(true)
    setCreateError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      // A quick, cheap non-streaming call - separate from the chat assistant,
      // which is a full tool-calling conversation. Never blocks creation: any
      // failure here (missing key, network, bad response) falls back to the
      // same placeholder the route itself falls back to.
      let title = 'Untitled Session'
      let sessionType = 'poll'
      try {
        const titleRes = await fetch('/api/assistant/title', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt }),
        })
        if (titleRes.ok) {
          const titleData = await titleRes.json()
          if (titleData.title) title = titleData.title
          if (titleData.sessionType === 'poll' || titleData.sessionType === 'quiz') {
            sessionType = titleData.sessionType
          }
        }
      } catch {
        // Network failure - keep the placeholder.
      }

      const { data, error } = await supabase
        .from('sessions')
        .insert([{
          title,
          slug: generateSlug(),
          results_mode: 'live',
          // The type is inferred from the prompt and decides participation_mode;
          // the pair has to satisfy sessions_type_consistency. A poll is
          // anonymous; a quiz names its participants and is always scored.
          session_type: sessionType,
          participation_mode: sessionType === 'poll' ? 'anonymous' : 'identified',
          identity_requires_name: true,
          identity_requires_id: false,
          is_scored: sessionType === 'quiz',
          score_time_limit_seconds: null,
          is_active: true,
          owner_id: user?.id,
        }])
        .select()

      if (error) throw error

      router.push(
        `/dashboard/sessions/${data[0].id}?assistant=1&prompt=${encodeURIComponent(prompt)}`
      )
    } catch (error) {
      setCreateError(error.message || 'Could not start a session. Try again.')
      setCreating(false)
    }
  }

  // ----- render ---------------------------------------------------------------

  if (loading) {
    return (
      <div className="animate-pulse space-y-4 py-2" aria-busy="true" aria-label="Loading sessions">
        <div className="h-[104px] rounded-2xl bg-card" />
        <div className="h-10 w-full rounded-xl bg-card lg:w-80" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="h-80 rounded-2xl bg-card" />
          <div className="hidden h-80 rounded-2xl bg-card lg:block" />
        </div>
      </div>
    )
  }

  const inspector = (session) => (
    <SessionInspector
      key={session.id}
      session={session}
      questionCount={questionCount}
      presenting={presenting}
      error={inspectorError}
      onPresent={present}
      onToggleActive={toggleActive}
      onDelete={askDelete}
      readOnly={readOnly}
    />
  )

  return (
    <div className="space-y-5 py-2">
      <h1 className="sr-only">Your sessions</h1>
      {access.untilLabel && (
        <p className="text-xs text-muted-foreground" data-access-until>
          {access.untilLabel}
        </p>
      )}

      <CreateBar
        value={aiPrompt}
        onChange={setAiPrompt}
        onSubmit={createWithAi}
        creating={creating}
        error={createError}
        readOnly={readOnly}
      />

      {sessions.length > 0 && (
        <SessionFilters
          ref={searchRef}
          query={query}
          onQuery={setQuery}
          typeFilter={typeFilter}
          onType={setTypeFilter}
          counts={counts}
          types={types}
        />
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <SessionList
          sessions={visible}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onOpen={openEditor}
          onPresent={present}
          renderInline={isDesktop ? null : inspector}
          totalCount={sessions.length}
          readOnly={readOnly}
          onClearFilters={clearFilters}
        />
        {isDesktop && selected && (
          <aside aria-label="Selected session" className="sticky top-20">
            <div className="inspector-swap">{inspector(selected)}</div>
          </aside>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={`Delete "${pendingDelete?.title ?? ''}"?`}
        confirmLabel="Delete"
        busyLabel="Deleting…"
        busy={deleting}
        error={deleteError}
        onConfirm={deleteSession}
        onCancel={() => setPendingDelete(null)}
      >
        <p className="mt-3 text-sm text-foreground">
          This deletes the session, its questions and all responses.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">This cannot be undone.</p>
      </ConfirmDialog>
    </div>
  )
}
