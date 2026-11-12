-- Ticket: spec #50 story 24. Remove participant works in a Pictionary session; removing the
-- current Drawer leaves the Round recoverable through Pick another Drawer.
\ir ../helpers.sql
BEGIN;

DO $$
DECLARE
  v_session uuid := pg_temp.drawing_round('cat');
  v_g text[] := pg_temp.guesser_tokens(v_session);
  v_guesser uuid := (SELECT id FROM public.participants WHERE join_token = v_g[1]);
  v_guess uuid;
  v_drawer uuid := (pg_temp.latest_round(v_session)).drawer_id;
  v_round public.pictionary_rounds;
BEGIN
  v_guess := (SELECT g.comment_id FROM public.submit_pictionary_guess(v_g[1], 'dog') g);

  -- a guesser: removed with their Guess
  PERFORM public.remove_participant(v_guesser);
  IF EXISTS (SELECT 1 FROM public.participants WHERE id = v_guesser) THEN RAISE EXCEPTION 'guesser not removed'; END IF;
  IF EXISTS (SELECT 1 FROM public.comments WHERE id = v_guess) THEN RAISE EXCEPTION 'removed Participant''s Guess survived'; END IF;

  -- the current Drawer: the Round keeps going with no Drawer until the host swaps
  PERFORM public.remove_participant(v_drawer);
  v_round := pg_temp.latest_round(v_session);
  IF v_round.drawer_id IS NOT NULL THEN RAISE EXCEPTION 'Round still points at the removed Drawer'; END IF;
  PERFORM public.pick_another_pictionary_drawer(v_session);
  v_round := pg_temp.latest_round(v_session);
  IF v_round.drawer_id IS NULL OR v_round.status <> 'choosing' THEN
    RAISE EXCEPTION 'Pick another Drawer did not recover the Round: drawer %, status %', v_round.drawer_id, v_round.status;
  END IF;

  -- still owner-only
  PERFORM pg_temp.act_as_stranger();
  IF pg_temp.error_of(format('SELECT public.remove_participant(%L)', v_round.drawer_id)) IS NULL THEN
    RAISE EXCEPTION 'a stranger removed a Participant';
  END IF;
END $$;

ROLLBACK;
