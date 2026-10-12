-- ============================================================================
-- 34. Rentals: signed-out callers cannot execute the Grant list or AI allowance
-- ============================================================================

-- Supabase's default privileges grant EXECUTE on new functions to anon as
-- well, so REVOKE ALL ... FROM public did not remove it. Both are for
-- signed-in users only (and already return nothing useful when signed out).
REVOKE EXECUTE ON FUNCTION public.admin_list_grants() FROM anon;
REVOKE EXECUTE ON FUNCTION public.ai_allowance_left() FROM anon;
