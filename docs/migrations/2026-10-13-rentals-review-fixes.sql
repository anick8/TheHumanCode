-- ============================================================================
-- 33. Rentals review fixes
-- ============================================================================

-- AI calls a user has made inside their Grant window: from the Grant start
-- through its end plus the organizer grace, open-ended without one. A call
-- made during the grace (the event running late) counts against the allowance.
-- All calls for an account with no Grant.
CREATE OR REPLACE FUNCTION public.ai_calls_in_window(p_user uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT count(*)::integer
  FROM public.ai_usage au
  LEFT JOIN auth.users u ON u.id = au.user_id
  LEFT JOIN public.allowed_emails a ON a.email = lower(u.email)
  WHERE au.user_id = p_user
    AND (a.email IS NULL OR (
      au.created_at >= a.starts_at
      AND (a.expires_at IS NULL OR au.created_at <= a.expires_at + public.organizer_grace())
    ));
$$;

REVOKE ALL ON FUNCTION public.ai_calls_in_window(uuid) FROM public, anon, authenticated;
