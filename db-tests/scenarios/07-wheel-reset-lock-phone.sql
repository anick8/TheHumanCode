-- Ticket: Wheel of Fortune - Reset, the Session type lock, and the phone read.
\ir ../helpers.sql
BEGIN;

-- Reset clears the Spins, restores every Entry and keeps the Participants.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_spin record;
  v_err text;
BEGIN
  PERFORM pg_temp.join_as(v_session, 'Joiner');
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['M1', 'M2']);
  SELECT * INTO v_spin FROM public.spin_wheel(v_session);
  PERFORM public.resolve_wheel_pick(v_spin.spin_id, true);
  PERFORM public.remove_wheel_entry((SELECT id FROM public.wheel_entries WHERE session_id = v_session AND label = 'M2'));

  -- a stranger cannot reset
  PERFORM pg_temp.act_as_stranger();
  v_err := pg_temp.error_of(format('SELECT public.reset_wheel(%L)', v_session));
  IF v_err IS NULL THEN RAISE EXCEPTION 'a stranger reset the wheel'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wheel_spins WHERE session_id = v_session) THEN
    RAISE EXCEPTION 'a refused reset cleared the Spins';
  END IF;

  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.reset_wheel(v_session);
  IF EXISTS (SELECT 1 FROM public.wheel_spins WHERE session_id = v_session) THEN
    RAISE EXCEPTION 'reset left Spins behind';
  END IF;
  IF pg_temp.active_labels(v_session) <> ARRAY['Joiner', 'M1', 'M2'] THEN
    RAISE EXCEPTION 'reset did not restore every Entry: %', pg_temp.active_labels(v_session);
  END IF;
  IF (SELECT count(*) FROM public.participants WHERE session_id = v_session) <> 1 THEN
    RAISE EXCEPTION 'reset removed a Participant';
  END IF;
END $$;

-- Reset only touches its own session.
DO $$
DECLARE
  v_a uuid := pg_temp.make_wheel();
  v_b uuid := pg_temp.make_wheel();
BEGIN
  PERFORM pg_temp.act_as_owner(v_b);
  PERFORM public.add_wheel_entries(v_b, ARRAY['X', 'Y']);
  PERFORM public.spin_wheel(v_b);
  PERFORM pg_temp.act_as_owner(v_a);
  PERFORM public.reset_wheel(v_a);
  IF NOT EXISTS (SELECT 1 FROM public.wheel_spins WHERE session_id = v_b) THEN
    RAISE EXCEPTION 'reset on one wheel cleared another wheel''s Spins';
  END IF;
END $$;

-- The Session type is free to change before any Spin (even with Participants
-- joined), locked after the first Spin, and unlocked again by Reset.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_err text;
BEGIN
  PERFORM pg_temp.join_as(v_session, 'Joiner');
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['A']);

  -- before any Spin: wheel -> comments works, and back again
  UPDATE public.sessions SET session_type = 'comments' WHERE id = v_session;
  UPDATE public.sessions SET session_type = 'wheel' WHERE id = v_session;

  PERFORM public.spin_wheel(v_session);

  v_err := pg_temp.error_of(format('UPDATE public.sessions SET session_type = ''comments'' WHERE id = %L', v_session));
  IF v_err IS NULL THEN RAISE EXCEPTION 'type changed to comments after a Spin'; END IF;
  v_err := pg_temp.error_of(format(
    'UPDATE public.sessions SET session_type = ''poll'', participation_mode = ''anonymous'' WHERE id = %L', v_session));
  IF v_err IS NULL THEN RAISE EXCEPTION 'type changed to poll after a Spin'; END IF;
  IF (SELECT session_type FROM public.sessions WHERE id = v_session) <> 'wheel' THEN
    RAISE EXCEPTION 'the type moved despite the lock';
  END IF;

  PERFORM public.reset_wheel(v_session);
  UPDATE public.sessions SET session_type = 'comments' WHERE id = v_session;
END $$;

-- Other session types keep their existing behaviour: a Poll may still change
-- to Treasure Hunt (both anonymous) when it has no votes.
DO $$
DECLARE v_owner uuid := gen_random_uuid(); v_session uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, v_owner || '@test.local');
  INSERT INTO public.sessions (id, owner_id, title, slug, session_type, participation_mode)
  VALUES (v_session, v_owner, 'p', 'scn-' || v_session, 'poll', 'anonymous');
  UPDATE public.sessions SET session_type = 'treasure_hunt' WHERE id = v_session;
END $$;

-- The phone read: no Spin yet -> no row; after a Spin it returns the latest
-- Pick's label and whether it was the caller; it never exposes other Entries.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_ada text := pg_temp.join_as(v_session, 'Ada');
  v_bo text := pg_temp.join_as(v_session, 'Bo');
  v_ada_entry uuid := (SELECT e.id FROM public.wheel_entries e JOIN public.participants p ON p.id = e.participant_id WHERE p.join_token = v_ada);
  v_bo_entry uuid := (SELECT e.id FROM public.wheel_entries e JOIN public.participants p ON p.id = e.participant_id WHERE p.join_token = v_bo);
  v_row record;
BEGIN
  IF EXISTS (SELECT 1 FROM public.get_wheel_latest_pick(v_ada)) THEN
    RAISE EXCEPTION 'a phone saw a Pick before any Spin';
  END IF;

  PERFORM pg_temp.act_as_owner(v_session);
  -- Seed Spins directly so the latest Pick is deterministic: Bo, then Ada.
  INSERT INTO public.wheel_spins (session_id, entry_id, label, created_at)
  VALUES (v_session, v_bo_entry, 'Bo', now() - interval '1 minute');
  INSERT INTO public.wheel_spins (session_id, entry_id, label, created_at)
  VALUES (v_session, v_ada_entry, 'Ada', now());

  SELECT * INTO v_row FROM public.get_wheel_latest_pick(v_ada);
  IF v_row.label <> 'Ada' OR v_row.is_you IS NOT TRUE THEN
    RAISE EXCEPTION 'Ada''s phone got label %, is_you %', v_row.label, v_row.is_you;
  END IF;
  SELECT * INTO v_row FROM public.get_wheel_latest_pick(v_bo);
  IF v_row.label <> 'Ada' OR v_row.is_you IS NOT FALSE THEN
    RAISE EXCEPTION 'Bo''s phone got label %, is_you %', v_row.label, v_row.is_you;
  END IF;

  IF pg_temp.error_of(format('SELECT * FROM public.get_wheel_latest_pick(%L)', 'nope')) IS NULL THEN
    RAISE EXCEPTION 'an unknown join token was accepted';
  END IF;
END $$;

-- Phones and anonymous callers cannot read Entries or Spins directly.
DO $$
DECLARE v_session uuid := pg_temp.make_wheel(); v_n integer;
BEGIN
  PERFORM pg_temp.join_as(v_session, 'Ada');
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_n FROM public.wheel_entries WHERE session_id = v_session;
  IF v_n <> 0 THEN RESET ROLE; RAISE EXCEPTION 'anon could read % Entries', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.wheel_spins WHERE session_id = v_session;
  RESET ROLE;
  IF v_n <> 0 THEN RAISE EXCEPTION 'anon could read Spins'; END IF;
END $$;

ROLLBACK;
