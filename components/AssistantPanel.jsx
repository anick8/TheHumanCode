'use client'

import { useState, useEffect, useRef } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import AssistantProposal from './AssistantProposal'

const ENTER_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'

// Must match the constants in lib/ai/tools.js. There is no type checker here to
// catch drift, so these are asserted against the streamed part names below.
const TOOL_PROPOSE_QUESTIONS = 'propose_questions'
const TOOL_PROPOSE_SESSION_SETTINGS = 'propose_session_settings'

const READ_TOOL_LABELS = {
  'tool-list_sessions': 'Looking through your sessions',
  'tool-get_session': 'Reading this session',
  'tool-get_results': 'Reading the results',
  'tool-get_comments': 'Reading the comments',
  'tool-get_scores': 'Reading the scores',
  'tool-web_search': 'Searching the web',
}

const SUGGESTIONS = [
  'Draft 5 questions about our product roadmap',
  'Make these questions harder',
  'Add two more questions in the same style',
]

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

// Fields the database refuses to change once a vote exists, via
// prevent_identity_change_after_votes. Title and results_mode are not among
// them, so a draft touching only those stays applicable.
const LOCKED_AFTER_VOTES = [
  'session_type', 'participation_mode', 'is_scored',
  'score_time_limit_seconds', 'identity_requires_name', 'identity_requires_id',
]

// Why a draft cannot be applied, or null when it can. Returned as a sentence
// because it is shown to the organizer in place of the Apply button.
function blockedReason({ kind, input, hasVotes, isScored }) {
  if (!hasVotes) return null

  if (kind === 'questions') {
    // prevent_scored_structure_change only guards scored sessions; an unscored
    // session with votes can still gain and lose questions.
    return isScored
      ? 'This quiz is scored and already has votes, so questions can no longer be added or removed.'
      : null
  }

  const locked = Object.keys(input?.settings ?? {}).filter((key) => LOCKED_AFTER_VOTES.includes(key))
  if (locked.length === 0) return null
  return 'This session already has votes, so its type, scoring and identity settings are locked.'
}

export default function AssistantPanel({ open, onClose, sessionId, seedPrompt, onApplyProposal, hasVotes = false, isScored = false }) {
  const [input, setInput] = useState('')
  const [resolved, setResolved] = useState({})
  const [reduceMotion, setReduceMotion] = useState(true)
  const scrollRef = useRef(null)

  const { messages, setMessages, sendMessage, addToolOutput, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/assistant',
      prepareSendMessagesRequest: ({ messages: outgoing }) => ({
        body: { messages: outgoing, sessionId },
      }),
    }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  })

  useEffect(() => setReduceMotion(prefersReducedMotion()), [])

  // A prompt handed over from the dashboard "Create with AI" composer is sent
  // once the chat is ready to accept it. Guarded on the conversation still
  // being empty rather than on a ref: a ref set before the async send strands
  // the seed forever if that first attempt doesn't land, which is exactly what
  // happens when React's development double-mount discards it.
  useEffect(() => {
    if (!open || !seedPrompt) return
    if (status !== 'ready' || messages.length > 0) return
    sendMessage({ text: seedPrompt })
  }, [open, seedPrompt, status, messages.length, sendMessage])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const busy = status === 'submitted' || status === 'streaming'

  // The server rejects a conversation once it grows past MAX_MESSAGES /
  // MAX_TOTAL_CHARS (app/api/assistant/route.js). This is the only way to
  // recover from that without a full page reload.
  const resetChat = () => {
    setMessages([])
    setResolved({})
    setInput('')
  }

  const submit = (event) => {
    event.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    sendMessage({ text })
  }

  // Answering the tool call is what lets the conversation continue. Both Apply
  // and Discard must respond, or the run stays parked forever.
  const respond = (tool, toolCallId, outcome) => {
    setResolved((previous) => ({ ...previous, [toolCallId]: outcome }))
    addToolOutput({
      tool,
      toolCallId,
      output:
        outcome === 'applied'
          ? 'The organizer applied this draft to their editor. It is not saved yet.'
          : 'The organizer discarded this draft.',
    })
  }

  const transition = reduceMotion ? 'none' : `transform 240ms ${ENTER_EASE}, opacity 240ms ${ENTER_EASE}`

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/50 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
        style={{ transition: reduceMotion ? 'none' : `opacity 240ms ${ENTER_EASE}` }}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="AI assistant"
        className="fixed right-0 top-0 z-50 flex h-dvh w-full max-w-md flex-col border-l border-border bg-card shadow-2xl"
        style={{ transform: open ? 'translateX(0)' : 'translateX(100%)', transition }}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-bold text-foreground">AI Assistant</h2>
            <p className="text-xs text-muted-foreground">Drafts questions. You review and save.</p>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={resetChat}
                disabled={busy}
                aria-label="New chat"
                title="New chat"
                className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close assistant"
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Describe the quiz you want and I&apos;ll draft it. Tell me the topic, who&apos;s in the
                room, and how many questions.
              </p>
              <div className="space-y-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => sendMessage({ text: suggestion })}
                    className="block w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-left text-xs text-foreground hover:bg-muted transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div key={message.id} className="space-y-2">
              {message.parts?.map((part, index) => {
                if (part.type === 'text') {
                  if (!part.text?.trim()) return null
                  return (
                    <div
                      key={index}
                      className={
                        message.role === 'user'
                          ? 'ml-auto w-fit max-w-[85%] rounded-xl bg-primary/15 px-3 py-2 text-sm text-foreground'
                          : 'text-sm leading-relaxed text-foreground whitespace-pre-wrap'
                      }
                    >
                      {part.text}
                    </div>
                  )
                }

                if (READ_TOOL_LABELS[part.type]) {
                  return (
                    <p key={index} className="text-xs italic text-muted-foreground">
                      {READ_TOOL_LABELS[part.type]}
                      {part.state === 'output-available' ? ' — done' : '…'}
                    </p>
                  )
                }

                const isQuestionProposal = part.type === `tool-${TOOL_PROPOSE_QUESTIONS}`
                const isSettingsProposal = part.type === `tool-${TOOL_PROPOSE_SESSION_SETTINGS}`

                if ((isQuestionProposal || isSettingsProposal) && part.state !== 'input-streaming') {
                  const tool = isQuestionProposal ? TOOL_PROPOSE_QUESTIONS : TOOL_PROPOSE_SESSION_SETTINGS
                  const kind = isQuestionProposal ? 'questions' : 'settings'
                  const blocked = blockedReason({ kind, input: part.input, hasVotes, isScored })
                  return (
                    <AssistantProposal
                      key={index}
                      kind={kind}
                      input={part.input}
                      resolved={resolved[part.toolCallId]}
                      blockedReason={blocked}
                      onApply={() => {
                        onApplyProposal(kind, part.input)
                        respond(tool, part.toolCallId, 'applied')
                      }}
                      onDiscard={() => respond(tool, part.toolCallId, 'discarded')}
                    />
                  )
                }

                return null
              })}
            </div>
          ))}

          {busy && (
            <p className="text-xs italic text-muted-foreground">Thinking…</p>
          )}

          {error && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error.message || 'Something went wrong. Try again.'}
            </p>
          )}
        </div>

        <form onSubmit={submit} className="border-t border-border px-5 py-4">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) submit(event)
              }}
              rows={2}
              placeholder="Ask for questions, or changes to them…"
              className="min-w-0 flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="rounded-lg bg-gradient-to-r from-primary to-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              Send
            </button>
          </div>
        </form>
      </aside>
    </>
  )
}
