# AI assistant

How the quiz-authoring assistant works, and the rules for changing it.

## The one rule

**The assistant never writes to the database.** Its authoring tools produce drafts that a human
reviews and applies; persistence happens through the editor's existing Save button. Read tools run
server-side but only read. If you are adding a tool that writes, stop and read
[Adding a tool](#adding-a-tool) first — this property is load-bearing for security, not a style choice.

## Request path

```
components/AssistantPanel.jsx        useChat → POST /api/assistant { messages, sessionId }
        ▼
app/api/assistant/route.js           auth → rate limit → agent loop → streamed response
        │
        ├─ read tools      execute server-side on the caller's RLS-bound Supabase client
        ├─ web_search      execute server-side via lib/ai/search.js
        └─ proposal tools  no execute → loop halts → call streamed to the browser
                                  ▼
                           organizer presses Apply
                                  ▼
        app/dashboard/sessions/[sessionId]/page.js → applyProposal() → editor state
                                  ▼
                           organizer presses Save → saveQuestions() → database
```

The proposal tools have no `execute` function. AI SDK v7 halts the agent loop whenever a tool
without `execute` is invoked, so the model's turn ends there and the unanswered tool call streams to
the client. This is the SDK's documented "client-side tools requiring user interaction" pattern.

The panel must answer every proposal call via `addToolOutput` — on Discard as well as Apply.
`sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls` resumes the conversation once
all pending tool calls have output; an unanswered call parks the run forever. This is why the system
prompt limits the model to one proposal per reply.

## Files

| File | Responsibility |
|---|---|
| `app/api/assistant/route.js` | Auth gate, request caps, rate limit, agent loop |
| `lib/ai/provider.js` | **The only file naming a model vendor** |
| `lib/ai/search.js` | **The only file naming a search vendor** |
| `lib/ai/tools.js` | Tool definitions and the `TOOL` name constants |
| `lib/ai/prompt.js` | System prompt: schema rules, projector legibility, untrusted content |
| `components/AssistantPanel.jsx` | Chat UI, proposal rendering, tool-call answering |
| `components/AssistantProposal.jsx` | One draft, with Apply / Discard |

## Tools

**Read tools** — server-executed on the caller's RLS-bound client. A session id the model invents,
or one belonging to another organizer, returns nothing; RLS is the authorization boundary.

| Tool | Returns |
|---|---|
| `list_sessions` | The caller's sessions, newest first |
| `get_session` | Settings plus the full question / option / answer-key tree |
| `get_results` | Vote counts per question and option |
| `get_comments` | Attendee comments, wrapped as untrusted |
| `get_scores` | Participant scores for a scored quiz |
| `web_search` | `{ title, url, snippet }`, wrapped as untrusted. Registered only when `TAVILY_API_KEY` is set |

**Proposal tools** — no `execute`; reviewed by a human.

| Tool | Produces |
|---|---|
| `propose_questions` | `{ mode: 'replace' \| 'append', summary, questions[] }` |
| `propose_session_settings` | `{ summary, settings }` |

Tool names live as constants in `TOOL` (`lib/ai/tools.js`) because this is a JavaScript codebase.
In TypeScript the SDK type-checks that `addToolOutput({ tool })` names a real tool; here a typo fails
silently at runtime, so both sides import the constant instead of spelling the string twice.

## Security

- **The route authenticates itself.** `middleware.js` matches only `/dashboard` and `/present`, so
  `/api/assistant` is otherwise reachable unauthenticated — and it spends money per call. The handler
  calls `supabase.auth.getUser()` (which verifies the JWT server-side) rather than `getSession()`
  (which only decodes the cookie), and returns 401 before doing anything else.
- **No service-role key.** Every server-side tool uses the cookie-bound anon client, so RLS applies
  exactly as it does everywhere else in the app.
- **A client-supplied `sessionId` is never trusted.** It is re-read filtered by `owner_id`; a session
  belonging to someone else resolves to `null` and the tools simply have no session context.
- **Two untrusted input channels.** `get_comments` returns text written by anonymous attendees;
  `web_search` returns text from arbitrary websites, which anyone can author and try to rank. Both
  are wrapped by `untrusted()` in `lib/ai/tools.js` and returned as structured JSON rather than
  concatenated prose. Search returns snippets only — never fetched page bodies.

  The envelope is a hint to the model. **The actual guarantee is that no tool writes**: the worst a
  successful injection achieves is a poisoned draft that a human reads before saving. Do not weaken
  that. String-filtering for phrases like "ignore previous instructions" is not a defense and is
  deliberately not implemented.

- **Cost controls:** `isStepCount(8)` caps loop steps, `maxOutputTokens` caps output, request caps
  reject oversized histories, and `ai_usage` enforces a per-user hourly limit. The `ai_usage` table is
  RLS-scoped so a user can neither read another's counter nor write rows attributed to someone else.

## Schema rules

The system prompt encodes constraints that live in `database-setup.sql`. A draft that breaks one will
fail at Save, so the model is told up front instead of discovering it through a failed write:

- ≥2 options per votable question; exactly one correct option in a scored quiz.
- `points` is an integer ≥ 0 (`questions.points`), defaulting to 10.
- `session_type` and its flags must satisfy `sessions_type_consistency`: `poll` = anonymous and never
  scored; `quiz` = identified, scoring optional; `comments` = identified and never scored.
- `comments` sessions have no options — each question is an image prompt, and the assistant cannot
  upload images.
- Once votes exist, `prevent_scored_structure_change` and friends lock the structure. The route
  detects this and tells the model in the prompt.

**If you change a constraint in `database-setup.sql`, update `lib/ai/prompt.js` in the same commit.**
Nothing enforces that link automatically.

## Adding a tool

1. Add the name to `TOOL` in `lib/ai/tools.js`.
2. Add the definition inside `buildTools()`. Use `inputSchema` (not `parameters`) with a Zod schema,
   and `.describe()` every field — the descriptions are what the model actually reads.
3. **Decide whether it writes.** If it only reads, give it an `execute` that uses the `supabase`
   client from the closure so RLS applies. If it would write, it must instead be a proposal tool with
   no `execute`, rendered in `AssistantProposal.jsx` and applied through editor state.
4. Never make a write-capable tool reachable in the same turn as `get_comments` or `web_search`.
5. If it is a proposal tool, add it to `PROPOSAL_TOOLS`, render it in `AssistantPanel.jsx`, and make
   sure both Apply and Discard call `addToolOutput` — otherwise the conversation parks.
6. If it is a read tool, add a label to `READ_TOOL_LABELS` in `AssistantPanel.jsx` so the user sees
   what it is doing.

## Swapping the model provider

1. `npm i @ai-sdk/openai` (or whichever provider).
2. Rewrite `lib/ai/provider.js` — it is about 20 lines and is the only file that imports a model SDK:
   ```js
   import { openai } from '@ai-sdk/openai'
   export const MODEL_ID = 'gpt-5'
   export function getModel() { /* throw if the key is missing */ return openai(MODEL_ID) }
   ```
3. Set the new provider's API key env var in `.env.local` and Vercel; remove the old one.

Nothing else changes — tools, prompt, route and UI are all provider-agnostic. Verify by running the
app and drafting a quiz; if you had to touch a second file, the seam has leaked and should be fixed.

Tool-calling quality varies by model. The schema rules in the prompt are the guardrail, and the
human-review gate stops bad drafts reaching attendees either way — but a weak model will need more
correcting, and some small models do not support tool calling at all.

## Swapping the search vendor

Rewrite `search()` in `lib/ai/search.js` so it still returns `[{ title, url, snippet }]`, and swap the
env var. Keep returning snippets rather than full page bodies — that bound on untrusted text is a
security property, not an optimization. If you remove search entirely, delete `TAVILY_API_KEY` and
the tool deregisters itself (`isSearchConfigured()`).

A provider-native search tool (Anthropic ships one) would remove this file and the second vendor, but
provider-native tools have no cross-provider equivalent, which would defeat the provider seam above.

## Environment

| Variable | Required | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | Yes | Server-only. Without it the route returns 503 with a readable message |
| `TAVILY_API_KEY` | No | Without it `web_search` is simply not offered to the model |

Neither may be `NEXT_PUBLIC_`-prefixed — that would inline the credential into the browser bundle.
