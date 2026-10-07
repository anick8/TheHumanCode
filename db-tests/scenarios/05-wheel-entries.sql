-- Ticket: Wheel of Fortune - managing Entries. add_wheel_entries trims, drops
-- blanks and caps length; remove/restore flip an Entry off and on the wheel;
-- only the organizer may do any of it; removal leaves past Spins in history.
\ir ../helpers.sql
BEGIN;

-- Manual Entries are trimmed, blanks dropped, long ones capped at 24; the
-- RPC returns how many it added.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_added integer;
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  v_added := public.add_wheel_entries(v_session, ARRAY['  Ann ', '', '   ', 'Bob', repeat('z', 40)]);
  IF v_added <> 3 THEN RAISE EXCEPTION 'added % Entries, expected 3', v_added; END IF;
  IF pg_temp.active_labels(v_session) <> ARRAY['Ann', 'Bob', repeat('z', 24)] THEN
    RAISE EXCEPTION 'unexpected labels %', pg_temp.active_labels(v_session);
  END IF;
  IF EXISTS (SELECT 1 FROM public.wheel_entries WHERE session_id = v_session
              AND (kind <> 'manual' OR participant_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'manual Entries must be kind manual with no Participant';
  END IF;
END $$;

-- Pasted duplicates are all kept (no de-duplication).
DO $$
DECLARE v_session uuid := pg_temp.make_wheel();
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['Dup', 'Dup']);
  IF (SELECT count(*) FROM public.wheel_entries WHERE session_id = v_session) <> 2 THEN
    RAISE EXCEPTION 'duplicate manual Entries were collapsed';
  END IF;
END $$;

-- Non-organizers and signed-out callers are refused for every Entry RPC.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_entry uuid;
  v_err text;
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['Ann']);
  SELECT id INTO v_entry FROM public.wheel_entries WHERE session_id = v_session;

  PERFORM pg_temp.act_as_stranger();
  v_err := pg_temp.error_of(format('SELECT public.add_wheel_entries(%L, ARRAY[''Eve''])', v_session));
  IF v_err IS NULL THEN RAISE EXCEPTION 'a stranger added Entries'; END IF;
  v_err := pg_temp.error_of(format('SELECT public.remove_wheel_entry(%L)', v_entry));
  IF v_err IS NULL THEN RAISE EXCEPTION 'a stranger removed an Entry'; END IF;
  v_err := pg_temp.error_of(format('SELECT public.restore_wheel_entry(%L)', v_entry));
  IF v_err IS NULL THEN RAISE EXCEPTION 'a stranger restored an Entry'; END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  v_err := pg_temp.error_of(format('SELECT public.add_wheel_entries(%L, ARRAY[''Eve''])', v_session));
  IF v_err IS NULL THEN RAISE EXCEPTION 'a signed-out caller added Entries'; END IF;

  IF pg_temp.active_labels(v_session) <> ARRAY['Ann'] THEN
    RAISE EXCEPTION 'refused calls changed the wheel: %', pg_temp.active_labels(v_session);
  END IF;
END $$;

-- Add is refused on a session that is not a wheel.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(1);
  v_err text;
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  v_err := pg_temp.error_of(format('SELECT public.add_wheel_entries(%L, ARRAY[''Eve''])', v_session));
  IF v_err IS NULL THEN RAISE EXCEPTION 'Entries were added to a quiz'; END IF;
END $$;

-- Remove takes a joined or manual Entry off the wheel (row kept, greyed out);
-- Restore puts it back.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_joined uuid;
  v_manual uuid;
BEGIN
  PERFORM pg_temp.join_as(v_session, 'Joiner');
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['Manual']);
  SELECT id INTO v_joined FROM public.wheel_entries WHERE session_id = v_session AND kind = 'joined';
  SELECT id INTO v_manual FROM public.wheel_entries WHERE session_id = v_session AND kind = 'manual';

  PERFORM public.remove_wheel_entry(v_joined);
  PERFORM public.remove_wheel_entry(v_manual);
  IF pg_temp.active_labels(v_session) <> '{}' THEN RAISE EXCEPTION 'removed Entries are still active'; END IF;
  IF (SELECT count(*) FROM public.wheel_entries WHERE session_id = v_session) <> 2 THEN
    RAISE EXCEPTION 'removal deleted Entry rows';
  END IF;
  IF (SELECT count(*) FROM public.participants WHERE session_id = v_session) <> 1 THEN
    RAISE EXCEPTION 'removing an Entry removed the Participant';
  END IF;

  PERFORM public.restore_wheel_entry(v_joined);
  IF pg_temp.active_labels(v_session) <> ARRAY['Joiner'] THEN
    RAISE EXCEPTION 'restore did not put the Entry back: %', pg_temp.active_labels(v_session);
  END IF;
END $$;

-- Removing and restoring an unknown Entry is refused.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_err text;
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  v_err := pg_temp.error_of(format('SELECT public.remove_wheel_entry(%L)', gen_random_uuid()));
  IF v_err IS NULL THEN RAISE EXCEPTION 'removing an unknown Entry succeeded'; END IF;
END $$;

ROLLBACK;
