-- Ticket: the Super admin Grant list and the caller's own AI allowance are for
-- signed-in users only. Supabase's default privileges also grant EXECUTE to
-- anon on new functions, so the REVOKE FROM public in their migrations is not
-- enough; a signed-out caller must not be able to execute either.
BEGIN;

DO $$
DECLARE
  v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['public.admin_list_grants()', 'public.ai_allowance_left()'] LOOP
    IF has_function_privilege('anon', v_fn, 'execute') THEN
      RAISE EXCEPTION '% is executable by anon', v_fn;
    END IF;
    IF NOT has_function_privilege('authenticated', v_fn, 'execute') THEN
      RAISE EXCEPTION '% is not executable by authenticated', v_fn;
    END IF;
  END LOOP;
END $$;

ROLLBACK;
