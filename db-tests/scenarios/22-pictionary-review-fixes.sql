-- Ticket: Pictionary review fixes (swap scoring hole, Round timing snapshot, races, plural matching).
\ir ../helpers.sql
BEGIN;

-- Plural matching: equal with or without a trailing s/es, short words stay strict.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('cake', 'cakes', true), ('cakes', 'cake', true), ('bus', 'buses', true), ('buses', 'bus', true),
    ('bus', 'bus', true), ('cat', 'cats', true), ('cats', 'cat', true), ('box', 'boxes', true),
    ('cat', 'bat', false), ('cat', 'car', false), ('bus', 'bu', false), ('cat', 'ca', false),
    ('bat', 'cats', false), ('cake', 'cape', false)
  ) AS t(w, g, expected) LOOP
    IF pg_temp.matches(c.w, c.g) IS DISTINCT FROM c.expected THEN
      RAISE EXCEPTION 'Word % / Guess "%": expected %', c.w, c.g, c.expected;
    END IF;
  END LOOP;
END $$;

-- Pick another Drawer: a Guess made before the swap is dropped with the old Word and
-- timer, so it can never be picked (it was judged against another Word and ends_at).
-- A Guess by the current Drawer can never be picked either.
DO $$
DECLARE
  v_session uuid := pg_temp.drawing_round('cat');
  v_g text[] := pg_temp.guesser_tokens(v_session);
  v_old uuid;
  v_new uuid;
  v_err text;
BEGIN
  v_old := (SELECT g.comment_id FROM public.submit_pictionary_guess(v_g[1], 'kitty') g);
  PERFORM public.pick_another_pictionary_drawer(v_session, (SELECT id FROM public.participants WHERE join_token = v_g[1]));
  IF EXISTS (SELECT 1 FROM public.comments WHERE id = v_old) THEN RAISE EXCEPTION 'old Guess survived the swap'; END IF;
  v_err := pg_temp.error_of(format('SELECT * FROM public.pick_pictionary_winner(%L, %L)', v_session, v_old));
  IF v_err IS NULL THEN RAISE EXCEPTION 'a pre-swap Guess was pickable'; END IF;

  -- defence in depth: even a stored Guess by the Drawer is refused
  INSERT INTO public.comments (round_id, participant_id, body)
  VALUES ((pg_temp.latest_round(v_session)).id, (pg_temp.latest_round(v_session)).drawer_id, 'sneaky')
  RETURNING id INTO v_new;
  PERFORM public.skip_pictionary_round(v_session);
  v_err := pg_temp.error_of(format('SELECT * FROM public.pick_pictionary_winner(%L, %L)', v_session, v_new));
  IF v_err IS NULL OR v_err NOT LIKE '%drawer%' THEN RAISE EXCEPTION 'Drawer Guess was pickable: %', v_err; END IF;
END $$;

-- Scoring uses the Round's own timing; the setting cannot change once a Round exists.
DO $$
DECLARE
  v_session uuid := pg_temp.drawing_round('cat');
  v_g text[] := pg_temp.guesser_tokens(v_session);
  v_err text;
  r public.pictionary_rounds;
BEGIN
  v_err := pg_temp.error_of(format('UPDATE public.sessions SET pictionary_round_seconds = 30 WHERE id = %L', v_session));
  IF v_err IS NULL OR v_err NOT LIKE '%round time%' THEN RAISE EXCEPTION 'round time changed after a Round: %', v_err; END IF;

  -- a 40s Round with 20s left is worth 500 (the 80s session setting would give 250 -> 300)
  UPDATE public.pictionary_rounds SET ends_at = started_at + interval '40 seconds' WHERE session_id = v_session;
  PERFORM public.submit_pictionary_guess(v_g[1], 'dog');
  UPDATE public.comments SET created_at = now() + interval '20 seconds' WHERE round_id = (pg_temp.latest_round(v_session)).id;
  r := public.pick_pictionary_winner(v_session, (SELECT id FROM public.comments WHERE round_id = (pg_temp.latest_round(v_session)).id));
  IF r.winner_points <> 500 THEN RAISE EXCEPTION 'expected 500 from the Round timing, got %', r.winner_points; END IF;
END $$;

-- Races: skip after a win is refused; auto-pick is a no-op once the Round moved on or
-- the offers are cleared; a Guess is stamped with real server time.
DO $$
DECLARE
  v_session uuid := pg_temp.drawing_round('cat');
  v_g text[] := pg_temp.guesser_tokens(v_session);
  v_err text;
  r public.pictionary_rounds;
BEGIN
  PERFORM public.submit_pictionary_guess(v_g[1], 'cat');
  v_err := pg_temp.error_of(format('SELECT * FROM public.skip_pictionary_round(%L)', v_session));
  IF v_err IS NULL THEN RAISE EXCEPTION 'skip overwrote a won Round'; END IF;
  IF (pg_temp.latest_round(v_session)).end_reason <> 'guessed' THEN RAISE EXCEPTION 'won Round no longer guessed'; END IF;

  IF (SELECT c.created_at FROM public.comments c WHERE c.round_id = (pg_temp.latest_round(v_session)).id) = now() THEN
    RAISE EXCEPTION 'Guess stamped with the frozen transaction time';
  END IF;

  -- auto-pick on a Round that already moved to drawing changes nothing
  v_session := pg_temp.drawing_round('cat');
  r := pg_temp.latest_round(v_session);
  UPDATE public.pictionary_rounds SET choose_deadline = now() - interval '1 second' WHERE id = r.id;
  PERFORM public.auto_pick_pictionary_word(v_session);
  IF (pg_temp.latest_round(v_session)).started_at IS DISTINCT FROM r.started_at
     OR (pg_temp.latest_round(v_session)).word_pattern IS DISTINCT FROM r.word_pattern THEN
    RAISE EXCEPTION 'auto-pick restarted a drawing Round';
  END IF;

  -- auto-pick with no offers left (the Drawer's pick cleared them) leaves a Choosing Round alone
  v_session := pg_temp.make_pictionary();
  PERFORM pg_temp.join_as(v_session, 'Ann');
  PERFORM pg_temp.join_as(v_session, 'Ben');
  PERFORM public.start_pictionary_round(v_session);
  UPDATE public.pictionary_words SET offered_round_id = NULL WHERE session_id = v_session;
  UPDATE public.pictionary_rounds SET choose_deadline = now() - interval '1 second' WHERE session_id = v_session;
  PERFORM public.auto_pick_pictionary_word(v_session);
  IF (pg_temp.latest_round(v_session)).status <> 'choosing' THEN RAISE EXCEPTION 'auto-pick without offers started drawing'; END IF;
END $$;

ROLLBACK;
