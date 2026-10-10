-- Ticket: Round-by-round quiz format. Each revealed question has its own board
-- of correct Participants ranked by Response time; nothing accumulates. The
-- format freezes with the first Answer and only exists on a scored Quiz.
\ir ../helpers.sql
BEGIN;

-- Board: correct only, fastest first, exact ties share a rank, hidden until
-- Reveal, and each question's board is independent of the other.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(2);
  v_q0 uuid := pg_temp.question_at(v_session, 0);
  v_q1 uuid := pg_temp.question_at(v_session, 1);
  v_slow text := pg_temp.join_as(v_session, 'Slow');
  v_fast text := pg_temp.join_as(v_session, 'Fast');
  v_tie text := pg_temp.join_as(v_session, 'Tie');
  v_wrong text := pg_temp.join_as(v_session, 'Wrong');
  v_missed text := pg_temp.join_as(v_session, 'Missed');
  r record;
  v_n integer;
BEGIN
  UPDATE public.sessions SET quiz_format = 'round_by_round' WHERE id = v_session;

  PERFORM pg_temp.open_question(v_session, 0, 30, 25);
  PERFORM pg_temp.lock_at(v_slow, v_q0, 0, 9000);
  PERFORM pg_temp.lock_at(v_fast, v_q0, 0, 3000);
  PERFORM pg_temp.lock_at(v_tie, v_q0, 0, 3000);
  PERFORM pg_temp.lock_at(v_wrong, v_q0, 1, 1000);

  SELECT count(*) INTO v_n FROM public.get_question_leaderboard(v_session, v_q0);
  IF v_n <> 0 THEN RAISE EXCEPTION 'board visible before Reveal: % rows', v_n; END IF;

  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.reveal_quiz_question(v_session);

  SELECT count(*) INTO v_n FROM public.get_question_leaderboard(v_session, v_q0);
  IF v_n <> 3 THEN RAISE EXCEPTION 'expected 3 correct rows, got %', v_n; END IF;

  SELECT * INTO r FROM public.get_question_leaderboard(v_session, v_q0) WHERE display_name = 'Fast';
  IF r.rank <> 1 OR r.response_ms <> 3000 OR r.correct_count <> 3 THEN
    RAISE EXCEPTION 'Fast: expected rank 1 / 3000ms / 3 correct, got % / % / %', r.rank, r.response_ms, r.correct_count;
  END IF;
  SELECT * INTO r FROM public.get_question_leaderboard(v_session, v_q0) WHERE display_name = 'Tie';
  IF r.rank <> 1 THEN RAISE EXCEPTION 'exact tie should share rank 1, got %', r.rank; END IF;
  SELECT * INTO r FROM public.get_question_leaderboard(v_session, v_q0) WHERE display_name = 'Slow';
  IF r.rank <> 3 THEN RAISE EXCEPTION 'Slow: expected rank 3 after a shared first, got %', r.rank; END IF;
  IF EXISTS (SELECT 1 FROM public.get_question_leaderboard(v_session, v_q0)
              WHERE display_name IN ('Wrong', 'Missed')) THEN
    RAISE EXCEPTION 'wrong or missing answers must not be on the board';
  END IF;

  -- Question 2: a different order, nothing carried over.
  PERFORM pg_temp.open_question(v_session, 1, 30, 25);
  PERFORM pg_temp.lock_at(v_slow, v_q1, 0, 2000);
  PERFORM pg_temp.lock_at(v_wrong, v_q1, 0, 6000);
  PERFORM public.reveal_quiz_question(v_session);

  SELECT * INTO r FROM public.get_question_leaderboard(v_session, v_q1) ORDER BY rank LIMIT 1;
  IF r.display_name <> 'Slow' OR r.rank <> 1 OR r.correct_count <> 2 THEN
    RAISE EXCEPTION 'Q2 board: expected Slow first of 2, got % rank % of %', r.display_name, r.rank, r.correct_count;
  END IF;
END $$;

-- Recap: one row per revealed question, joint winners on an exact tie,
-- empty winners when nobody got it right, unrevealed questions left out.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(3);
  v_q0 uuid := pg_temp.question_at(v_session, 0);
  v_q1 uuid := pg_temp.question_at(v_session, 1);
  v_a text := pg_temp.join_as(v_session, 'Ann');
  v_b text := pg_temp.join_as(v_session, 'Ben');
  r record;
  v_n integer;
BEGIN
  UPDATE public.sessions SET quiz_format = 'round_by_round' WHERE id = v_session;
  PERFORM pg_temp.act_as_owner(v_session);

  PERFORM pg_temp.open_question(v_session, 0, 30, 25);
  PERFORM pg_temp.lock_at(v_a, v_q0, 0, 4000);
  PERFORM pg_temp.lock_at(v_b, v_q0, 0, 4000);
  PERFORM public.reveal_quiz_question(v_session);

  PERFORM pg_temp.open_question(v_session, 1, 30, 25);
  PERFORM pg_temp.lock_at(v_a, v_q1, 1, 1000);
  PERFORM public.reveal_quiz_question(v_session);

  SELECT count(*) INTO v_n FROM public.get_round_recap(v_session);
  IF v_n <> 2 THEN RAISE EXCEPTION 'recap should list 2 revealed questions, got %', v_n; END IF;

  SELECT * INTO r FROM public.get_round_recap(v_session) WHERE order_index = 0;
  IF cardinality(r.winner_names) <> 2 OR r.winner_ms <> 4000 OR r.correct_count <> 2 THEN
    RAISE EXCEPTION 'Q1 recap: expected 2 joint winners at 4000ms, got % at % (% correct)',
      r.winner_names, r.winner_ms, r.correct_count;
  END IF;

  SELECT * INTO r FROM public.get_round_recap(v_session) WHERE order_index = 1;
  IF cardinality(r.winner_names) <> 0 OR r.winner_ms IS NOT NULL OR r.correct_count <> 0 THEN
    RAISE EXCEPTION 'Q2 recap: expected nobody, got % / % / %', r.winner_names, r.winner_ms, r.correct_count;
  END IF;
END $$;

-- A Classic quiz exposes neither board nor recap.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(1);
  v_q uuid := pg_temp.question_at(v_session, 0);
  v_tok text := pg_temp.join_as(v_session, 'Solo');
  v_n integer;
BEGIN
  PERFORM pg_temp.open_question(v_session, 0, 30, 25);
  PERFORM pg_temp.lock_at(v_tok, v_q, 0, 2000);
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.reveal_quiz_question(v_session);
  SELECT count(*) INTO v_n FROM public.get_question_leaderboard(v_session, v_q);
  IF v_n <> 0 THEN RAISE EXCEPTION 'Classic quiz leaked a question board'; END IF;
  SELECT count(*) INTO v_n FROM public.get_round_recap(v_session);
  IF v_n <> 0 THEN RAISE EXCEPTION 'Classic quiz leaked a recap'; END IF;
END $$;

-- Format: changes freely before the first Answer, freezes after; only a scored
-- Quiz may use it; the default is Classic.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(1);
  v_poll uuid := gen_random_uuid();
  v_q uuid := pg_temp.question_at(v_session, 0);
  v_tok text := pg_temp.join_as(v_session, 'Freeze');
  v_err text;
BEGIN
  IF (SELECT quiz_format FROM public.sessions WHERE id = v_session) <> 'classic' THEN
    RAISE EXCEPTION 'default format should be classic';
  END IF;

  UPDATE public.sessions SET quiz_format = 'round_by_round' WHERE id = v_session;
  UPDATE public.sessions SET quiz_format = 'classic' WHERE id = v_session;
  UPDATE public.sessions SET quiz_format = 'round_by_round' WHERE id = v_session;

  PERFORM pg_temp.open_question(v_session, 0, 30, 0);
  PERFORM pg_temp.lock_at(v_tok, v_q, 0, 1000);
  v_err := pg_temp.error_of(
    format('UPDATE public.sessions SET quiz_format = %L WHERE id = %L', 'classic', v_session));
  IF v_err IS NULL OR v_err NOT LIKE '%cannot be changed after voting has started%' THEN
    RAISE EXCEPTION 'format should freeze after the first Answer, got: %', v_err;
  END IF;

  INSERT INTO auth.users (id, email) VALUES (v_poll, v_poll || '@test.local');
  v_err := pg_temp.error_of(format(
    'INSERT INTO public.sessions (owner_id, title, slug, session_type, participation_mode, quiz_format) '
    || 'VALUES (%L, %L, %L, %L, %L, %L)',
    v_poll, 'Bad', 'scn-bad-' || v_poll, 'poll', 'anonymous', 'round_by_round'));
  IF v_err IS NULL THEN RAISE EXCEPTION 'a poll must not accept round_by_round'; END IF;
END $$;

ROLLBACK;
