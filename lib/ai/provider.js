import { createOpenRouter } from '@openrouter/ai-sdk-provider'

// The only place in the codebase that names a model vendor. Swapping providers
// is a rewrite of this file, its npm package, and its env var — nothing else
// imports a vendor SDK. See docs/ai-assistant.md for the procedure.
//
// Routed through OpenRouter rather than a provider's own SDK so the model can
// be changed by editing MODEL_ID alone, with no new package or key. Note the
// slug format is namespaced ('anthropic/claude-haiku-4.5'), not the bare id a
// first-party SDK would take.
// Verified against the real propose_questions schema and the prompt-injection
// probe before being chosen. Both matter on a model swap: tool calling is what
// the whole feature runs on, and resistance to instructions embedded in
// attendee comments is a property of the model, not of this code.
export const MODEL_ID = 'deepseek/deepseek-v4-flash'

export const MAX_OUTPUT_TOKENS = 4000

// Cap on agent loop steps. A quiz draft needs a couple of read tools plus one
// proposal, so 8 leaves headroom without letting a confused run bill forever.
export const MAX_STEPS = 8

export function getModel() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error(
      'OPENROUTER_API_KEY is not set. Add it to .env.local and to the Vercel project environment.'
    )
  }
  return createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY }).chat(MODEL_ID)
}
