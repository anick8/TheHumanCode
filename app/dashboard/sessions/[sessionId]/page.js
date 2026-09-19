'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import QRCodeDisplay from '@/components/QRCodeDisplay'
import SessionForm from '@/components/SessionForm'
import QuestionEditor from '@/components/QuestionEditor'
import AssistantPanel from '@/components/AssistantPanel'
import { formatDateTime, getAppUrl } from '@/lib/utils'

const SESSION_TYPE_LABELS = { poll: 'Voting poll', quiz: 'Quiz', comments: 'Image & comments' }

export default function SessionDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [questions, setQuestions] = useState([])
  const [optionsByQuestion, setOptionsByQuestion] = useState({})
  const [activeTab, setActiveTab] = useState('questions') // 'questions' or 'qr'
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [saveMessage, setSaveMessage] = useState(null)
  const [userId, setUserId] = useState(null)
  const [hasVotes, setHasVotes] = useState(false)
  const [questionKeys, setQuestionKeys] = useState({})
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [appliedSettings, setAppliedSettings] = useState(null)
  const supabase = createClient()
  const searchParams = useSearchParams()

  const sessionId = params.sessionId
  // Handed over by the dashboard's "Create with AI" composer, which creates the
  // session row and then sends the organizer straight here with their prompt.
  const seedPrompt = searchParams.get('prompt')
  const isOwner = Boolean(userId && session && userId === session.owner_id)
  const isComments = session?.session_type === 'comments'

  useEffect(() => {
    if (sessionId) {
      loadSession()
      loadQuestions()
    }
  }, [sessionId])

  useEffect(() => {
    if (searchParams.get('assistant') === '1') setAssistantOpen(true)
  }, [searchParams])

  const loadSession = async () => {
    try {
      const [{ data: { user } }, { data, error }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('sessions').select('*').eq('id', sessionId).single(),
      ])

      if (error) throw error
      setUserId(user?.id ?? null)
      setSession(data)
    } catch (error) {
      console.error('Error loading session:', error)
      // Session might not exist - redirect to dashboard
      router.push('/dashboard')
    }
  }

  const loadQuestions = async () => {
    try {
      // Try to load questions and options
      const { data: questionsData, error: questionsError } = await supabase
        .from('questions')
        .select('*')
        .eq('session_id', sessionId)
        .order('order_index')

      if (questionsError && !questionsError.message.includes('does not exist')) {
        throw questionsError
      }

      const loadedQuestions = questionsData || []

      // Load options for each question
      const optionsMap = {}
      for (const question of loadedQuestions) {
        const { data: optionsData, error: optionsError } = await supabase
          .from('options')
          .select('*')
          .eq('question_id', question.id)
          .order('order_index')

        if (!optionsError) {
          optionsMap[question.id] = optionsData || []
        }
      }

      setQuestions(loadedQuestions)
      setOptionsByQuestion(optionsMap)

      const questionIds = loadedQuestions.map((q) => q.id)

      // Answer keys are owner-only; the select returns nothing for non-owners.
      if (questionIds.length > 0) {
        const { data: keysData, error: keysError } = await supabase
          .from('question_keys')
          .select('question_id, option_id')
          .in('question_id', questionIds)
        if (keysError && !keysError.message.includes('does not exist')) throw keysError
        const keyMap = {}
        for (const key of keysData || []) keyMap[key.question_id] = key.option_id
        setQuestionKeys(keyMap)
      } else {
        setQuestionKeys({})
      }

      // The session type is locked once voting has started (the DB trigger is
      // the real guard; this drives the disabled form state).
      if (questionIds.length > 0) {
        const { count } = await supabase
          .from('votes')
          .select('id', { count: 'exact', head: true })
          .in('question_id', questionIds)
        setHasVotes((count || 0) > 0)
      } else {
        setHasVotes(false)
      }
    } catch (error) {
      console.error('Error loading questions:', error)
      // Tables might not exist yet - that's ok
      setQuestions([])
      setOptionsByQuestion({})
    } finally {
      setLoading(false)
    }
  }

  // Image upload for comments-session questions, same pattern as the design
  // page's logo upload: storage RLS only allows writes under the uploader's
  // own uid folder, so the path is keyed by userId, not the question.
  const uploadQuestionImage = async (file, questionId) => {
    const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
    const IMAGE_MAX_BYTES = 5 * 1024 * 1024
    if (!IMAGE_TYPES.includes(file.type)) {
      throw new Error('Image must be a PNG, JPG, WebP or GIF.')
    }
    if (file.size > IMAGE_MAX_BYTES) {
      throw new Error('Image must be 5 MB or smaller.')
    }
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
    const path = `${userId}/${sessionId}-${questionId}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('session-images').upload(path, file, {
      contentType: file.type,
      cacheControl: '31536000',
    })
    if (error) throw new Error(error.message)
    const { data } = supabase.storage.from('session-images').getPublicUrl(path)
    return data.publicUrl
  }

  const updateSession = async (formData) => {
    try {
      const { data, error } = await supabase
        .from('sessions')
        .update(formData)
        .eq('id', sessionId)
        .select()

      if (error) throw error

      if (data?.[0]) {
        setSession(data[0])
      }
    } catch (error) {
      console.error('Error updating session:', error)
      alert('Failed to update session. Please try again.')
    }
  }

  // Editor state only. QuestionEditor fires this on every keystroke, so writes
  // are deferred to saveQuestions() rather than hitting the database per char.
  const updateQuestions = (updatedQuestions, updatedOptions) => {
    setQuestions(updatedQuestions)
    setOptionsByQuestion(updatedOptions)
    setSaveMessage(null)
  }

  const updateQuestionKey = (questionId, optionId) => {
    setQuestionKeys((prev) => ({ ...prev, [questionId]: optionId }))
    setSaveMessage(null)
  }

  // Apply an assistant draft to the editor. This writes nothing to the
  // database - it produces the same temp-id shapes QuestionEditor creates by
  // hand, so the existing saveQuestions() persists them unchanged once the
  // organizer has reviewed the draft and pressed Save.
  const applyProposal = (kind, input) => {
    if (kind === 'settings') {
      // Merged into SessionForm's own state, not written. The organizer still
      // presses Save there, exactly as if they had changed the fields by hand.
      setAppliedSettings({ nonce: Date.now(), values: input?.settings ?? {} })
      setActiveTab('settings')
      setSaveMessage('Draft settings applied below — review them, then press Save.')
      return
    }

    const stamp = Date.now()
    const newQuestions = []
    const newOptions = {}
    const newKeys = {}

    ;(input?.questions ?? []).forEach((question, index) => {
      const questionId = `temp_${stamp}_${index}`
      newQuestions.push({
        id: questionId,
        text: question.text,
        order_index: index,
        points: Number.isInteger(question.points) ? question.points : 10,
        options: [],
      })
      newOptions[questionId] = (question.options ?? []).map((option, optionIndex) => ({
        id: `opt_${questionId}_${optionIndex}`,
        text: option.text,
        order_index: optionIndex,
      }))
      const correct = question.correct_option_index
      if (Number.isInteger(correct) && newOptions[questionId][correct]) {
        newKeys[questionId] = newOptions[questionId][correct].id
      }
    })

    if (input?.mode === 'replace') {
      const reindexed = newQuestions.map((question, index) => ({ ...question, order_index: index }))
      updateQuestions(reindexed, newOptions)
      setQuestionKeys(newKeys)
    } else {
      const offset = questions.length
      const appended = newQuestions.map((question, index) => ({
        ...question,
        order_index: offset + index,
      }))
      updateQuestions([...questions, ...appended], { ...optionsByQuestion, ...newOptions })
      setQuestionKeys((prev) => ({ ...prev, ...newKeys }))
    }

    setActiveTab('questions')
  }

  // Persist the editor's current state to Supabase. New rows carry temp ids
  // (temp_/opt_ prefixes) and are inserted; existing uuids are updated; rows
  // removed in the editor are deleted. Deleting a question cascades to its
  // options and any votes cast on them.
  const saveQuestions = async () => {
    // RLS rejects writes to sessions the user doesn't own (including the
    // ownerless demo sessions); say so plainly instead of surfacing the
    // raw "violates row-level security policy" error.
    if (!isOwner) {
      setSaveError("You can't edit this session because it doesn't belong to your account. Create your own session to add questions.")
      return
    }
    const blankIndex = questions.findIndex((q) => !(q.text || '').trim())
    if (blankIndex !== -1) {
      setSaveError(
        `Question ${blankIndex + 1} has no text. Add text or delete it before saving.`
      )
      setSaveMessage(null)
      return
    }

    if (session?.is_scored) {
      const invalidIndex = questions.findIndex((q) => {
        const opts = (optionsByQuestion[q.id] || []).filter((o) => (o.text || '').trim())
        const correctId = questionKeys[q.id]
        return opts.length < 2 || !correctId || !opts.some((o) => o.id === correctId)
      })
      if (invalidIndex !== -1) {
        setSaveError(
          `Question ${invalidIndex + 1} needs at least 2 options and a marked correct answer before saving.`
        )
        setSaveMessage(null)
        return
      }
    }

    if (isComments) {
      const missingImage = questions.findIndex((q) => !q.image_url)
      if (missingImage !== -1) {
        setSaveError(`Question ${missingImage + 1} has no image. Upload one or delete it before saving.`)
        setSaveMessage(null)
        return
      }
    }

    setSaving(true)
    setSaveError(null)
    setSaveMessage(null)

    try {
      // Rows currently in the database for this session
      const { data: dbQuestions, error: dbError } = await supabase
        .from('questions')
        .select('id')
        .eq('session_id', sessionId)

      if (dbError) throw dbError

      const dbQuestionIds = new Set((dbQuestions || []).map((q) => q.id))
      const keptQuestionIds = new Set(
        questions
          .filter((q) => !String(q.id).startsWith('temp_'))
          .map((q) => q.id)
      )

      // Questions the organizer removed in the editor
      const questionsToDelete = [...dbQuestionIds].filter(
        (id) => !keptQuestionIds.has(id)
      )
      if (questionsToDelete.length > 0) {
        const { error } = await supabase
          .from('questions')
          .delete()
          .in('id', questionsToDelete)
        if (error) throw error
      }

      // Insert or update each question, recording temp id -> real uuid so the
      // options below can reference a row that actually exists.
      const questionIdMap = {}
      for (const [index, question] of questions.entries()) {
        const text = question.text.trim()
        const points = Number.isFinite(Number(question.points))
          ? Math.max(0, Math.round(Number(question.points)))
          : 10

        // image_url only applies to comments-session questions; undefined for
        // poll/quiz rows leaves the column untouched.
        const fields = { text, order_index: index, points }
        if (isComments) fields.image_url = question.image_url || null

        if (String(question.id).startsWith('temp_')) {
          const { data, error } = await supabase
            .from('questions')
            .insert({ session_id: sessionId, ...fields })
            .select('id')
            .single()
          if (error) throw error
          questionIdMap[question.id] = data.id
        } else {
          const { error } = await supabase
            .from('questions')
            .update(fields)
            .eq('id', question.id)
          if (error) throw error
          questionIdMap[question.id] = question.id
        }
      }

      // Comments sessions have no options or answer key - each question is
      // just an image + prompt, so skip both passes below entirely.
      const optionIdMap = {}
      for (const question of isComments ? [] : questions) {
        const realQuestionId = questionIdMap[question.id]
        if (!realQuestionId) continue
        optionIdMap[question.id] = {}

        const editorOptions = (optionsByQuestion[question.id] || []).filter((o) =>
          (o.text || '').trim()
        )

        const { data: dbOptions, error: optionsError } = await supabase
          .from('options')
          .select('id')
          .eq('question_id', realQuestionId)
        if (optionsError) throw optionsError

        const dbOptionIds = new Set((dbOptions || []).map((o) => o.id))
        const keptOptionIds = new Set(
          editorOptions.filter((o) => dbOptionIds.has(o.id)).map((o) => o.id)
        )

        const optionsToDelete = [...dbOptionIds].filter(
          (id) => !keptOptionIds.has(id)
        )
        if (optionsToDelete.length > 0) {
          const { error } = await supabase
            .from('options')
            .delete()
            .in('id', optionsToDelete)
          if (error) throw error
        }

        for (const [index, option] of editorOptions.entries()) {
          const text = option.text.trim()

          if (dbOptionIds.has(option.id)) {
            const { error } = await supabase
              .from('options')
              .update({ text, order_index: index })
              .eq('id', option.id)
            if (error) throw error
            optionIdMap[question.id][option.id] = option.id
          } else {
            const { data: inserted, error } = await supabase
              .from('options')
              .insert({ question_id: realQuestionId, text, order_index: index })
              .select('id')
              .single()
            if (error) throw error
            optionIdMap[question.id][option.id] = inserted.id
          }
        }
      }

      // Reconcile answer keys for scored sessions (owner-only table).
      if (session?.is_scored) {
        for (const question of questions) {
          const realQuestionId = questionIdMap[question.id]
          if (!realQuestionId) continue
          const desired = questionKeys[question.id]
          const realOptionId = desired ? optionIdMap[question.id]?.[desired] : null

          if (realOptionId) {
            const { error } = await supabase
              .from('question_keys')
              .upsert(
                { question_id: realQuestionId, option_id: realOptionId },
                { onConflict: 'question_id' }
              )
            if (error) throw error
          } else {
            const { error } = await supabase
              .from('question_keys')
              .delete()
              .eq('question_id', realQuestionId)
            if (error) throw error
          }
        }
      }

      // Reload so temp ids are replaced by the real uuids just written
      await loadQuestions()
      setSaveMessage('Questions saved. Attendees can now see them.')
    } catch (error) {
      console.error('Error saving questions:', error)
      setSaveError(
        error.message ||
          'Failed to save questions. Make sure you are signed in as the session owner.'
      )
    } finally {
      setSaving(false)
    }
  }

  const deleteSession = async () => {
    if (!confirm('Are you sure you want to delete this session? This action cannot be undone.')) {
      return
    }

    try {
      const { error } = await supabase
        .from('sessions')
        .delete()
        .eq('id', sessionId)

      if (error) throw error

      router.push('/dashboard')
    } catch (error) {
      console.error('Error deleting session:', error)
      alert('Failed to delete session. Please try again.')
    }
  }

  const viewResults = () => {
    router.push(`/dashboard/sessions/${sessionId}/results`)
  }

  // Start (or resume) a host-driven presentation. An unfinished run resumes
  // where it left off; otherwise reset to the lobby (-1), which puts every
  // attendee device on the "waiting for the host" screen.
  const startPresenting = async () => {
    const idx = session?.current_question_index
    const inProgress = idx !== null && idx !== undefined && idx < questions.length
    if (!inProgress) {
      const { data, error } = await supabase
        .from('sessions')
        .update({ current_question_index: -1, results_revealed: false })
        .eq('id', sessionId)
        .select('id')
      if (error || !data?.length) {
        alert(error?.message || 'Could not start the presentation.')
        return
      }
    }
    router.push(`/present/${sessionId}`)
  }

  if (loading) {
    return (
      <div className="py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-muted rounded w-48 mb-8"></div>
          <div className="h-64 bg-muted rounded-lg"></div>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="py-8 text-center">
        <h2 className="font-display text-2xl font-bold text-foreground">Session not found</h2>
        <p className="mt-2 text-muted-foreground">The session you're looking for doesn't exist.</p>
        <button
          onClick={() => router.push('/dashboard')}
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
        >
          Back to Dashboard
        </button>
      </div>
    )
  }

  return (
    <div className="py-8">
      {!isOwner && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          This session doesn&apos;t belong to your account, so it&apos;s read-only. Changes to questions, settings or design won&apos;t save.
        </div>
      )}
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold text-foreground">{session.title}</h1>
            <div className="mt-2 flex items-center space-x-4 text-muted-foreground">
              <span className="flex items-center">
                <svg className="h-4 w-4 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                </svg>
                Created {formatDateTime(session.created_at)}
              </span>
              <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
                session.is_active
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-muted text-foreground'
              }`}>
                {session.is_active ? 'Active' : 'Inactive'}
              </span>
              <span className="inline-flex items-center rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-accent capitalize">
                {SESSION_TYPE_LABELS[session.session_type] || session.session_type}
              </span>
              {!isComments && (
                <span className="inline-flex items-center rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-accent capitalize">
                  {session.results_mode} results
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={startPresenting}
              className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
            >
              <svg className="mr-2 h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
              {session.current_question_index !== null &&
              session.current_question_index !== undefined &&
              session.current_question_index < questions.length
                ? 'Resume'
                : 'Start'}
            </button>
            {isOwner && (
              <button
                onClick={() => setAssistantOpen(true)}
                className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-6 py-3 text-base font-semibold text-foreground shadow-sm hover:bg-muted transition-colors"
              >
                <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
                AI Assistant
              </button>
            )}
            <button
              onClick={() => router.push(`/dashboard/sessions/${sessionId}/design`)}
              className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-6 py-3 text-base font-semibold text-foreground shadow-sm hover:bg-muted transition-colors"
            >
              <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
              </svg>
              Design
            </button>
            <button
              onClick={viewResults}
              className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-6 py-3 text-base font-semibold text-foreground shadow-sm hover:bg-muted transition-colors"
            >
              <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              View Results
            </button>
            <button
              onClick={deleteSession}
              className="inline-flex items-center justify-center rounded-lg border border-destructive/40 bg-card px-6 py-3 text-base font-semibold text-destructive shadow-sm hover:bg-destructive/10 transition-colors"
            >
              <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-8 border-b border-border">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('questions')}
            className={`whitespace-nowrap py-4 px-1 border-b-2 text-sm font-medium ${
              activeTab === 'questions'
                ? 'border-ring text-accent'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            <svg className="mr-2 h-5 w-5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Questions
          </button>
          <button
            onClick={() => setActiveTab('qr')}
            className={`whitespace-nowrap py-4 px-1 border-b-2 text-sm font-medium ${
              activeTab === 'qr'
                ? 'border-ring text-accent'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            <svg className="mr-2 h-5 w-5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
            QR Code
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`whitespace-nowrap py-4 px-1 border-b-2 text-sm font-medium ${
              activeTab === 'settings'
                ? 'border-ring text-accent'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            <svg className="mr-2 h-5 w-5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'questions' && (
        <div className="space-y-8">
          <QuestionEditor
            questions={questions}
            optionsByQuestion={optionsByQuestion}
            onQuestionsChange={updateQuestions}
            questionKeys={questionKeys}
            onQuestionKeysChange={updateQuestionKey}
            isScored={Boolean(session?.is_scored)}
            sessionType={session?.session_type}
            onImageUpload={uploadQuestionImage}
            locked={hasVotes && Boolean(session?.is_scored)}
            loading={loading}
          />

          {/* Save bar */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center justify-between gap-6">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-foreground">
                  Publish to attendees
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Edits above are held in the browser until you save. Attendees at{' '}
                  <code className="text-foreground">/vote/{session.slug}</code> only see
                  saved questions.
                </p>
              </div>
              <button
                onClick={saveQuestions}
                disabled={saving}
                className="inline-flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Questions'}
              </button>
            </div>

            {saveError && (
              <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                <p className="text-sm font-medium text-destructive">{saveError}</p>
              </div>
            )}

            {saveMessage && (
              <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                <p className="text-sm font-medium text-emerald-300">{saveMessage}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'qr' && (
        <QRCodeDisplay slug={session.slug} />
      )}

      {activeTab === 'settings' && (
        <div className="space-y-8">
          <SessionForm
            initialData={session}
            onSubmit={updateSession}
            loading={loading}
            lockParticipation={hasVotes}
            appliedSettings={appliedSettings}
          />

          {/* Voting URL */}
          <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
            <h3 className="text-xl font-semibold text-foreground mb-4">Voting URL</h3>
            <p className="text-muted-foreground mb-4">
              Share this URL with attendees. They can open it directly without scanning the QR code.
            </p>
            <div className="bg-muted rounded-lg p-4">
              <code className="text-foreground break-all">
                {getAppUrl()}/vote/{session.slug}
              </code>
            </div>
            <div className="mt-4 flex space-x-4">
              <button
                onClick={() => navigator.clipboard.writeText(`${getAppUrl()}/vote/${session.slug}`)}
                className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-6 py-3 text-base font-semibold text-foreground shadow-sm hover:bg-muted transition-colors"
              >
                <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy URL
              </button>
              <button
                onClick={() => window.open(`/vote/${session.slug}`, '_blank')}
                className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
              >
                <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Open Voting Page
              </button>
            </div>
          </div>
        </div>
      )}

      {isOwner && (
        <AssistantPanel
          open={assistantOpen}
          onClose={() => setAssistantOpen(false)}
          sessionId={sessionId}
          seedPrompt={seedPrompt}
          onApplyProposal={applyProposal}
          hasVotes={hasVotes}
          isScored={Boolean(session?.is_scored)}
        />
      )}
    </div>
  )
}