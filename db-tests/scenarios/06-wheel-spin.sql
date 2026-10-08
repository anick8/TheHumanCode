-- Ticket: Wheel of Fortune - Spin and resolving the Pick. The server picks an
-- active Entry at random and records a Spin; resolving with "remove" takes the
-- Pick off the wheel, "keep" changes nothing.
\ir ../helpers.sql
BEGIN;

-- Spin is refused for non-organizers.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_err text;
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['A', 'B']);
  PERFORM pg_temp.act_as_stranger();
  v_err := pg_temp.error_of(format('SELECT * FROM public.spin_wheel(%L)', v_session));
  IF v_err IS NULL THEN RAISE EXCEPTION 'a stranger spun the wheel'; END IF;
  IF EXISTS (SELECT 1 FROM public.wheel_spins WHERE session_id = v_session) THEN
    RAISE EXCEPTION 'a refused Spin was recorded';
  END IF;
END $$;

-- Spin is refused with fewer than 2 active Entries (0, 1, and 1 after removal).
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_err text;
  v_entry uuid;
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  v_err := pg_temp.error_of(format('SELECT * FROM public.spin_wheel(%L)', v_session));
  IF v_err IS NULL THEN RAISE EXCEPTION 'spun an empty wheel'; END IF;

  PERFORM public.add_wheel_entries(v_session, ARRAY['A', 'B']);
  SELECT id INTO v_entry FROM public.wheel_entries WHERE session_id = v_session AND label = 'B';
  PERFORM public.remove_wheel_entry(v_entry);
  v_err := pg_temp.error_of(format('SELECT * FROM public.spin_wheel(%L)', v_session));
  IF v_err IS NULL THEN RAISE EXCEPTION 'spun a wheel with one active Entry'; END IF;
  IF EXISTS (SELECT 1 FROM public.wheel_spins WHERE session_id = v_session) THEN
    RAISE EXCEPTION 'a refused Spin was recorded';
  END IF;
END $$;

-- A Spin records a Spin row with a label snapshot and returns it.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_spin record;
  v_row public.wheel_spins%ROWTYPE;
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['A', 'B']);
  SELECT * INTO v_spin FROM public.spin_wheel(v_session);
  SELECT * INTO v_row FROM public.wheel_spins WHERE id = v_spin.spin_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'the returned Spin was not recorded'; END IF;
  IF v_row.session_id <> v_session OR v_row.entry_id IS DISTINCT FROM v_spin.entry_id
     OR v_row.label IS DISTINCT FROM v_spin.label OR v_row.removed THEN
    RAISE EXCEPTION 'the recorded Spin does not match the returned one';
  END IF;
  IF v_row.label <> (SELECT label FROM public.wheel_entries WHERE id = v_row.entry_id) THEN
    RAISE EXCEPTION 'the label snapshot is not the Entry label';
  END IF;
END $$;

-- Over many Spins every Pick is an active Entry and a removed Entry is never
-- picked; both active Entries get picked (not stuck on one).
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_gone uuid;
  v_spin record;
  v_seen text[] := '{}';
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['A', 'B', 'GONE']);
  SELECT id INTO v_gone FROM public.wheel_entries WHERE session_id = v_session AND label = 'GONE';
  PERFORM public.remove_wheel_entry(v_gone);
  FOR i IN 1..200 LOOP
    SELECT * INTO v_spin FROM public.spin_wheel(v_session);
    IF v_spin.label NOT IN ('A', 'B') THEN RAISE EXCEPTION 'Spin % picked %', i, v_spin.label; END IF;
    IF NOT (v_spin.label = ANY (v_seen)) THEN v_seen := v_seen || v_spin.label; END IF;
  END LOOP;
  IF cardinality(v_seen) <> 2 THEN RAISE EXCEPTION '200 Spins only ever picked %', v_seen; END IF;
END $$;

-- Resolving with "remove" removes the Entry and marks the Spin; the Pick
-- cannot come up again.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_spin record;
  v_next record;
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['A', 'B', 'C']);
  SELECT * INTO v_spin FROM public.spin_wheel(v_session);
  PERFORM public.resolve_wheel_pick(v_spin.spin_id, true);
  IF NOT (SELECT removed FROM public.wheel_spins WHERE id = v_spin.spin_id) THEN
    RAISE EXCEPTION 'the Spin was not marked removed';
  END IF;
  IF (SELECT removed_at FROM public.wheel_entries WHERE id = v_spin.entry_id) IS NULL THEN
    RAISE EXCEPTION 'the Pick is still on the wheel';
  END IF;
  FOR i IN 1..50 LOOP
    SELECT * INTO v_next FROM public.spin_wheel(v_session);
    IF v_next.entry_id = v_spin.entry_id THEN RAISE EXCEPTION 'a removed Pick was picked again'; END IF;
  END LOOP;
END $$;

-- Resolving with "keep" leaves Entry and Spin unchanged.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_spin record;
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['A', 'B']);
  SELECT * INTO v_spin FROM public.spin_wheel(v_session);
  PERFORM public.resolve_wheel_pick(v_spin.spin_id, false);
  IF (SELECT removed FROM public.wheel_spins WHERE id = v_spin.spin_id) THEN
    RAISE EXCEPTION 'keep marked the Spin removed';
  END IF;
  IF (SELECT removed_at FROM public.wheel_entries WHERE id = v_spin.entry_id) IS NOT NULL THEN
    RAISE EXCEPTION 'keep removed the Entry';
  END IF;
END $$;

-- Only the organizer may resolve a Pick.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_spin record;
  v_err text;
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['A', 'B']);
  SELECT * INTO v_spin FROM public.spin_wheel(v_session);
  PERFORM pg_temp.act_as_stranger();
  v_err := pg_temp.error_of(format('SELECT public.resolve_wheel_pick(%L, true)', v_spin.spin_id));
  IF v_err IS NULL THEN RAISE EXCEPTION 'a stranger resolved a Pick'; END IF;
  IF (SELECT removed FROM public.wheel_spins WHERE id = v_spin.spin_id) THEN
    RAISE EXCEPTION 'a refused resolve changed the Spin';
  END IF;
END $$;

-- Removing an Entry keeps its past Spins in the history.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_spin record;
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['A', 'B']);
  SELECT * INTO v_spin FROM public.spin_wheel(v_session);
  PERFORM public.remove_wheel_entry(v_spin.entry_id);
  IF NOT EXISTS (SELECT 1 FROM public.wheel_spins WHERE id = v_spin.spin_id AND label = v_spin.label) THEN
    RAISE EXCEPTION 'removing the Entry lost its past Spin';
  END IF;
END $$;

ROLLBACK;
