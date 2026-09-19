import {
  streamText,
  convertToModelMessages,
  createUIMessageStreamResponse,
  toUIMessageStream,
  isStepCount,
} from 'ai'
import { createClient } from '@/lib/supabase/server'
import { getModel, MAX_OUTPUT_TOKENS, MAX_STEPS } from '@/lib/ai/provider'
import { buildTools } from '@/lib/ai/tools'
import { buildInstructions } from '@/lib/ai/prompt'

export const maxDuration = 60

// Request caps. These bound what one call can cost before the model is reached.
const MAX_MESSAGES = 40
const MAX_TOTAL_CHARS = 60000

// Per-user hourly cap on assistant requests.
const RATE_LIMIT_PER_HOUR = 60

function countChars(messages) {
  return JSON.stringify(messages ?? []).length
}

export async function POST(request) {
  // middleware.js only matches /dashboard and /present, so this route is
  // reachable unauthenticated unless it checks for itself. getUser() verifies
  // the JWT with the auth server; getSession() would only decode the cookie.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // This route spends real money per call, so being merely authenticated
  // isn't enough - the caller must be on the organizer allowlist enforced by
  // is_organizer() (see database-setup.sql). RLS also blocks a non-organizer
  // from recording ai_usage rows, but that would surface as a confusing
  // insert failure rather than a clean 403, so it's checked explicitly here.
  const { data: isOrganizer } = await supabase.rpc('is_organizer')
  if (!isOrganizer) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { messages, sessionId: requestedSessionId } = body ?? {}

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'No messages provided.' }, { status: 400 })
  }
  if (messages.length > MAX_MESSAGES || countChars(messages) > MAX_TOTAL_CHARS) {
    return Response.json(
      { error: 'This conversation is too long. Start a new one.' },
      { status: 413 }
    )
  }

  // Rate limit. The table is RLS-scoped to the caller, so a user can neither
  // read another user's counter nor write rows attributed to someone else.
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', since)

  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return Response.json(
      { error: 'You have reached the hourly limit for the assistant. Try again later.' },
      { status: 429 }
    )
  }

  // A session id from the client is never trusted. It is re-read through the
  // caller's RLS-bound client, so a session belonging to someone else simply
  // resolves to null and the tools fall back to having no session context.
  let session = null
  if (requestedSessionId) {
    const { data } = await supabase
      .from('sessions')
      .select('id, title, session_type, is_scored, is_active')
      .eq('id', requestedSessionId)
      .eq('owner_id', user.id)
      .maybeSingle()
    session = data ?? null
  }

  if (session) {
    const { data: questionIds } = await supabase
      .from('questions').select('id').eq('session_id', session.id)
    const ids = (questionIds ?? []).map((q) => q.id)
    if (ids.length) {
      const { count: voteCount } = await supabase
        .from('votes').select('id', { count: 'exact', head: true }).in('question_id', ids)
      session.hasVotes = (voteCount ?? 0) > 0
    }
  }

  let model
  try {
    model = getModel()
  } catch (error) {
    return Response.json({ error: error.message }, { status: 503 })
  }

  await supabase.from('ai_usage').insert({ user_id: user.id })

  const tools = buildTools({ supabase, userId: user.id, sessionId: session?.id ?? null })

  const result = streamText({
    model,
    instructions: buildInstructions({ session }),
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    // The loop also halts on its own whenever a tool without `execute` is
    // invoked, which is how the proposal tools hand control to the browser.
    stopWhen: isStepCount(MAX_STEPS),
  })

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream, tools }),
  })
}
