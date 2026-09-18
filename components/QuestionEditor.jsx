'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const OPTION_KEY = (questionId, optionId) => `${questionId}::${optionId}`
const ENTER_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'
const MOVE_EASE = 'cubic-bezier(0.2, 0, 0, 1)'

export default function QuestionEditor({
  questions = [],
  optionsByQuestion = {},
  onQuestionsChange,
  questionKeys = {},
  onQuestionKeysChange,
  isScored = false,
  locked = false,
  loading = false
}) {
  const [editingQuestion, setEditingQuestion] = useState(null)
  const [expandedQuestion, setExpandedQuestion] = useState(null)
  const [exitingQuestions, setExitingQuestions] = useState(() => new Set())
  const [exitingOptions, setExitingOptions] = useState(() => new Set())

  // Latest props for the deferred removal commit.
  const propsRef = useRef({ questions, optionsByQuestion })
  propsRef.current = { questions, optionsByQuestion }

  // Element registries + FLIP bookkeeping. Motion only plays when a user
  // mutation sets the flag; renders caused by typing or expanding just re-seed.
  const cardEls = useRef(new Map())
  const optionEls = useRef(new Map())
  const prevRects = useRef(null)
  const animateNextRef = useRef(false)
  const flipAnimations = useRef(new Map())

  const pendingRemovals = useRef({ questions: new Set(), options: new Set() })
  const commitTimer = useRef(null)

  const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const play = (key, el, keyframes, options) => {
    const running = flipAnimations.current.get(key)
    if (running) {
      try { running.cancel() } catch { /* already finished */ }
    }
    const animation = el.animate(keyframes, options)
    flipAnimations.current.set(key, animation)
    animation.addEventListener('finish', () => {
      if (flipAnimations.current.get(key) === animation) {
        flipAnimations.current.delete(key)
      }
    })
  }

  // Measure each card/option by its offset inside its own list, so a parent
  // card moving never registers as a child moving. Captured synchronously at
  // mutation time (never mid-reveal), so reveal transitions can't leak in.
  const measureNodes = () => {
    const map = new Map()
    const measure = (el) => {
      const rect = el.getBoundingClientRect()
      const parent = el.parentElement
        ? el.parentElement.getBoundingClientRect()
        : { left: 0, top: 0 }
      return { el, x: rect.left - parent.left, y: rect.top - parent.top }
    }
    cardEls.current.forEach((el, id) => {
      if (el) map.set(`q:${id}`, measure(el))
    })
    optionEls.current.forEach((el, key) => {
      if (el) map.set(`o:${key}`, measure(el))
    })
    return map
  }

  const captureRects = () => {
    prevRects.current = measureNodes()
  }

  // FLIP: animate only when a mutation captured a "before" and asked for it.
  useLayoutEffect(() => {
    const shouldAnimate = animateNextRef.current
    animateNextRef.current = false
    const previous = prevRects.current
    if (!shouldAnimate || !previous) return

    const current = measureNodes()
    const reduce = prefersReducedMotion()
    current.forEach(({ el, x, y }, key) => {
      const before = previous.get(key)
      if (before) {
        const dx = before.x - x
        const dy = before.y - y
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          if (reduce) {
            play(key, el,
              [{ backgroundColor: 'rgba(249, 115, 22, 0.18)' }, { backgroundColor: 'transparent' }],
              { duration: 340, easing: 'ease-out' }
            )
          } else {
            play(key, el,
              [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
              { duration: 250, easing: MOVE_EASE }
            )
          }
        }
      } else if (!reduce) {
        play(key, el,
          [
            { opacity: 0, transform: 'translateY(6px) scale(0.99)' },
            { opacity: 1, transform: 'none' }
          ],
          { duration: 200, easing: ENTER_EASE }
        )
      }
    })
  })

  useEffect(() => () => {
    if (commitTimer.current) clearTimeout(commitTimer.current)
  }, [])

  const commitRemovals = () => {
    commitTimer.current = null
    const pending = pendingRemovals.current
    const { questions: latestQuestions, optionsByQuestion: latestOptions } = propsRef.current

    const removedQuestionIds = new Set(pending.questions)
    const removedOptionKeys = new Set(pending.options)
    pending.questions.clear()
    pending.options.clear()

    const nextQuestions = latestQuestions
      .filter((q) => !removedQuestionIds.has(q.id))
      .map((q, idx) => ({ ...q, order_index: idx }))

    const nextOptions = {}
    for (const question of nextQuestions) {
      nextOptions[question.id] = (latestOptions[question.id] || [])
        .filter((option) => !removedOptionKeys.has(OPTION_KEY(question.id, option.id)))
        .map((option, idx) => ({ ...option, order_index: idx }))
    }

    setExitingQuestions(new Set())
    setExitingOptions(new Set())
    setEditingQuestion((prev) => (prev && removedQuestionIds.has(prev) ? null : prev))
    setExpandedQuestion((prev) => (prev && removedQuestionIds.has(prev) ? null : prev))

    captureRects()
    animateNextRef.current = true
    onQuestionsChange(nextQuestions, nextOptions)
  }

  const scheduleRemoval = () => {
    if (commitTimer.current) return
    commitTimer.current = setTimeout(
      commitRemovals,
      prefersReducedMotion() ? 60 : 210
    )
  }

  const setCardRef = (id) => (el) => {
    if (el) cardEls.current.set(id, el)
    else cardEls.current.delete(id)
  }

  const setOptionRef = (key) => (el) => {
    if (el) optionEls.current.set(key, el)
    else optionEls.current.delete(key)
  }

  const addQuestion = () => {
    const newQuestion = {
      id: `temp_${Date.now()}`,
      text: '',
      order_index: questions.length,
      options: [],
      // A default ramp makes "compounding" scores one step; editable per question.
      points: isScored ? (questions.length + 1) * 10 : 10
    }

    const updatedQuestions = [...questions, newQuestion]
    captureRects()
    animateNextRef.current = true
    onQuestionsChange(updatedQuestions, optionsByQuestion)
    setEditingQuestion(newQuestion.id)
    setExpandedQuestion(newQuestion.id)
  }

  const setCorrectOption = (questionId, optionId) => {
    if (onQuestionKeysChange) onQuestionKeysChange(questionId, optionId)
  }

  const correctLetter = (question) => {
    const correctId = questionKeys[question.id]
    if (!correctId) return null
    const index = (optionsByQuestion[question.id] || []).findIndex((o) => o.id === correctId)
    return index === -1 ? null : String.fromCharCode(65 + index)
  }

  const updateQuestion = (questionId, field, value) => {
    const updatedQuestions = questions.map(q =>
      q.id === questionId ? { ...q, [field]: value } : q
    )
    onQuestionsChange(updatedQuestions, optionsByQuestion)
  }

  const deleteQuestion = (questionId) => {
    if (pendingRemovals.current.questions.has(questionId)) return
    pendingRemovals.current.questions.add(questionId)
    setExitingQuestions((prev) => {
      const next = new Set(prev)
      next.add(questionId)
      return next
    })
    scheduleRemoval()
  }

  const addOption = (questionId) => {
    const currentOptions = optionsByQuestion[questionId] || []
    const newOption = {
      id: `opt_${questionId}_${Date.now()}`,
      text: '',
      order_index: currentOptions.length
    }

    const updatedOptions = {
      ...optionsByQuestion,
      [questionId]: [...currentOptions, newOption]
    }

    captureRects()
    animateNextRef.current = true
    onQuestionsChange(questions, updatedOptions)
  }

  const updateOption = (questionId, optionId, field, value) => {
    const questionOptions = optionsByQuestion[questionId] || []
    const updatedOptions = questionOptions.map(opt =>
      opt.id === optionId ? { ...opt, [field]: value } : opt
    )

    const updatedOptionsMap = {
      ...optionsByQuestion,
      [questionId]: updatedOptions
    }

    onQuestionsChange(questions, updatedOptionsMap)
  }

  const deleteOption = (questionId, optionId) => {
    const key = OPTION_KEY(questionId, optionId)
    if (pendingRemovals.current.options.has(key)) return
    pendingRemovals.current.options.add(key)
    setExitingOptions((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
    scheduleRemoval()
  }

  const moveQuestionUp = (index) => {
    if (index === 0) return

    const updatedQuestions = [...questions]
    const temp = updatedQuestions[index]
    updatedQuestions[index] = updatedQuestions[index - 1]
    updatedQuestions[index - 1] = temp

    // Update order indices
    const reindexed = updatedQuestions.map((q, idx) => ({
      ...q,
      order_index: idx
    }))

    captureRects()
    animateNextRef.current = true
    onQuestionsChange(reindexed, optionsByQuestion)
  }

  const moveQuestionDown = (index) => {
    if (index === questions.length - 1) return

    const updatedQuestions = [...questions]
    const temp = updatedQuestions[index]
    updatedQuestions[index] = updatedQuestions[index + 1]
    updatedQuestions[index + 1] = temp

    // Update order indices
    const reindexed = updatedQuestions.map((q, idx) => ({
      ...q,
      order_index: idx
    }))

    captureRects()
    animateNextRef.current = true
    onQuestionsChange(reindexed, optionsByQuestion)
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="animate-pulse">
          <div className="h-8 bg-muted rounded w-48 mb-8"></div>
          {[1, 2].map((i) => (
            <div key={i} className="h-32 bg-muted rounded-lg mb-4"></div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-8 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="font-display text-2xl font-semibold text-foreground">Questions & Options</h2>
          <p className="mt-2 text-muted-foreground">
            Add questions and answer choices for your poll. Attendees will see them in this order.
          </p>
        </div>
        <button
          onClick={addQuestion}
          disabled={loading}
          className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-base font-semibold text-white shadow-sm transition-transform duration-150 hover:opacity-90 active:scale-[0.98] disabled:opacity-50 motion-reduce:transition-none"
        >
          <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Question
        </button>
      </div>

      {/* Questions List */}
      <div className="flex flex-col">
        {questions.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-border p-12 text-center">
            <div className="mx-auto h-24 w-24 rounded-full bg-muted flex items-center justify-center">
              <svg className="h-12 w-12 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="mt-6 text-lg font-medium text-foreground">No questions yet</h3>
            <p className="mt-2 text-muted-foreground max-w-md mx-auto">
              Add your first question to create a poll. Each question can have multiple answer options.
            </p>
          </div>
        ) : (
          questions.map((question, index) => {
            const questionOptions = optionsByQuestion[question.id] || []
            const isExpanded = expandedQuestion === question.id
            const isEditing = editingQuestion === question.id
            const isExiting = exitingQuestions.has(question.id)

            return (
              <div
                key={question.id}
                ref={setCardRef(question.id)}
                className={`grid transition-[grid-template-rows] duration-200 ease-out-expo motion-reduce:transition-none ${
                  isExiting ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
                }`}
              >
                <div className="overflow-hidden">
                  <div className="pb-6">
                    <div
                      className={`rounded-xl border transition-[opacity,border-color,background-color] duration-200 motion-reduce:transition-none ${
                        isExiting ? 'opacity-0' : 'opacity-100'
                      } ${
                        isExpanded
                          ? 'border-primary/40 bg-muted'
                          : 'border-border bg-card hover:border-primary/50'
                      }`}
                    >
                      {/* Question Header */}
                      <div
                        className="p-6 cursor-pointer"
                        onClick={() => setExpandedQuestion(isExpanded ? null : question.id)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center">
                              <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-gradient-to-r from-primary to-accent text-white font-medium text-sm mr-4">
                                {index + 1}
                              </span>
                              <div>
                                <h3 className="text-lg font-semibold text-foreground">
                                  {question.text || 'Untitled Question'}
                                </h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {questionOptions.length} option{questionOptions.length !== 1 ? 's' : ''}
                                  {questionOptions.length === 0 && 'Add options below'}
                                </p>
                                {isScored && (
                                  <div
                                    className="mt-2 flex flex-wrap items-center gap-3"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                      Points
                                      <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={question.points ?? 10}
                                        disabled={locked}
                                        onChange={(e) =>
                                          updateQuestion(question.id, 'points', Math.max(0, Math.round(Number(e.target.value) || 0)))
                                        }
                                        className="w-20 rounded-lg border border-border px-2 py-1 text-sm text-foreground shadow-sm focus:border-ring focus:ring-2 focus:ring-ring focus:ring-opacity-20 disabled:opacity-60"
                                      />
                                    </label>
                                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                                      correctLetter(question)
                                        ? 'bg-emerald-500/15 text-emerald-300'
                                        : 'bg-destructive/15 text-destructive'
                                    }`}>
                                      {correctLetter(question) ? `Key: ${correctLetter(question)}` : 'No key'}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2">
                            {index > 0 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  moveQuestionUp(index)
                                }}
                                className="inline-flex items-center p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg"
                                title="Move up"
                              >
                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                                </svg>
                              </button>
                            )}
                            {index < questions.length - 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  moveQuestionDown(index)
                                }}
                                className="inline-flex items-center p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg"
                                title="Move down"
                              >
                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                                </svg>
                              </button>
                            )}
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setEditingQuestion(isEditing ? null : question.id)
                              }}
                              className="inline-flex items-center p-2 text-muted-foreground hover:text-accent hover:bg-muted rounded-lg"
                              title={isEditing ? 'Finish editing' : 'Edit question'}
                            >
                              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                if (confirm('Delete this question and all its options?')) {
                                  deleteQuestion(question.id)
                                }
                              }}
                              className="inline-flex items-center p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg"
                              title="Delete question"
                            >
                              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Expanded Content */}
                      <div
                        className={`grid transition-[grid-template-rows] duration-300 ease-out-expo motion-reduce:transition-none ${
                          isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                        }`}
                      >
                        <div className="overflow-hidden">
                          <div
                            inert={!isExpanded}
                            aria-hidden={!isExpanded}
                            className={`px-6 pb-6 pt-6 transition-opacity duration-200 motion-reduce:transition-none ${
                              isExpanded ? 'opacity-100' : 'opacity-0'
                            }`}
                          >
                            <div
                              className={`mb-6 h-px origin-left bg-gradient-to-r from-primary to-accent transition-transform duration-300 ease-out-expo motion-reduce:transition-none ${
                                isExpanded ? 'scale-x-100' : 'scale-x-0'
                              }`}
                            />

                            {/* Edit Question */}
                            {isEditing && (
                              <div className="mb-6">
                                <label className="block text-sm font-medium text-foreground mb-2">
                                  Question Text
                                </label>
                                <textarea
                                  value={question.text}
                                  onChange={(e) => updateQuestion(question.id, 'text', e.target.value)}
                                  className="block w-full rounded-lg border border-border px-4 py-3 text-foreground shadow-sm focus:border-ring focus:ring-2 focus:ring-ring focus:ring-opacity-20 resize-none"
                                  rows="2"
                                  placeholder="Enter your question here..."
                                />
                                <p className="mt-2 text-sm text-muted-foreground">
                                  What do you want to ask your audience?
                                </p>
                              </div>
                            )}

                            {/* Options Header */}
                            <div className="flex items-center justify-between mb-4">
                              <h4 className="text-lg font-semibold text-foreground">Answer Options</h4>
                              <button
                                onClick={() => addOption(question.id)}
                                className="inline-flex items-center text-sm font-medium text-accent transition-transform duration-150 hover:text-accent active:scale-[0.97] motion-reduce:transition-none"
                              >
                                <svg className="mr-1.5 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                Add Option
                              </button>
                            </div>

                            {/* Options List */}
                            <div className="flex flex-col">
                              {questionOptions.length === 0 ? (
                                <div className="rounded-lg border-2 border-dashed border-border p-6 text-center">
                                  <p className="text-muted-foreground">
                                    No options yet. Add answer choices for this question.
                                  </p>
                                </div>
                              ) : (
                                questionOptions.map((option, optionIndex) => {
                                  const optionKey = OPTION_KEY(question.id, option.id)
                                  const optionExiting = exitingOptions.has(optionKey)

                                  return (
                                    <div
                                      key={option.id}
                                      ref={setOptionRef(optionKey)}
                                      className={`grid transition-[grid-template-rows] duration-200 ease-out-expo motion-reduce:transition-none ${
                                        optionExiting ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'
                                      }`}
                                    >
                                      <div className="overflow-hidden">
                                        <div className="pb-4">
                                          <div
                                            className={`flex items-center space-x-4 transition-opacity duration-150 motion-reduce:transition-none ${
                                              optionExiting ? 'opacity-0' : 'opacity-100'
                                            }`}
                                          >
                                            {isScored && (
                                              <div className="flex-shrink-0">
                                                <input
                                                  type="radio"
                                                  name={`correct-${question.id}`}
                                                  checked={questionKeys[question.id] === option.id}
                                                  onChange={() => setCorrectOption(question.id, option.id)}
                                                  disabled={locked}
                                                  title="Mark as the correct answer"
                                                  className="h-4 w-4 border-border text-accent focus:ring-ring disabled:opacity-60"
                                                />
                                              </div>
                                            )}
                                            <div className="flex-shrink-0">
                                              <span className={`inline-flex items-center justify-center h-8 w-8 rounded-full font-medium text-sm ${
                                                isScored && questionKeys[question.id] === option.id
                                                  ? 'bg-emerald-500/20 text-emerald-300'
                                                  : 'bg-muted text-foreground'
                                              }`}>
                                                {String.fromCharCode(65 + optionIndex)}
                                              </span>
                                            </div>
                                            <div className="flex-1">
                                              <input
                                                type="text"
                                                value={option.text}
                                                onChange={(e) => updateOption(question.id, option.id, 'text', e.target.value)}
                                                className="block w-full rounded-lg border border-border px-4 py-2 text-foreground shadow-sm focus:border-ring focus:ring-2 focus:ring-ring focus:ring-opacity-20"
                                                placeholder={`Option ${optionIndex + 1}`}
                                              />
                                            </div>
                                            <div className="flex-shrink-0">
                                              <button
                                                onClick={() => deleteOption(question.id, option.id)}
                                                className="inline-flex items-center p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg"
                                                title="Delete option"
                                              >
                                                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  )
                                })
                              )}
                            </div>

                            {/* Instructions */}
                            <div className={`${questionOptions.length > 0 ? 'mt-2' : 'mt-6'} rounded-lg bg-muted p-4`}>
                              <p className="text-sm text-muted-foreground">
                                {isScored
                                  ? (questionKeys[question.id] && questionOptions.length >= 2
                                      ? 'Correct answer selected. Participants score these points for a correct first answer.'
                                      : 'Mark the correct answer with the radio beside an option. A question needs at least 2 options and one correct answer.')
                                  : (questionOptions.length >= 2
                                      ? `Attendees will see these ${questionOptions.length} options in alphabetical order.`
                                      : 'Add at least 2 options for a meaningful poll.')}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Instructions */}
      <div className={`${questions.length > 0 ? 'mt-2' : 'mt-8'} rounded-2xl border border-border bg-muted p-6`}>
        <div className="flex items-start">
          <svg className="h-6 w-6 text-accent mr-3 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <div>
            <h4 className="text-lg font-semibold text-foreground mb-2">Tips for great polls</h4>
            <ul className="text-muted-foreground space-y-2">
              <li className="flex items-start">
                <span className="mr-2">🔢</span>
                <span>Keep questions clear and concise. Avoid technical jargon.</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">📝</span>
                <span>Provide 3-5 options per question. More options can be overwhelming.</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">⏱️</span>
                <span>Order questions from general to specific. Start with easier questions.</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">📊</span>
                <span>Use the "Move up/down" buttons to arrange questions in the best order.</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
