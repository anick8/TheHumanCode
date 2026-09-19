'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDateTime, generateSlug } from '@/lib/utils'

const SESSION_TYPE_LABELS = { poll: 'Voting poll', quiz: 'Quiz', comments: 'Image & comments' }
import { createClient } from '@/lib/supabase/client'

export default function DashboardHome() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiType, setAiType] = useState('poll')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)
  const router = useRouter()
  const supabase = createClient()

  // "Create with AI" makes an empty quiz session with the same payload the
  // normal New Session form submits, then hands the prompt to the assistant in
  // the editor. The editor stays the only place questions are written.
  const createWithAi = async (event) => {
    event.preventDefault()
    const prompt = aiPrompt.trim()
    if (!prompt || creating) return

    setCreating(true)
    setCreateError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      // A quick, cheap non-streaming call - separate from the chat assistant,
      // which is a full tool-calling conversation. Never blocks creation: any
      // failure here (missing key, network, bad response) falls back to the
      // same placeholder the route itself falls back to.
      let title = 'Untitled Session'
      try {
        const titleRes = await fetch('/api/assistant/title', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt }),
        })
        if (titleRes.ok) {
          const titleData = await titleRes.json()
          if (titleData.title) title = titleData.title
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
          // The chosen type decides participation_mode, and the pair has to
          // satisfy sessions_type_consistency. A poll is anonymous; a quiz
          // names its participants and may be scored later in Settings.
          session_type: aiType,
          participation_mode: aiType === 'poll' ? 'anonymous' : 'identified',
          identity_requires_name: true,
          identity_requires_id: false,
          is_scored: false,
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

  useEffect(() => {
    loadSessions()
  }, [])

  const loadSessions = async () => {
    try {
      // RLS also exposes every *active* session publicly (attendees need that),
      // so filter to the user's own - otherwise public demo sessions show up
      // here as editable and fail on save.
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

  if (loading) {
    return (
      <div className="py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-muted rounded w-48 mb-8"></div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-44 bg-muted rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="py-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground">Your Sessions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create and manage your poll sessions. Each session has a unique QR code for attendees.
          </p>
        </div>
        <Link
          href="/dashboard/sessions/new"
          className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
        >
          <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Session
        </Link>
      </div>

      {/* Create with AI */}
      <form onSubmit={createWithAi} className="mb-8 rounded-2xl border border-border bg-card p-5 shadow-xs">
        <label htmlFor="ai-prompt" className="block text-sm font-semibold text-foreground">
          Create with AI
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          Describe the quiz you want — topic, audience, and how many questions. You&apos;ll review
          every question before anything is saved.
        </p>
        <div
          role="radiogroup"
          aria-label="Session type"
          className="mt-3 inline-flex rounded-lg border border-border bg-muted p-1"
        >
          {[
            { value: 'poll', label: 'Voting poll', hint: 'Anonymous — no name needed' },
            { value: 'quiz', label: 'Quiz', hint: 'Participants give a name' },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={aiType === option.value}
              title={option.hint}
              onClick={() => setAiType(option.value)}
              className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-colors ${
                aiType === option.value
                  ? 'bg-gradient-to-r from-primary to-accent text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {aiType === 'poll'
            ? 'Attendees vote anonymously. You can turn this into a scored quiz later.'
            : 'Attendees enter a name. Turn on scoring in Settings once the questions are in.'}
        </p>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            id="ai-prompt"
            type="text"
            value={aiPrompt}
            onChange={(event) => setAiPrompt(event.target.value)}
            placeholder="A 6-question quiz on renewable energy for a non-technical audience"
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
          />
          <button
            type="submit"
            disabled={creating || !aiPrompt.trim()}
            className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
            {creating ? 'Starting…' : 'Draft it'}
          </button>
        </div>
        {createError && (
          <p className="mt-2 text-xs text-destructive">{createError}</p>
        )}
      </form>

      {/* Empty State */}
      {sessions.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-border p-12 text-center bg-card">
          <div className="mx-auto h-20 w-20 rounded-full bg-muted flex items-center justify-center text-accent">
            <svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="mt-5 text-lg font-bold text-foreground">No sessions yet</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Create your first poll session to generate a QR code for your event attendees to scan and vote.
          </p>
          <div className="mt-6">
            <Link
              href="/dashboard/sessions/new"
              className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
            >
              <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Your First Session
            </Link>
          </div>
        </div>
      )}

      {/* Sessions Grid */}
      {sessions.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {sessions.map((session) => (
            <Link
              key={session.id}
              href={`/dashboard/sessions/${session.id}`}
              className="group block rounded-xl border border-border bg-card p-6 shadow-xs hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-foreground group-hover:text-accent">
                    {session.title}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Slug: <code className="px-1.5 py-0.5 bg-muted rounded text-foreground font-mono">{session.slug}</code>
                  </p>
                </div>
                <div className="flex-shrink-0">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    session.is_active
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-muted text-foreground'
                  }`}>
                    {session.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="text-muted-foreground">Type</div>
                  <div className="font-medium text-foreground mt-0.5">
                    {SESSION_TYPE_LABELS[session.session_type] || session.session_type}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Created</div>
                  <div className="font-medium text-foreground mt-0.5">
                    {formatDateTime(session.created_at)}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
                <div className="flex items-center text-xs text-muted-foreground">
                  <svg className="mr-1.5 h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Manage Poll
                </div>
                <div className="text-xs font-medium text-accent group-hover:translate-x-0.5 transition-transform">
                  View details →
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Setup Instructions Helper */}
      <div className="mt-12 rounded-xl border border-border bg-muted/70 p-6">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-accent mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-semibold text-foreground">Database Schema Ready</h3>
            <div className="mt-1 text-xs text-accent leading-relaxed">
              <p>
                Make sure you have run the schema in <code className="bg-primary/15 px-1 py-0.5 rounded font-mono">database-setup.sql</code> inside your Supabase SQL Editor.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
