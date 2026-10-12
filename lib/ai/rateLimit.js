export const RATE_LIMIT_PER_HOUR = 60

// The ai_usage table is RLS-scoped to the caller, so a user can neither read
// another user's counter nor write rows attributed to someone else. Shared by
// every route that spends model money.
export async function isOverAiLimit(supabase, userId) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since)
  return (count ?? 0) >= RATE_LIMIT_PER_HOUR
}

export const AI_ALLOWANCE_CODE = 'ai_allowance_exhausted'
export const AI_ALLOWANCE_MESSAGE = 'AI allowance used up. Contact the organizer to renew.'

// The Grant's AI allowance, counted by the database from the Grant start
// (ai_allowance_left is SECURITY DEFINER and answers only for the caller).
// null is unlimited, which is also what Super admins get. Check this after
// isOverAiLimit and before recording usage.
export async function isAiAllowanceSpent(supabase) {
  const { data, error } = await supabase.rpc('ai_allowance_left')
  if (error) return false
  return typeof data === 'number' && data <= 0
}

export function aiAllowanceResponse() {
  return Response.json(
    { error: AI_ALLOWANCE_MESSAGE, code: AI_ALLOWANCE_CODE },
    { status: 403 }
  )
}

// useChat surfaces a non-2xx body as the Error message; pull the readable
// text out of the JSON the routes send, falling back to the raw message.
export function assistantErrorText(error) {
  const raw = error?.message
  if (!raw) return 'Something went wrong. Try again.'
  try {
    const body = JSON.parse(raw)
    if (body?.code === AI_ALLOWANCE_CODE) return AI_ALLOWANCE_MESSAGE
    if (typeof body?.error === 'string') return body.error
  } catch {}
  return raw
}
