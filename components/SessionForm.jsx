'use client'

import { useState } from 'react'
import { generateSlug } from '@/lib/utils'

export default function SessionForm({ onSubmit, initialData = null, loading = false, lockParticipation = false }) {
  const [formData, setFormData] = useState({
    title: initialData?.title || '',
    slug: initialData?.slug || generateSlug(),
    results_mode: initialData?.results_mode || 'live',
    participation_mode: initialData?.participation_mode || 'anonymous',
    identity_requires_name: initialData?.identity_requires_name ?? true,
    identity_requires_id: initialData?.identity_requires_id ?? false,
    is_scored: initialData?.is_scored ?? false,
    score_time_limit_seconds: initialData?.score_time_limit_seconds ?? null,
    is_active: initialData?.is_active ?? true,
  })
  const [formError, setFormError] = useState(null)

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  // Anonymous sessions cannot be scored (enforced by a DB constraint too), so
  // switching back clears the scoring configuration.
  const setParticipationMode = (mode) => {
    setFormData(prev => ({
      ...prev,
      participation_mode: mode,
      ...(mode === 'anonymous'
        ? { is_scored: false, score_time_limit_seconds: null }
        : {}),
    }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (
      formData.participation_mode === 'identified' &&
      !formData.identity_requires_name &&
      !formData.identity_requires_id
    ) {
      setFormError('Choose at least one field to collect: name or ID.')
      return
    }
    setFormError(null)
    onSubmit(formData)
  }

  const regenerateSlug = () => {
    setFormData(prev => ({ ...prev, slug: generateSlug() }))
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
      <h2 className="font-display text-2xl font-semibold text-foreground mb-6">
        {initialData ? 'Edit Session' : 'Create New Session'}
      </h2>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Title */}
        <div>
          <label htmlFor="title" className="block text-sm font-medium text-foreground mb-2">
            Session Title
          </label>
          <input
            type="text"
            id="title"
            value={formData.title}
            onChange={(e) => updateField('title', e.target.value)}
            className="block w-full rounded-lg border border-border px-4 py-3 text-foreground shadow-sm focus:border-ring focus:ring-2 focus:ring-ring focus:ring-opacity-20"
            placeholder="e.g., Conference Feedback 2024"
            required
          />
          <p className="mt-2 text-sm text-muted-foreground">
            A descriptive title for your poll session. This is only visible to you.
          </p>
        </div>

        {/* Slug */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label htmlFor="slug" className="block text-sm font-medium text-foreground">
              URL Slug
            </label>
            <button
              type="button"
              onClick={regenerateSlug}
              className="inline-flex items-center text-sm font-medium text-accent hover:text-accent"
            >
              <svg className="mr-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Generate New
            </button>
          </div>
          <div className="flex">
            <div className="flex-1">
              <input
                type="text"
                id="slug"
                value={formData.slug}
                onChange={(e) => updateField('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                className="block w-full rounded-l-lg border border-r-0 border-border px-4 py-3 text-foreground focus:border-ring focus:ring-2 focus:ring-ring focus:ring-opacity-20"
                pattern="[a-z0-9-]+"
                title="Use lowercase letters, numbers, and hyphens only"
                required
              />
            </div>
            <div className="inline-flex items-center rounded-r-lg border border-l-0 border-border bg-muted px-4">
              <span className="text-muted-foreground">/vote/</span>
              <span className="ml-1 font-medium text-foreground">{formData.slug}</span>
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            The unique URL path for your session. Use only lowercase letters, numbers, and hyphens.
          </p>
        </div>

        {/* Results Mode */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            Results Display
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className={`relative rounded-lg border p-4 cursor-pointer transition-colors ${
              formData.results_mode === 'live'
                ? 'border-ring bg-muted ring-2 ring-primary/20'
                : 'border-border hover:bg-muted'
            }`}>
              <input
                type="radio"
                name="results_mode"
                value="live"
                checked={formData.results_mode === 'live'}
                onChange={(e) => updateField('results_mode', e.target.value)}
                className="sr-only"
              />
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <div className="h-5 w-5 rounded-full border flex items-center justify-center">
                    <div className={`h-2.5 w-2.5 rounded-full ${
                      formData.results_mode === 'live' ? 'bg-primary' : 'bg-transparent'
                    }`} />
                  </div>
                </div>
                <div className="ml-3">
                  <span className="block text-sm font-semibold text-foreground">Live Results</span>
                  <span className="block mt-1 text-sm text-muted-foreground">
                    After each question, a results page shows how everyone voted on it.
                  </span>
                </div>
              </div>
            </label>

            <label className={`relative rounded-lg border p-4 cursor-pointer transition-colors ${
              formData.results_mode === 'after_all'
                ? 'border-ring bg-muted ring-2 ring-primary/20'
                : 'border-border hover:bg-muted'
            }`}>
              <input
                type="radio"
                name="results_mode"
                value="after_all"
                checked={formData.results_mode === 'after_all'}
                onChange={(e) => updateField('results_mode', e.target.value)}
                className="sr-only"
              />
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <div className="h-5 w-5 rounded-full border flex items-center justify-center">
                    <div className={`h-2.5 w-2.5 rounded-full ${
                      formData.results_mode === 'after_all' ? 'bg-primary' : 'bg-transparent'
                    }`} />
                  </div>
                </div>
                <div className="ml-3">
                  <span className="block text-sm font-semibold text-foreground">After All Questions</span>
                  <span className="block mt-1 text-sm text-muted-foreground">
                    Results for every question are shown once, after the last question.
                  </span>
                </div>
              </div>
            </label>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose when attendees can see voting results. You can change this later.
          </p>
        </div>

        {/* Session Type */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="block text-sm font-medium text-foreground">Session Type</label>
            {lockParticipation && (
              <span className="text-xs text-muted-foreground">Locked after the first vote</span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className={`relative rounded-lg border p-4 transition-colors ${
              lockParticipation ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
            } ${
              formData.participation_mode === 'anonymous'
                ? 'border-ring bg-muted ring-2 ring-primary/20'
                : 'border-border hover:bg-muted'
            }`}>
              <input
                type="radio"
                name="participation_mode"
                value="anonymous"
                checked={formData.participation_mode === 'anonymous'}
                onChange={(e) => setParticipationMode(e.target.value)}
                disabled={lockParticipation}
                className="sr-only"
              />
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <div className="h-5 w-5 rounded-full border flex items-center justify-center">
                    <div className={`h-2.5 w-2.5 rounded-full ${
                      formData.participation_mode === 'anonymous' ? 'bg-primary' : 'bg-transparent'
                    }`} />
                  </div>
                </div>
                <div className="ml-3">
                  <span className="block text-sm font-semibold text-foreground">Anonymous</span>
                  <span className="block mt-1 text-sm text-muted-foreground">
                    Attendees vote with a device token. No names or IDs are collected.
                  </span>
                </div>
              </div>
            </label>

            <label className={`relative rounded-lg border p-4 transition-colors ${
              lockParticipation ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
            } ${
              formData.participation_mode === 'identified'
                ? 'border-ring bg-muted ring-2 ring-primary/20'
                : 'border-border hover:bg-muted'
            }`}>
              <input
                type="radio"
                name="participation_mode"
                value="identified"
                checked={formData.participation_mode === 'identified'}
                onChange={(e) => setParticipationMode(e.target.value)}
                disabled={lockParticipation}
                className="sr-only"
              />
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <div className="h-5 w-5 rounded-full border flex items-center justify-center">
                    <div className={`h-2.5 w-2.5 rounded-full ${
                      formData.participation_mode === 'identified' ? 'bg-primary' : 'bg-transparent'
                    }`} />
                  </div>
                </div>
                <div className="ml-3">
                  <span className="block text-sm font-semibold text-foreground">Identified</span>
                  <span className="block mt-1 text-sm text-muted-foreground">
                    Attendees join with a name and/or ID, and you see who answered what.
                  </span>
                </div>
              </div>
            </label>
          </div>

          {formData.participation_mode === 'identified' && (
            <div className="mt-4 space-y-3 rounded-lg border border-border bg-muted/60 p-4">
              <label className={`flex items-start gap-3 ${lockParticipation ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  checked={formData.identity_requires_name}
                  onChange={(e) => updateField('identity_requires_name', e.target.checked)}
                  disabled={lockParticipation}
                  className="mt-1 h-4 w-4 rounded border-border text-accent focus:ring-ring"
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">Require name</span>
                  <span className="block text-sm text-muted-foreground">
                    Participants enter their name before voting.
                  </span>
                </span>
              </label>
              <label className={`flex items-start gap-3 ${lockParticipation ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  checked={formData.identity_requires_id}
                  onChange={(e) => updateField('identity_requires_id', e.target.checked)}
                  disabled={lockParticipation}
                  className="mt-1 h-4 w-4 rounded border-border text-accent focus:ring-ring"
                />
                <span>
                  <span className="block text-sm font-medium text-foreground">Require ID</span>
                  <span className="block text-sm text-muted-foreground">
                    An external ID (employee/student number, email). Recognises a returning participant.
                  </span>
                </span>
              </label>
              {!formData.identity_requires_name && !formData.identity_requires_id && (
                <p className="text-sm font-medium text-destructive">
                  At least one of name or ID must be required.
                </p>
              )}

              <div className="mt-4 space-y-3 border-t border-border pt-4">
                <label className={`flex items-start gap-3 ${lockParticipation ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
                  <input
                    type="checkbox"
                    checked={formData.is_scored}
                    onChange={(e) => updateField('is_scored', e.target.checked)}
                    disabled={lockParticipation}
                    className="mt-1 h-4 w-4 rounded border-border text-accent focus:ring-ring"
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">Scored quiz</span>
                    <span className="block text-sm text-muted-foreground">
                      Mark one correct option and points per question. Participants get a running score, a
                      leaderboard, and a final ranking.
                    </span>
                  </span>
                </label>

                {formData.is_scored && (
                  <div>
                    <label htmlFor="score_time_limit" className="block text-sm font-medium text-foreground mb-2">
                      Time limit (minutes, optional)
                    </label>
                    <input
                      id="score_time_limit"
                      type="number"
                      min="1"
                      step="1"
                      value={formData.score_time_limit_seconds ? String(formData.score_time_limit_seconds / 60) : ''}
                      onChange={(e) => {
                        const minutes = e.target.value
                        updateField(
                          'score_time_limit_seconds',
                          minutes === '' ? null : Math.max(1, Math.round(Number(minutes))) * 60
                        )
                      }}
                      disabled={lockParticipation}
                      placeholder="No limit"
                      className="block w-full max-w-xs rounded-lg border border-border px-4 py-3 text-foreground shadow-sm focus:border-ring focus:ring-2 focus:ring-ring focus:ring-opacity-20 disabled:opacity-70"
                    />
                    <p className="mt-1 text-sm text-muted-foreground">
                      Each participant's clock starts when they press Start. Leave empty for a stopwatch only
                      (still used to break ties).
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          <p className="mt-2 text-sm text-muted-foreground">
            Identified sessions attach answers to a name and/or ID so you can see who responded. Participants
            are not authenticated, so an ID only prevents double voting - it is not verified.
          </p>
          {formError && (
            <p className="mt-2 text-sm font-medium text-destructive">{formError}</p>
          )}
        </div>

        {/* Active Status */}
        <div className="flex items-start">
          <div className="flex h-5 items-center">
            <input
              id="is_active"
              name="is_active"
              type="checkbox"
              checked={formData.is_active}
              onChange={(e) => updateField('is_active', e.target.checked)}
              className="h-4 w-4 rounded border-border text-accent focus:ring-ring"
            />
          </div>
          <div className="ml-3">
            <label htmlFor="is_active" className="text-sm font-medium text-foreground">
              Active Session
            </label>
            <p className="text-sm text-muted-foreground">
              When active, attendees can scan the QR code and vote. Uncheck to temporarily disable voting.
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end space-x-4 pt-6 border-t border-border">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-6 py-3 text-base font-semibold text-foreground shadow-sm hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? (
              <>
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-solid border-white border-r-transparent"></div>
                {initialData ? 'Saving...' : 'Creating...'}
              </>
            ) : (
              <>
                <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {initialData ? 'Save Changes' : 'Create Session'}
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}