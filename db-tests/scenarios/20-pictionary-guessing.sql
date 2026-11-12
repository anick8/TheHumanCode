-- Ticket: Pictionary Guess judging, host pick and scoring.
\ir ../helpers.sql
BEGIN;

-- Matching: normalisation, typo allowance by Word length, phrases, 5-word cap.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT * FROM (VALUES
    ('cat', 'cat', true), ('cat', 'CAT', true), ('cat', ' c.a.t! ', true),
    ('ice cream', 'icecream', true), ('ice cream', 'Ice-Cream', true),
    ('cat', 'a cat', true), ('cat', 'The Cat', true), ('cat', 'an cat', true),
    ('cat', 'cats', true), ('horse', 'horses', true), ('boxes', 'box', true),
    ('cat', 'bat', false), ('cat', 'car', false), ('cat', 'ca', false), ('dog', 'dig', false),
    ('apple', 'appel', false),                 -- a swap is 2 edits; 5-8 letters allow 1
    ('apple', 'aple', true), ('apple', 'appple', true), ('apple', 'applo', true),
    ('elephant', 'elefant', false),            -- 2 edits
    ('elephant', 'elephent', true), ('elephant', 'elefent', false),
    ('hippopotamus', 'hipopotamus', true),     -- 9+ letters allow 2
    ('hippopotamus', 'hipopotamas', true),
    ('hippopotamus', 'hipopotamaz', false),    -- 3 edits
    ('cat', 'is it a cat??', true),
    ('ice cream', 'i think ice cream', true), ('ice cream', 'its some ice cream', true),
    ('ice cream', 'ice or cream', false),
    ('cat', 'one two three four cat', true),            -- 5 words
    ('cat', 'one two three four five cat', false),      -- 6 words: judged as a whole only
    ('cat', 'dog', false), ('cat', 'dogs and bats', false)
  ) AS t(w, g, expected) LOOP
    IF pg_temp.matches(c.w, c.g) IS DISTINCT FROM c.expected THEN
      RAISE EXCEPTION 'Word % / Guess "%": expected %', c.w, c.g, c.expected;
    END IF;
  END LOOP;
END $$;

-- Refusals: Drawer, strangers, empty, rate limit, outside the Drawing window.
DO $$
DECLARE
  v_session uuid := pg_temp.drawing_round('cat');
  v_drawer text := pg_temp.drawer_token(v_session);
  v_g text[] := pg_temp.guesser_tokens(v_session);
  v_err text;
BEGIN
  v_err := pg_temp.error_of(format('SELECT * FROM public.submit_pictionary_guess(%L, %L)', v_drawer, 'cat'));
  IF v_err IS NULL OR v_err NOT LIKE '%drawer%' THEN RAISE EXCEPTION 'Drawer guessed: %', v_err; END IF;
  v_err := pg_temp.error_of(format('SELECT * FROM public.submit_pictionary_guess(%L, %L)', 'nope', 'cat'));
  IF v_err IS NULL THEN RAISE EXCEPTION 'unknown token guessed'; END IF;
  v_err := pg_temp.error_of(format('SELECT * FROM public.submit_pictionary_guess(%L, %L)', v_g[1], '   '));
  IF v_err IS NULL THEN RAISE EXCEPTION 'empty Guess accepted'; END IF;

  IF (SELECT g.won FROM public.submit_pictionary_guess(v_g[1], 'dog') g) THEN RAISE EXCEPTION 'dog won'; END IF;
  v_err := pg_temp.error_of(format('SELECT * FROM public.submit_pictionary_guess(%L, %L)', v_g[1], 'pig'));
  IF v_err IS NULL OR v_err NOT LIKE '%wait%' THEN RAISE EXCEPTION 'rate limit missing: %', v_err; END IF;
  PERFORM public.submit_pictionary_guess(v_g[2], 'pig');   -- the limit is per Participant
  PERFORM pg_temp.age_guesses(v_g[1], 3);
  PERFORM public.submit_pictionary_guess(v_g[1], 'pig');   -- and lifts after 2 seconds

  UPDATE public.pictionary_rounds SET ends_at = now() - interval '1 second' WHERE session_id = v_session;
  PERFORM pg_temp.age_guesses(v_g[1], 3);
  v_err := pg_temp.error_of(format('SELECT * FROM public.submit_pictionary_guess(%L, %L)', v_g[1], 'cat'));
  IF v_err IS NULL OR v_err NOT LIKE '%not open%' THEN RAISE EXCEPTION 'late Guess accepted: %', v_err; END IF;
END $$;

-- Choosing and Revealed refuse Guesses.
DO $$
DECLARE
  v_session uuid := pg_temp.make_pictionary();
  v_err text;
BEGIN
  PERFORM pg_temp.join_as(v_session, 'Ann');
  PERFORM pg_temp.join_as(v_session, 'Ben');
  PERFORM public.start_pictionary_round(v_session);
  v_err := pg_temp.error_of(format('SELECT * FROM public.submit_pictionary_guess(%L, %L)', (pg_temp.guesser_tokens(v_session))[1], 'cat'));
  IF v_err IS NULL THEN RAISE EXCEPTION 'Guess accepted while choosing'; END IF;
  PERFORM public.skip_pictionary_round(v_session);
  v_err := pg_temp.error_of(format('SELECT * FROM public.submit_pictionary_guess(%L, %L)', (pg_temp.guesser_tokens(v_session))[1], 'cat'));
  IF v_err IS NULL THEN RAISE EXCEPTION 'Guess accepted after reveal'; END IF;
END $$;

-- First match wins; a later match changes nothing; the Round is revealed.
DO $$
DECLARE
  v_session uuid := pg_temp.drawing_round('cat');
  v_g text[] := pg_temp.guesser_tokens(v_session);
  r public.pictionary_rounds;
  v_err text;
BEGIN
  UPDATE public.pictionary_rounds SET started_at = now() - interval '20 seconds', ends_at = now() + interval '60 seconds' WHERE session_id = v_session;
  IF (SELECT g.won FROM public.submit_pictionary_guess(v_g[1], 'dog') g) THEN RAISE EXCEPTION 'miss won'; END IF;
  IF NOT (SELECT g.won FROM public.submit_pictionary_guess(v_g[2], 'cat') g) THEN RAISE EXCEPTION 'match did not win'; END IF;
  r := pg_temp.latest_round(v_session);
  IF r.status <> 'revealed' OR r.end_reason <> 'guessed' OR r.word <> 'cat' THEN RAISE EXCEPTION 'Round not revealed as guessed: %', r; END IF;
  IF r.winner_participant_id IS DISTINCT FROM (SELECT id FROM public.participants WHERE join_token = v_g[2]) THEN
    RAISE EXCEPTION 'wrong winner';
  END IF;
  IF abs(r.winner_points - 750) > 5 OR r.drawer_points <> 500 THEN RAISE EXCEPTION 'points % / %', r.winner_points, r.drawer_points; END IF;
  PERFORM pg_temp.age_guesses(v_g[1], 3);
  v_err := pg_temp.error_of(format('SELECT * FROM public.submit_pictionary_guess(%L, %L)', v_g[1], 'cat'));
  IF v_err IS NULL THEN RAISE EXCEPTION 'a later match was accepted'; END IF;
  IF (pg_temp.latest_round(v_session)).winner_participant_id IS DISTINCT FROM r.winner_participant_id THEN
    RAISE EXCEPTION 'winner changed by a later match';
  END IF;
END $$;

-- Scoring scale and floor (time left at the Guess's submit time, 80s Round).
DO $$
DECLARE
  c record;
  v_session uuid;
BEGIN
  FOR c IN SELECT * FROM (VALUES (80, 1000), (40, 500), (60, 750), (24, 300), (10, 300), (1, 300)) AS t(left_s, expected) LOOP
    v_session := pg_temp.drawing_round('cat');
    UPDATE public.pictionary_rounds SET started_at = now() + make_interval(secs => c.left_s - 80), ends_at = now() + make_interval(secs => c.left_s) WHERE session_id = v_session;
    PERFORM public.submit_pictionary_guess((pg_temp.guesser_tokens(v_session))[1], 'cat');
    IF abs((pg_temp.latest_round(v_session)).winner_points - c.expected) > 5 THEN
      RAISE EXCEPTION '% s left: expected %, got %', c.left_s, c.expected, (pg_temp.latest_round(v_session)).winner_points;
    END IF;
  END LOOP;
END $$;

-- Skip awards nothing.
DO $$
DECLARE
  v_session uuid := pg_temp.drawing_round('cat');
BEGIN
  PERFORM public.skip_pictionary_round(v_session);
  IF EXISTS (SELECT 1 FROM public.get_pictionary_leaderboard(v_session) WHERE score <> 0) THEN
    RAISE EXCEPTION 'skipped Round awarded points';
  END IF;
  IF (pg_temp.latest_round(v_session)).drawer_points <> 0 THEN RAISE EXCEPTION 'drawer paid for skip'; END IF;
END $$;

-- Host pick and Change winner.
DO $$
DECLARE
  v_session uuid := pg_temp.drawing_round('cat');
  v_g text[] := pg_temp.guesser_tokens(v_session);
  v_one uuid; v_two uuid;
  v_c1 uuid; v_c2 uuid;
  r public.pictionary_rounds;
  v_err text;
BEGIN
  SELECT id INTO v_one FROM public.participants WHERE join_token = v_g[1];
  SELECT id INTO v_two FROM public.participants WHERE join_token = v_g[2];
  UPDATE public.pictionary_rounds SET ends_at = now() + interval '80 seconds' WHERE session_id = v_session;
  v_c1 := (SELECT g.comment_id FROM public.submit_pictionary_guess(v_g[1], 'kitty') g);
  v_c2 := (SELECT g.comment_id FROM public.submit_pictionary_guess(v_g[2], 'kitten') g);
  UPDATE public.comments SET created_at = now() + interval '40 seconds' WHERE id = v_c2;  -- 40s left

  PERFORM pg_temp.act_as_stranger();
  v_err := pg_temp.error_of(format('SELECT * FROM public.pick_pictionary_winner(%L, %L)', v_session, v_c1));
  IF v_err IS NULL OR v_err NOT LIKE '%Not authorized%' THEN RAISE EXCEPTION 'stranger picked: %', v_err; END IF;
  PERFORM pg_temp.act_as_owner(v_session);

  -- while drawing: ends the Round; points come from the Guess's time, not the click
  r := public.pick_pictionary_winner(v_session, v_c1);
  IF r.status <> 'revealed' OR r.end_reason <> 'guessed' OR r.word <> 'cat' THEN RAISE EXCEPTION 'pick did not reveal: %', r; END IF;
  IF r.winner_participant_id <> v_one OR abs(r.winner_points - 1000) > 5 OR r.drawer_points <> 500 THEN
    RAISE EXCEPTION 'pick result %', r;
  END IF;

  -- Change winner moves the points; the Drawer bonus stays
  r := public.pick_pictionary_winner(v_session, v_c2);
  IF r.winner_participant_id <> v_two OR r.winner_points <> 500 OR r.drawer_points <> 500 THEN
    RAISE EXCEPTION 'change result %', r;
  END IF;
  IF (SELECT score FROM public.get_pictionary_leaderboard(v_session) WHERE participant_id = v_one) <> 0
     OR (SELECT score FROM public.get_pictionary_leaderboard(v_session) WHERE participant_id = v_two) <> 500
     OR (SELECT score FROM public.get_pictionary_leaderboard(v_session) WHERE participant_id = r.drawer_id) <> 500 THEN
    RAISE EXCEPTION 'points did not move';
  END IF;

  -- once the next Round starts, the old one is final
  PERFORM public.start_pictionary_round(v_session);
  v_err := pg_temp.error_of(format('SELECT * FROM public.pick_pictionary_winner(%L, %L)', v_session, v_c1));
  IF v_err IS NULL THEN RAISE EXCEPTION 'winner changed after the next Round started'; END IF;
END $$;

-- Picking a winner of a timed-out Round awards it (Guess time is before the end: 300 floor).
DO $$
DECLARE
  v_session uuid := pg_temp.drawing_round('cat');
  v_c uuid := (SELECT g.comment_id FROM public.submit_pictionary_guess((pg_temp.guesser_tokens(v_session))[1], 'kitty') g);
  r public.pictionary_rounds;
BEGIN
  UPDATE public.pictionary_rounds SET ends_at = now() - interval '1 second' WHERE session_id = v_session;
  PERFORM public.timeout_pictionary_round(v_session);
  IF (pg_temp.latest_round(v_session)).end_reason <> 'timeout' THEN RAISE EXCEPTION 'not timed out'; END IF;
  r := public.pick_pictionary_winner(v_session, v_c);
  IF r.end_reason <> 'guessed' OR r.winner_points <> 300 OR r.drawer_points <> 500 THEN RAISE EXCEPTION 'late pick %', r; END IF;
END $$;

-- Feed, leaderboard shape and per-Round results.
DO $$
DECLARE
  v_session uuid := pg_temp.drawing_round('cat');
  v_g text[] := pg_temp.guesser_tokens(v_session);
  v_name2 text := (SELECT name FROM public.participants WHERE join_token = v_g[2]);
  v_round1 uuid := (pg_temp.latest_round(v_session)).id;
  v_n integer; v_row record;
BEGIN
  IF (SELECT array_agg(rank) FROM public.get_pictionary_leaderboard(v_session)) <> ARRAY[1,1,1]::bigint[] THEN
    RAISE EXCEPTION 'a fresh game is one big tie';
  END IF;

  UPDATE public.pictionary_rounds SET started_at = now() - interval '40 seconds', ends_at = now() + interval '40 seconds' WHERE id = v_round1;
  PERFORM public.submit_pictionary_guess(v_g[1], 'dog');
  PERFORM public.submit_pictionary_guess(v_g[2], 'cat');   -- 500 points, same as the Drawer
  UPDATE public.comments SET created_at = now() WHERE round_id = v_round1 AND body = 'cat';
  PERFORM public.pick_pictionary_winner(v_session, (SELECT id FROM public.comments WHERE round_id = v_round1 AND body = 'cat'));
  PERFORM public.start_pictionary_round(v_session);
  PERFORM public.skip_pictionary_round(v_session);

  IF (SELECT count(*) FROM public.get_pictionary_guesses(v_session, v_round1)) <> 2 THEN
    RAISE EXCEPTION 'feed should have 2 Guesses';
  END IF;
  SELECT * INTO v_row FROM public.get_pictionary_guesses(v_session, v_round1) WHERE is_winner;
  IF v_row.body <> 'cat' OR v_row.author_name <> v_name2 THEN RAISE EXCEPTION 'winner row %', v_row; END IF;
  IF (SELECT count(*) FROM public.get_pictionary_guesses(v_session)) <> 0 THEN
    RAISE EXCEPTION 'default feed is the newest Round';
  END IF;
  SELECT count(*) INTO v_n FROM public.comments WHERE round_id = v_round1;
  IF v_n <> 2 THEN RAISE EXCEPTION 'Guesses should be stored as comments'; END IF;

  -- Leaderboard component columns; equal Scores share a rank
  FOR v_row IN SELECT * FROM public.get_pictionary_leaderboard(v_session) LOOP
    IF v_row.participant_id IS NULL OR v_row.display_name IS NULL OR v_row.score IS NULL OR v_row.rank IS NULL
       OR v_row.answered_count IS NULL OR v_row.total_response_ms IS NULL THEN
      RAISE EXCEPTION 'leaderboard shape %', v_row;
    END IF;
  END LOOP;
  IF (SELECT array_agg(rank ORDER BY rank) FROM public.get_pictionary_leaderboard(v_session)) <> ARRAY[1,1,3]::bigint[]
     OR (SELECT array_agg(score ORDER BY rank, score) FROM public.get_pictionary_leaderboard(v_session)) <> ARRAY[500,500,0] THEN
    RAISE EXCEPTION 'expected scores 500/500/0 ranked 1/1/3';
  END IF;

  -- results: one row per revealed Round
  IF (SELECT count(*) FROM public.get_pictionary_results(v_session)) <> 2 THEN RAISE EXCEPTION 'results rows'; END IF;
  SELECT * INTO v_row FROM public.get_pictionary_results(v_session) WHERE round_number = 1;
  IF v_row.word <> 'cat' OR v_row.winner_name <> v_name2 OR v_row.drawer_name IS NULL OR v_row.end_reason <> 'guessed'
     OR v_row.seconds_to_guess IS NULL OR v_row.winner_points <> 500 OR v_row.drawer_points <> 500 THEN
    RAISE EXCEPTION 'results row 1 %', v_row;
  END IF;
  SELECT * INTO v_row FROM public.get_pictionary_results(v_session) WHERE round_number = 2;
  IF v_row.winner_name IS NOT NULL OR v_row.seconds_to_guess IS NOT NULL OR v_row.end_reason <> 'skipped' THEN
    RAISE EXCEPTION 'results row 2 (nobody) %', v_row;
  END IF;

  IF has_function_privilege('anon', 'public.pick_pictionary_winner(uuid, uuid)', 'execute') THEN
    RAISE EXCEPTION 'anon can pick winners';
  END IF;
  IF NOT has_function_privilege('anon', 'public.submit_pictionary_guess(text, text)', 'execute')
     OR NOT has_function_privilege('anon', 'public.get_pictionary_guesses(uuid, uuid)', 'execute') THEN
    RAISE EXCEPTION 'anon cannot guess or read the feed';
  END IF;
END $$;

ROLLBACK;
