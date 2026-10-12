-- Ticket: Rentals DB core. A Grant gives an email Organizer access for a date
-- range; a Super admin is always an Organizer and alone manages Grants and
-- Leads. Expiry carries a fixed 6-hour grace, revocation carries none.
\ir ../helpers.sql
BEGIN;

-- Organizer predicate and access status across every Grant state.
DO $$
DECLARE
  v_active uuid := pg_temp.make_user('active');
  v_upcoming uuid := pg_temp.make_user('upcoming');
  v_grace uuid := pg_temp.make_user('grace');
  v_expired uuid := pg_temp.make_user('expired');
  v_revoked uuid := pg_temp.make_user('revoked');
  v_never uuid := pg_temp.make_user('never');
  v_nogrant uuid := pg_temp.make_user('nogrant');
  v_default uuid := pg_temp.make_user('default');
  v_admin uuid;
BEGIN
  PERFORM pg_temp.grant_to(v_active, now() - interval '1 day', now() + interval '1 day');
  PERFORM pg_temp.grant_to(v_upcoming, now() + interval '1 day', now() + interval '8 days');
  PERFORM pg_temp.grant_to(v_grace, now() - interval '5 days', now() - interval '1 hour');
  PERFORM pg_temp.grant_to(v_expired, now() - interval '5 days', now() - interval '7 hours');
  PERFORM pg_temp.grant_to(v_revoked, now() - interval '1 day', now() + interval '1 day', now() - interval '1 minute');
  PERFORM pg_temp.grant_to(v_never, now() - interval '1 day', NULL);
  -- A bare allowlist row, as hand-edited today: started and never expires.
  INSERT INTO public.allowed_emails (email)
  SELECT lower(email) FROM auth.users WHERE id = v_default;
  v_admin := pg_temp.act_as_super_admin();

  IF NOT pg_temp.organizer_as(v_active) THEN RAISE EXCEPTION 'active Grant should be an Organizer'; END IF;
  IF pg_temp.organizer_as(v_upcoming) THEN RAISE EXCEPTION 'upcoming Grant should not be an Organizer yet'; END IF;
  IF NOT pg_temp.organizer_as(v_grace) THEN RAISE EXCEPTION '1h after end is inside the grace'; END IF;
  IF pg_temp.organizer_as(v_expired) THEN RAISE EXCEPTION '7h after end is past the grace'; END IF;
  IF pg_temp.organizer_as(v_revoked) THEN RAISE EXCEPTION 'revoked Grant gets no grace and no access'; END IF;
  IF NOT pg_temp.organizer_as(v_never) THEN RAISE EXCEPTION 'never-expiring Grant should be an Organizer'; END IF;
  IF NOT pg_temp.organizer_as(v_default) THEN RAISE EXCEPTION 'bare allowlist row should be never-expiring'; END IF;
  IF pg_temp.organizer_as(v_nogrant) THEN RAISE EXCEPTION 'account with no Grant is not an Organizer'; END IF;
  IF NOT pg_temp.organizer_as(v_admin) THEN RAISE EXCEPTION 'Super admin is always an Organizer'; END IF;

  PERFORM pg_temp.act_as_user(v_admin);
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'is_super_admin false for a Super admin'; END IF;
  PERFORM pg_temp.act_as_user(v_active);
  IF public.is_super_admin() THEN RAISE EXCEPTION 'is_super_admin true for a plain Organizer'; END IF;

  IF pg_temp.access_state_as(v_active) <> 'active' THEN RAISE EXCEPTION 'active state'; END IF;
  IF pg_temp.access_state_as(v_upcoming) <> 'upcoming' THEN RAISE EXCEPTION 'upcoming state'; END IF;
  IF pg_temp.access_state_as(v_grace) <> 'active' THEN RAISE EXCEPTION 'in-grace state should read active'; END IF;
  IF pg_temp.access_state_as(v_expired) <> 'expired' THEN RAISE EXCEPTION 'expired state'; END IF;
  IF pg_temp.access_state_as(v_revoked) <> 'revoked' THEN RAISE EXCEPTION 'revoked state'; END IF;
  IF pg_temp.access_state_as(v_never) <> 'active' THEN RAISE EXCEPTION 'never-expiring state'; END IF;
  IF pg_temp.access_state_as(v_nogrant) <> 'none' THEN RAISE EXCEPTION 'none state'; END IF;
  IF pg_temp.access_state_as(v_admin) <> 'admin' THEN RAISE EXCEPTION 'admin state'; END IF;
  -- Signed-out callers read 'none' rather than erroring.
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF (SELECT state FROM public.organizer_access_status()) <> 'none' THEN
    RAISE EXCEPTION 'signed-out caller should read none';
  END IF;
END $$;

-- Status RPC: end time, AI used within the Grant window, AI allowance.
DO $$
DECLARE
  v_user uuid := pg_temp.make_user('metered');
  v_end timestamptz := now() + interval '2 days';
  r record;
BEGIN
  PERFORM pg_temp.grant_to(v_user, now() - interval '3 days', v_end, NULL, 5);
  INSERT INTO public.ai_usage (user_id, created_at) VALUES
    (v_user, now() - interval '4 days'),  -- before the window
    (v_user, now() - interval '2 days'),
    (v_user, now() - interval '1 day'),
    (v_user, now() - interval '1 hour');
  PERFORM pg_temp.act_as_user(v_user);
  SELECT * INTO r FROM public.organizer_access_status();
  IF r.ai_used <> 3 OR r.ai_allowance <> 5 OR r.expires_at <> v_end THEN
    RAISE EXCEPTION 'expected used 3 / allowance 5 / end %, got % / % / %', v_end, r.ai_used, r.ai_allowance, r.expires_at;
  END IF;

  -- Renewal moves the window and restarts the count.
  PERFORM pg_temp.grant_to(v_user, now(), now() + interval '30 days', NULL, 5);
  SELECT * INTO r FROM public.organizer_access_status();
  IF r.ai_used <> 0 THEN RAISE EXCEPTION 'renewal should restart the count, got %', r.ai_used; END IF;

  -- Super admin: unlimited.
  PERFORM pg_temp.act_as_super_admin();
  SELECT * INTO r FROM public.organizer_access_status();
  IF r.ai_allowance IS NOT NULL THEN RAISE EXCEPTION 'Super admin allowance should be unlimited'; END IF;
END $$;

-- Grant and Lead tables: Super admin only, even through direct table access.
DO $$
DECLARE
  v_member uuid := pg_temp.make_user('member');
  v_n integer;
  v_err text;
BEGIN
  PERFORM pg_temp.grant_to(v_member, now() - interval '1 day', NULL);
  INSERT INTO public.leads (email) VALUES ('lead@test.local');

  PERFORM pg_temp.act_as_user(v_member);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.allowed_emails;
  IF v_n <> 0 THEN RESET ROLE; RAISE EXCEPTION 'non-admin read % Grants', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.leads;
  IF v_n <> 0 THEN RESET ROLE; RAISE EXCEPTION 'non-admin read % Leads', v_n; END IF;
  v_err := pg_temp.error_of($q$INSERT INTO public.allowed_emails (email) VALUES ('self@test.local')$q$);
  IF v_err IS NULL THEN RESET ROLE; RAISE EXCEPTION 'non-admin inserted a Grant'; END IF;
  UPDATE public.allowed_emails SET expires_at = NULL, ai_allowance = NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RESET ROLE; RAISE EXCEPTION 'non-admin updated % Grants', v_n; END IF;
  DELETE FROM public.allowed_emails;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RESET ROLE; RAISE EXCEPTION 'non-admin deleted % Grants', v_n; END IF;
  RESET ROLE;
  IF NOT EXISTS (SELECT 1 FROM public.allowed_emails WHERE email LIKE 'member-%') THEN
    RAISE EXCEPTION 'Grant vanished';
  END IF;

  PERFORM pg_temp.act_as_super_admin();
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.allowed_emails WHERE email LIKE 'member-%';
  IF v_n <> 1 THEN RESET ROLE; RAISE EXCEPTION 'Super admin should read the Grant'; END IF;
  SELECT count(*) INTO v_n FROM public.leads WHERE email = 'lead@test.local';
  IF v_n <> 1 THEN RESET ROLE; RAISE EXCEPTION 'Super admin should read Leads'; END IF;
  INSERT INTO public.allowed_emails (email, note) VALUES ('new@test.local', 'added by admin');
  UPDATE public.allowed_emails SET revoked_at = now() WHERE email = 'new@test.local';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RESET ROLE; RAISE EXCEPTION 'Super admin should update Grants'; END IF;
  DELETE FROM public.allowed_emails WHERE email = 'new@test.local';
  RESET ROLE;
END $$;

-- Admin Grant list: guarded, with session count, AI calls in window, last sign-in.
DO $$
DECLARE
  v_renter uuid := pg_temp.make_user('renter');
  v_plain uuid := pg_temp.make_user('plain');
  v_signin timestamptz := now() - interval '2 hours';
  v_email text;
  r record;
  v_err text;
BEGIN
  PERFORM pg_temp.grant_to(v_renter, now() - interval '2 days', now() + interval '5 days', NULL, 10);
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_renter;
  UPDATE auth.users SET last_sign_in_at = v_signin WHERE id = v_renter;
  INSERT INTO public.sessions (owner_id, title, slug, session_type, participation_mode, is_scored)
  VALUES (v_renter, 'A', 'rent-a-' || v_renter, 'poll', 'anonymous', false),
         (v_renter, 'B', 'rent-b-' || v_renter, 'poll', 'anonymous', false);
  INSERT INTO public.ai_usage (user_id, created_at)
  VALUES (v_renter, now() - interval '1 day'), (v_renter, now() - interval '10 days');

  PERFORM pg_temp.act_as_user(v_renter);
  v_err := pg_temp.error_of('SELECT * FROM public.admin_list_grants()');
  IF v_err IS NULL THEN RAISE EXCEPTION 'Organizer called admin_list_grants'; END IF;
  PERFORM pg_temp.act_as_user(v_plain);
  v_err := pg_temp.error_of('SELECT * FROM public.admin_list_grants()');
  IF v_err IS NULL THEN RAISE EXCEPTION 'plain account called admin_list_grants'; END IF;

  PERFORM pg_temp.act_as_super_admin();
  SELECT * INTO r FROM public.admin_list_grants() WHERE email = v_email;
  IF NOT FOUND THEN RAISE EXCEPTION 'Grant missing from admin list'; END IF;
  IF r.session_count <> 2 OR r.ai_used <> 1 OR r.ai_allowance <> 10
     OR r.status <> 'active' OR r.last_sign_in_at <> v_signin THEN
    RAISE EXCEPTION 'admin row wrong: sessions % ai % allowance % status % signin %',
      r.session_count, r.ai_used, r.ai_allowance, r.status, r.last_sign_in_at;
  END IF;
END $$;

ROLLBACK;
