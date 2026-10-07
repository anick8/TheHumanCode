-- Ticket: Wheel of Fortune - joining. A Participant who joins a wheel session
-- is put on the wheel as exactly one active joined Entry.
\ir ../helpers.sql
BEGIN;

-- Joining creates exactly one active joined Entry labelled with the name,
-- linked to the Participant.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_token text := pg_temp.join_as(v_session, '  Ada  ');
  v_participant uuid := (SELECT id FROM public.participants WHERE join_token = v_token);
  v_n integer;
  v_entry public.wheel_entries%ROWTYPE;
BEGIN
  SELECT count(*) INTO v_n FROM public.wheel_entries WHERE session_id = v_session;
  IF v_n <> 1 THEN RAISE EXCEPTION 'joining created % Entries, expected 1', v_n; END IF;
  SELECT * INTO v_entry FROM public.wheel_entries WHERE session_id = v_session;
  IF v_entry.label <> 'Ada' THEN RAISE EXCEPTION 'Entry label is %, expected trimmed Ada', v_entry.label; END IF;
  IF v_entry.kind <> 'joined' THEN RAISE EXCEPTION 'Entry kind is %, expected joined', v_entry.kind; END IF;
  IF v_entry.participant_id IS DISTINCT FROM v_participant THEN RAISE EXCEPTION 'Entry is not linked to the Participant'; END IF;
  IF v_entry.removed_at IS NOT NULL THEN RAISE EXCEPTION 'a new joined Entry starts removed'; END IF;
END $$;

-- Same name twice is allowed: two Participants, two Entries.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_a text := pg_temp.join_as(v_session, 'Sam');
  v_b text := pg_temp.join_as(v_session, 'Sam');
BEGIN
  IF (SELECT count(*) FROM public.wheel_entries WHERE session_id = v_session) <> 2 THEN
    RAISE EXCEPTION 'two joins named Sam did not give two Entries';
  END IF;
END $$;

-- A blank name is refused and leaves nothing behind.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_err text := pg_temp.error_of(format('SELECT public.join_session(%L, %L, NULL, %L)', v_session, '   ', 'tok-blank'));
BEGIN
  IF v_err IS NULL THEN RAISE EXCEPTION 'a blank name was accepted'; END IF;
  IF EXISTS (SELECT 1 FROM public.wheel_entries WHERE session_id = v_session) THEN
    RAISE EXCEPTION 'a refused join left an Entry';
  END IF;
END $$;

-- A name over 24 characters is refused; exactly 24 is fine.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_err text := pg_temp.error_of(format('SELECT public.join_session(%L, %L, NULL, %L)', v_session, repeat('x', 25), 'tok-long'));
BEGIN
  IF v_err IS NULL THEN RAISE EXCEPTION 'a 25-character name was accepted'; END IF;
  PERFORM pg_temp.join_as(v_session, repeat('y', 24));
  IF (SELECT count(*) FROM public.wheel_entries WHERE session_id = v_session) <> 1 THEN
    RAISE EXCEPTION 'expected only the 24-character join to have an Entry';
  END IF;
END $$;

-- Joining an inactive session is refused.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel(false);
  v_err text := pg_temp.error_of(format('SELECT public.join_session(%L, %L, NULL, %L)', v_session, 'Late', 'tok-late'));
BEGIN
  IF v_err IS NULL THEN RAISE EXCEPTION 'joining an inactive wheel was accepted'; END IF;
  IF EXISTS (SELECT 1 FROM public.wheel_entries WHERE session_id = v_session) THEN
    RAISE EXCEPTION 'a refused join left an Entry';
  END IF;
END $$;

ROLLBACK;
