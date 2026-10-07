-- Review fixes: resolving a Pick stamps resolved_at and is refused when the Spin
-- is already resolved, not the latest, or not on a wheel; phones only see Spins
-- older than 7 seconds (the presenter animation is 5s).
\ir ../helpers.sql
BEGIN;

-- Remove and keep both stamp resolved_at; a fresh Spin has none.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_spin record;
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['A', 'B', 'C']);
  SELECT * INTO v_spin FROM public.spin_wheel(v_session);
  IF (SELECT resolved_at FROM public.wheel_spins WHERE id = v_spin.spin_id) IS NOT NULL THEN
    RAISE EXCEPTION 'a fresh Spin was already resolved';
  END IF;
  PERFORM public.resolve_wheel_pick(v_spin.spin_id, false);
  IF (SELECT resolved_at FROM public.wheel_spins WHERE id = v_spin.spin_id) IS NULL THEN
    RAISE EXCEPTION 'keep did not stamp resolved_at';
  END IF;
  IF (SELECT removed FROM public.wheel_spins WHERE id = v_spin.spin_id) THEN
    RAISE EXCEPTION 'keep marked the Spin removed';
  END IF;
END $$;

DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_spin record;
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['A', 'B', 'C']);
  SELECT * INTO v_spin FROM public.spin_wheel(v_session);
  PERFORM public.resolve_wheel_pick(v_spin.spin_id, true);
  IF (SELECT resolved_at FROM public.wheel_spins WHERE id = v_spin.spin_id) IS NULL
     OR NOT (SELECT removed FROM public.wheel_spins WHERE id = v_spin.spin_id) THEN
    RAISE EXCEPTION 'remove did not stamp resolved_at and removed';
  END IF;
END $$;

-- Refused: already resolved (and the second call changes nothing).
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_spin record;
  v_err text;
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['A', 'B', 'C']);
  SELECT * INTO v_spin FROM public.spin_wheel(v_session);
  PERFORM public.resolve_wheel_pick(v_spin.spin_id, false);
  v_err := pg_temp.error_of(format('SELECT public.resolve_wheel_pick(%L, true)', v_spin.spin_id));
  IF v_err IS NULL THEN RAISE EXCEPTION 'resolved a Spin twice'; END IF;
  IF (SELECT removed_at FROM public.wheel_entries WHERE id = v_spin.entry_id) IS NOT NULL THEN
    RAISE EXCEPTION 'a refused resolve removed the Entry';
  END IF;
END $$;

-- Refused: not the session's latest Spin.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_old uuid := gen_random_uuid();
  v_new uuid := gen_random_uuid();
  v_entry uuid;
  v_err text;
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['A', 'B']);
  SELECT id INTO v_entry FROM public.wheel_entries WHERE session_id = v_session AND label = 'A';
  INSERT INTO public.wheel_spins (id, session_id, entry_id, label, created_at)
  VALUES (v_old, v_session, v_entry, 'A', now() - interval '1 minute'),
         (v_new, v_session, v_entry, 'A', now());
  v_err := pg_temp.error_of(format('SELECT public.resolve_wheel_pick(%L, true)', v_old));
  IF v_err IS NULL THEN RAISE EXCEPTION 'resolved a Spin that is not the latest'; END IF;
  IF (SELECT removed_at FROM public.wheel_entries WHERE id = v_entry) IS NOT NULL THEN
    RAISE EXCEPTION 'a refused resolve removed the Entry';
  END IF;
  PERFORM public.resolve_wheel_pick(v_new, false);
END $$;

-- Refused: the session is not a wheel.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_spin uuid := gen_random_uuid();
  v_entry uuid;
  v_err text;
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['A', 'B']);
  SELECT id INTO v_entry FROM public.wheel_entries WHERE session_id = v_session AND label = 'A';
  INSERT INTO public.wheel_spins (id, session_id, entry_id, label) VALUES (v_spin, v_session, v_entry, 'A');
  -- comments is allowed before... the Spin exists, so flip the type around the lock trigger
  ALTER TABLE public.sessions DISABLE TRIGGER USER;
  UPDATE public.sessions SET session_type = 'comments' WHERE id = v_session;
  ALTER TABLE public.sessions ENABLE TRIGGER USER;
  v_err := pg_temp.error_of(format('SELECT public.resolve_wheel_pick(%L, true)', v_spin));
  IF v_err IS NULL THEN RAISE EXCEPTION 'resolved a Spin on a non-wheel session'; END IF;
END $$;

-- Phone read: only Spins older than 7s are visible; a young latest Spin falls
-- back to the previous old one, and with no old Spin there is no row.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_ada text := pg_temp.join_as(v_session, 'Ada');
  v_ada_entry uuid := (SELECT e.id FROM public.wheel_entries e JOIN public.participants p ON p.id = e.participant_id WHERE p.join_token = v_ada);
  v_other uuid;
  v_row record;
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['Old']);
  SELECT id INTO v_other FROM public.wheel_entries WHERE session_id = v_session AND label = 'Old';

  INSERT INTO public.wheel_spins (session_id, entry_id, label, created_at)
  VALUES (v_session, v_ada_entry, 'Ada', now() - interval '3 seconds');
  IF EXISTS (SELECT 1 FROM public.get_wheel_latest_pick(v_ada)) THEN
    RAISE EXCEPTION 'a phone saw a 3-second-old Pick with no earlier one';
  END IF;

  INSERT INTO public.wheel_spins (session_id, entry_id, label, created_at)
  VALUES (v_session, v_other, 'Old', now() - interval '1 minute');
  SELECT * INTO v_row FROM public.get_wheel_latest_pick(v_ada);
  IF v_row.label IS DISTINCT FROM 'Old' THEN
    RAISE EXCEPTION 'expected the previous Pick, got %', v_row.label;
  END IF;

  UPDATE public.wheel_spins SET created_at = now() - interval '8 seconds' WHERE label = 'Ada' AND session_id = v_session;
  SELECT * INTO v_row FROM public.get_wheel_latest_pick(v_ada);
  IF v_row.label IS DISTINCT FROM 'Ada' OR v_row.is_you IS NOT TRUE THEN
    RAISE EXCEPTION 'expected Ada once 8 seconds old, got %', v_row.label;
  END IF;
END $$;

ROLLBACK;
