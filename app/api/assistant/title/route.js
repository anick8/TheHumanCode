import { generateText } from 'ai'
import { createClient } from '@/lib/supabase/server'
import { getModel } from '@/lib/ai/provider'

// A single non-streaming generation, not an agent turn — deliberately separate
// from /api/assistant's tool-calling loop, ai_usage rate limiting and
// isStepCount machinery, none of which apply to one ungrounded call.
export async function POST(request) {
  // middleware.js only matches /dashboard and /present, so this route is
  // reachable unauthenticated unless it checks for itself, same as the main
  // assistant route.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { prompt } = body ?? {}
  if (!prompt || typeof prompt !== 'string') {
    return Response.json({ error: 'No prompt provided.' }, { status: 400 })
  }

  try {
    const { text } = await generateText({
      model: getModel(),
      instructions:
        'Given a short description of a quiz or poll, respond with exactly ONE word that ' +
        'names its topic — Title Case, no punctuation, no quotes, nothing else. Example: ' +
        'input "a 6-question quiz on renewable energy" -> output "Renewable".',
      prompt: prompt.slice(0, 500),
      maxOutputTokens: 12,
      // The configured model (lib/ai/provider.js) is a reasoning model. Without
      // this, it spends the entire output budget on internal <reasoning> text
      // and never reaches the actual one-word answer - confirmed by testing:
      // text comes back empty even at 200 output tokens. Reasoning adds no
      // value for a single-word lookup, so it's turned off rather than paid for.
      providerOptions: { openrouter: { reasoning: { effort: 'none' } } },
    })
    return Response.json({ title: sanitizeTitle(text) ?? 'Untitled Session' })
  } catch (error) {
    // A missing key or a failed call degrades to the placeholder rather than
    // blocking session creation - naming a session is never worth erroring on.
    console.error('Title generation failed:', error)
    return Response.json({ title: 'Untitled Session' })
  }
}

function sanitizeTitle(raw) {
  const word = String(raw ?? '').trim().split(/\s+/)[0]?.replace(/[^A-Za-z0-9-]/g, '')
  if (!word) return null
  const capped = word.slice(0, 24)
  return capped.charAt(0).toUpperCase() + capped.slice(1).toLowerCase()
}
