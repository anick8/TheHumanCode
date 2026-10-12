-- Ticket: AI allowance per Grant. ai_allowance_left() tells the signed-in
-- user how many assistant calls their Grant still allows (null = unlimited).
-- Calls are counted from the Grant start, so renewing the Grant dates restarts
-- the count; the hourly limit stays a separate check in the API routes.
\ir ../helpers.sql
BEGIN;

DO $$
DECLARE
  v_user uuid := pg_temp.make_user('metered');
  v_other uuid := pg_temp.make_user('other');
  v_left integer;
BEGIN
  PERFORM pg_temp.grant_to(v_user, now() - interval '3 days', now() + interval '2 days', NULL, 3);
  INSERT INTO public.ai_usage (user_id, created_at) VALUES
    (v_user, now() - interval '4 days'),  -- before the window, never counted
    (v_user, now() - interval '2 days'),
    (v_other, now() - interval '1 hour'); -- someone else's usage
  PERFORM pg_temp.act_as_user(v_user);

  v_left := public.ai_allowance_left();
  IF v_left IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'allowance 3, used 1: expected 2 left, got %', v_left; END IF;

  INSERT INTO public.ai_usage (user_id, created_at) VALUES (v_user, now() - interval '1 hour');
  v_left := public.ai_allowance_left();
  IF v_left IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'expected 1 left, got %', v_left; END IF;

  -- At the allowance: nothing left, and never negative once past it.
  INSERT INTO public.ai_usage (user_id, created_at) VALUES (v_user, now() - interval '1 minute');
  v_left := public.ai_allowance_left();
  IF v_left IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'expected 0 left at the allowance, got %', v_left; END IF;
  INSERT INTO public.ai_usage (user_id, created_at) VALUES (v_user, now() - interval '1 second');
  v_left := public.ai_allowance_left();
  IF v_left IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'expected 0 left past the allowance, got %', v_left; END IF;

  -- Editing the Grant's dates restarts the count.
  PERFORM pg_temp.grant_to(v_user, now(), now() + interval '30 days', NULL, 3);
  v_left := public.ai_allowance_left();
  IF v_left IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'renewal should restore the full allowance, got %', v_left; END IF;
END $$;

-- Null allowance is unlimited; a Super admin is exempt whatever its row says.
DO $$
DECLARE
  v_open uuid := pg_temp.make_user('open');
  v_admin uuid;
BEGIN
  PERFORM pg_temp.grant_to(v_open, now() - interval '1 day', NULL, NULL, NULL);
  INSERT INTO public.ai_usage (user_id) SELECT v_open FROM generate_series(1, 25);
  PERFORM pg_temp.act_as_user(v_open);
  IF public.ai_allowance_left() IS NOT NULL THEN RAISE EXCEPTION 'null allowance should be unlimited'; END IF;

  v_admin := pg_temp.act_as_super_admin();
  PERFORM pg_temp.grant_to(v_admin, now() - interval '1 day', NULL, NULL, 1);
  INSERT INTO public.ai_usage (user_id) SELECT v_admin FROM generate_series(1, 5);
  IF public.ai_allowance_left() IS NOT NULL THEN RAISE EXCEPTION 'Super admin should be unlimited'; END IF;
END $$;

-- Only the signed-in user's own allowance is readable: the function takes no
-- user argument, and a signed-out caller is told nothing is left.
DO $$
DECLARE
  v_user uuid := pg_temp.make_user('self');
  v_left integer;
BEGIN
  PERFORM pg_temp.grant_to(v_user, now() - interval '1 day', NULL, NULL, 10);
  PERFORM pg_temp.act_as_user(v_user);
  SET LOCAL ROLE authenticated;
  v_left := public.ai_allowance_left();
  RESET ROLE;
  IF v_left IS DISTINCT FROM 10 THEN RAISE EXCEPTION 'authenticated caller should read own allowance, got %', v_left; END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
  v_left := public.ai_allowance_left();
  IF v_left IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'signed-out caller should have 0 left, got %', v_left; END IF;
END $$;

-- A call made inside the grace (the event ran late) counts; one made after the
-- grace has closed does not.
DO $$
DECLARE
  v_user uuid := pg_temp.make_user('grace');
  v_left integer;
BEGIN
  PERFORM pg_temp.grant_to(v_user, now() - interval '5 days', now() - interval '1 hour', NULL, 5);
  INSERT INTO public.ai_usage (user_id, created_at) VALUES
    (v_user, now() - interval '2 days'),
    (v_user, now() - interval '30 minutes'),  -- after expires_at, inside the grace
    (v_user, now() + interval '7 hours');     -- past expires_at + grace
  PERFORM pg_temp.act_as_user(v_user);
  v_left := public.ai_allowance_left();
  IF v_left IS DISTINCT FROM 3 THEN RAISE EXCEPTION 'grace call should count, post-grace should not: expected 3 left, got %', v_left; END IF;
END $$;

ROLLBACK;
