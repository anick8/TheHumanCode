-- ============================================================================
-- 32. Rentals AI allowance
-- ============================================================================

-- How many assistant calls the signed-in user's Grant still allows: null is
-- unlimited (no cap, or a Super admin), 0 is spent. Calls are counted from the
-- Grant start, so changing the Grant's dates restarts the count. Takes no
-- user argument, so it can only ever answer for the caller. SECURITY DEFINER
-- because ai_usage is only readable by current Organizers.
CREATE OR REPLACE FUNCTION public.ai_allowance_left()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN 0
    WHEN public.is_super_admin() THEN NULL
    ELSE (
      SELECT CASE WHEN a.ai_allowance IS NULL THEN NULL
        ELSE greatest(a.ai_allowance - public.ai_calls_in_window(auth.uid()), 0) END
      FROM auth.users u
      JOIN public.allowed_emails a ON a.email = lower(u.email)
      WHERE u.id = auth.uid()
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.ai_allowance_left() FROM public;
GRANT EXECUTE ON FUNCTION public.ai_allowance_left() TO authenticated;
