-- Ticket: join limit. A session's max_participants caps how many Participants
-- can join; manual Entries don't count.
\ir ../helpers.sql
BEGIN;

DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_a text;
  v_err text;
  v_owner uuid := (SELECT owner_id FROM public.sessions WHERE id = v_session);
BEGIN
  UPDATE public.sessions SET max_participants = 2 WHERE id = v_session;

  v_a := pg_temp.join_as(v_session, 'One');
  PERFORM pg_temp.join_as(v_session, 'Two');

  -- Full: a third join is refused and leaves nothing behind.
  v_err := pg_temp.error_of(format('SELECT public.join_session(%L, %L, NULL, %L)', v_session, 'Three', 'tok-three'));
  IF v_err IS DISTINCT FROM 'This session is full' THEN
    RAISE EXCEPTION 'a third join was not refused (got %)', v_err;
  END IF;
  IF (SELECT count(*) FROM public.participants WHERE session_id = v_session) <> 2 THEN
    RAISE EXCEPTION 'a refused join left a Participant';
  END IF;
  IF (SELECT count(*) FROM public.wheel_entries WHERE session_id = v_session) <> 2 THEN
    RAISE EXCEPTION 'a refused join left an Entry';
  END IF;

  -- Even a known token cannot push the count past the limit.
  v_err := pg_temp.error_of(format('SELECT public.join_session(%L, %L, NULL, %L)', v_session, 'One', v_a));
  IF v_err IS DISTINCT FROM 'This session is full' THEN
    RAISE EXCEPTION 'a repeat join_session call got past the limit (got %)', v_err;
  END IF;

  -- Manual Entries are not Participants: the organizer can still add them.
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['Manual']);
  IF (SELECT count(*) FROM public.wheel_entries WHERE session_id = v_session) <> 3 THEN
    RAISE EXCEPTION 'a manual Entry was not added while full';
  END IF;

  -- Raising the limit makes room; clearing it removes the cap.
  UPDATE public.sessions SET max_participants = 3 WHERE id = v_session;
  PERFORM pg_temp.join_as(v_session, 'Three');
  v_err := pg_temp.error_of(format('SELECT public.join_session(%L, %L, NULL, %L)', v_session, 'Four', 'tok-four'));
  IF v_err IS DISTINCT FROM 'This session is full' THEN
    RAISE EXCEPTION 'the raised limit was not enforced (got %)', v_err;
  END IF;
  UPDATE public.sessions SET max_participants = NULL WHERE id = v_session;
  PERFORM pg_temp.join_as(v_session, 'Four');
  PERFORM pg_temp.join_as(v_session, 'Five');
END $$;

-- The limit must be positive.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_err text := pg_temp.error_of(format('UPDATE public.sessions SET max_participants = 0 WHERE id = %L', v_session));
BEGIN
  IF v_err IS NULL THEN RAISE EXCEPTION 'max_participants = 0 was accepted'; END IF;
END $$;

ROLLBACK;
