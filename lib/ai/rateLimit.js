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
