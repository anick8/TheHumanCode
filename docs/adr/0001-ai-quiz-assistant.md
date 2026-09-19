# 0001 — AI quiz assistant proposes, never writes

- **Status:** accepted
- **Date:** 2026-09-19

## Context

Organizers author every question by hand in `QuestionEditor`. For a 10-question quiz that is a lot of
typing between "I have a topic" and "I have a session ready to present", and it is the main friction
in the product.

Adding an AI assistant that drafts questions raises the question of how its output reaches the
database. The obvious design gives the agent write tools that insert questions directly.

Three facts about this codebase argued against that:

1. `saveQuestions()` already implements insert-vs-update-vs-delete diffing, `order_index`
   renumbering, option-before-answer-key ordering, and scored-quiz validation. A server-side write
   path would be a second implementation of the same logic, free to drift.
2. The database actively rejects late structural edits — `prevent_scored_structure_change`,
   `prevent_key_change_after_votes`, `prevent_points_change_after_votes`,
   `prevent_identity_change_after_votes`. A human reading a draft understands "this quiz already has
   votes"; an agent retrying does not.
3. The assistant reads attendee comments and web search results, both authored by people outside the
   organizer's account. Any write tool reachable in the same turn turns a prompt injection into a
   real mutation.

## Decision

Authoring tools have no server-side effect. They emit a proposal, the AI SDK halts the agent loop
(v7 stops whenever a tool without `execute` is invoked), the draft is streamed to the browser, and a
human applies it into the existing editor state. Persistence happens only through the existing Save
button and the unchanged `saveQuestions()`.

Read and search tools do execute server-side, on the caller's RLS-bound Supabase client.

The model provider and the search vendor are each isolated behind one file (`lib/ai/provider.js`,
`lib/ai/search.js`) so either can be swapped without touching the rest of the feature.

## Alternatives rejected

**Server-side write tools.** Simpler agent, fewer round trips. Rejected: duplicates the save logic,
removes human review from a surface where a wrong answer key is visible to a room of people, and
converts a successful prompt injection from "bad draft" into "bad data".

**AI SDK v7 `toolApproval`.** A first-class approval mechanism exists where a tool keeps its
`execute` and the user approves before it runs. Rejected because approval resumes into a server-side
write — the exact property we wanted to avoid — and because it would bypass the editor's draft state,
so an approved change could not be tweaked before saving.

**A single-shot "generate questions" endpoint, no agent.** Cheaper and simpler. Rejected because it
cannot read an existing session to refine it, cannot look at results to answer "which questions were
too easy", and cannot ground a topical quiz in search.

**Anthropic's provider-native web search.** Avoids a second vendor and key. Rejected because
provider-defined tools have no cross-provider equivalent, which would have quietly undone the
provider seam.

## Consequences

- Nothing the assistant produces reaches attendees without a human reading it first.
- There is exactly one write path for questions, unchanged by this feature.
- The panel must answer every proposal tool call — on Discard as well as Apply — or the conversation
  parks. The prompt therefore limits the model to one proposal per reply.
- Two API keys are required in every environment (`OPENROUTER_API_KEY`, and `TAVILY_API_KEY` for
  search, which degrades gracefully when absent).
- The endpoint spends money per call, so it carries its own auth check, request caps, and a per-user
  hourly limit in `ai_usage`.
- The schema rules in `lib/ai/prompt.js` duplicate constraints in `database-setup.sql`. Nothing
  enforces that they stay in sync; changing a constraint means updating the prompt too.
