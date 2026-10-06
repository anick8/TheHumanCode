-- Ticket: Response time Tiebreak. Score is flat points only; ties are broken by
-- lowest cumulative Response time (Lock minus first open, capped at the Time
-- limit; a missed question counts the full limit).
\ir ../helpers.sql
BEGIN;

-- Faster tie wins; a slower correct Answer keeps full points; a wrong Answer
-- still accrues its real time; a missed question accrues the full limit.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(1);
  v_q uuid := pg_temp.question_at(v_session, 0);
  v_slow text := pg_temp.join_as(v_session, 'Slow');
  v_fast text := pg_temp.join_as(v_session, 'Fast');
  v_wrong text := pg_temp.join_as(v_session, 'Wrong');
  v_missed text := pg_temp.join_as(v_session, 'Missed');
  v_points integer;
  r record;
BEGIN
  PERFORM pg_temp.open_question(v_session, 0, 30, 25);
  PERFORM pg_temp.lock_at(v_slow, v_q, 0, 12000);
  PERFORM pg_temp.lock_at(v_fast, v_q, 0, 5000);
  PERFORM pg_temp.lock_at(v_wrong, v_q, 1, 7000);
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.reveal_quiz_question(v_session);

  SELECT points INTO v_points FROM public.questions WHERE id = v_q;

  SELECT * INTO r FROM public.get_leaderboard(v_session) WHERE display_name = 'Fast';
  IF r.rank <> 1 OR r.total_response_ms <> 5000 THEN
    RAISE EXCEPTION 'Fast: expected rank 1 / 5000ms, got rank % / %ms', r.rank, r.total_response_ms;
  END IF;

  SELECT * INTO r FROM public.get_leaderboard(v_session) WHERE display_name = 'Slow';
  IF r.rank <> 2 OR r.total_response_ms <> 12000 OR r.score <> v_points THEN
    RAISE EXCEPTION 'Slow: expected rank 2 / 12000ms / % points, got rank % / %ms / %',
      v_points, r.rank, r.total_response_ms, r.score;
  END IF;

  SELECT * INTO r FROM public.get_leaderboard(v_session) WHERE display_name = 'Wrong';
  IF r.score <> 0 OR r.total_response_ms <> 7000 THEN
    RAISE EXCEPTION 'Wrong: expected 0 points / 7000ms, got % / %ms', r.score, r.total_response_ms;
  END IF;

  -- Wrong and Missed both have 0 points, so the faster wrong Answer ranks above
  -- the missed one (30000ms).
  SELECT * INTO r FROM public.get_leaderboard(v_session) WHERE display_name = 'Missed';
  IF r.score <> 0 OR r.total_response_ms <> 30000 OR r.rank <> 4 THEN
    RAISE EXCEPTION 'Missed: expected 0 points / 30000ms / rank 4, got % / %ms / rank %',
      r.score, r.total_response_ms, r.rank;
  END IF;
END $$;

-- A Lock slower than the limit (inside the grace) is capped at the limit.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(1);
  v_q uuid := pg_temp.question_at(v_session, 0);
  v_tok text := pg_temp.join_as(v_session, 'Edge');
  v_ms bigint;
BEGIN
  PERFORM pg_temp.open_question(v_session, 0, 30, 25);
  PERFORM pg_temp.lock_at(v_tok, v_q, 0, 30500);
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.reveal_quiz_question(v_session);
  SELECT total_response_ms INTO v_ms FROM public.get_leaderboard(v_session) WHERE display_name = 'Edge';
  IF v_ms <> 30000 THEN RAISE EXCEPTION 'expected capped 30000ms, got %', v_ms; END IF;
END $$;

-- A repeat Reveal, or a restart to the lobby and reopen, adds nothing twice.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(1);
  v_q uuid := pg_temp.question_at(v_session, 0);
  v_tok text := pg_temp.join_as(v_session, 'Once');
  v_ms bigint;
BEGIN
  PERFORM pg_temp.open_question(v_session, 0, 30, 25);
  PERFORM pg_temp.lock_at(v_tok, v_q, 0, 4000);
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.reveal_quiz_question(v_session);
  PERFORM public.reveal_quiz_question(v_session);
  UPDATE public.sessions SET current_question_index = -1 WHERE id = v_session;
  UPDATE public.sessions SET current_question_index = 0 WHERE id = v_session;
  PERFORM public.reveal_quiz_question(v_session);
  SELECT total_response_ms INTO v_ms FROM public.get_leaderboard(v_session) WHERE display_name = 'Once';
  IF v_ms <> 4000 THEN RAISE EXCEPTION 'expected 4000ms after repeat reveals, got %', v_ms; END IF;
END $$;

-- A late joiner is seeded with the Time limits of questions already revealed.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(2);
  v_early text := pg_temp.join_as(v_session, 'Early');
  v_q0 uuid := pg_temp.question_at(v_session, 0);
  v_ms bigint;
BEGIN
  PERFORM pg_temp.open_question(v_session, 0, 30, 25);
  PERFORM pg_temp.lock_at(v_early, v_q0, 0, 3000);
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.reveal_quiz_question(v_session);
  PERFORM pg_temp.join_as(v_session, 'Late');
  SELECT total_response_ms INTO v_ms FROM public.get_leaderboard(v_session) WHERE display_name = 'Late';
  IF v_ms <> 30000 THEN RAISE EXCEPTION 'late joiner expected seed 30000ms, got %', v_ms; END IF;
END $$;

-- Exactly equal Score and Response time share a rank.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(1);
  v_q uuid := pg_temp.question_at(v_session, 0);
  v_a text := pg_temp.join_as(v_session, 'TwinA');
  v_b text := pg_temp.join_as(v_session, 'TwinB');
  v_ranks bigint[];
BEGIN
  PERFORM pg_temp.open_question(v_session, 0, 30, 25);
  PERFORM pg_temp.lock_at(v_a, v_q, 0, 6000);
  PERFORM pg_temp.lock_at(v_b, v_q, 0, 6000);
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.reveal_quiz_question(v_session);
  SELECT array_agg(rank) INTO v_ranks FROM public.get_leaderboard(v_session);
  IF v_ranks <> ARRAY[1, 1]::bigint[] THEN RAISE EXCEPTION 'twins did not share rank 1: %', v_ranks; END IF;
END $$;

-- A question with no open time (opened before this shipped) adds nothing.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(1);
  v_q uuid := pg_temp.question_at(v_session, 0);
  v_tok text := pg_temp.join_as(v_session, 'Old');
  v_ms bigint;
BEGIN
  UPDATE public.sessions SET current_question_index = 0 WHERE id = v_session;
  UPDATE public.questions SET opened_at = NULL WHERE id = v_q;
  PERFORM public.submit_identified_vote(v_tok, v_q, pg_temp.option_of(v_q, 0));
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.reveal_quiz_question(v_session);
  SELECT total_response_ms INTO v_ms FROM public.get_leaderboard(v_session) WHERE display_name = 'Old';
  IF v_ms <> 0 THEN RAISE EXCEPTION 'a question without an open time added %ms', v_ms; END IF;
END $$;

-- A participant's own rank follows the same Tiebreak.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(1);
  v_q uuid := pg_temp.question_at(v_session, 0);
  v_a text := pg_temp.join_as(v_session, 'Quick');
  v_b text := pg_temp.join_as(v_session, 'Steady');
  v_rank_a bigint;
  v_rank_b bigint;
BEGIN
  PERFORM pg_temp.open_question(v_session, 0, 30, 25);
  PERFORM pg_temp.lock_at(v_b, v_q, 0, 15000);
  PERFORM pg_temp.lock_at(v_a, v_q, 0, 2000);
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.reveal_quiz_question(v_session);
  SELECT participant_rank INTO v_rank_a FROM public.get_participant_standing(v_a);
  SELECT participant_rank INTO v_rank_b FROM public.get_participant_standing(v_b);
  IF v_rank_a <> 1 OR v_rank_b <> 2 THEN
    RAISE EXCEPTION 'standing ranks expected 1 and 2, got % and %', v_rank_a, v_rank_b;
  END IF;
END $$;

-- A Legacy quiz (unscored) keeps ranking ties by when each finished.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(1);
  v_first text := pg_temp.join_as(v_session, 'First');
  v_second text := pg_temp.join_as(v_session, 'Second');
  v_rank_first bigint;
  v_rank_second bigint;
BEGIN
  UPDATE public.sessions SET is_scored = false WHERE id = v_session;
  UPDATE public.participants SET finished_at = now() - interval '5 minutes' WHERE join_token = v_first;
  UPDATE public.participants SET finished_at = now() - interval '1 minute' WHERE join_token = v_second;
  SELECT participant_rank INTO v_rank_first FROM public.get_participant_standing(v_first);
  SELECT participant_rank INTO v_rank_second FROM public.get_participant_standing(v_second);
  IF v_rank_first <> 1 OR v_rank_second <> 2 THEN
    RAISE EXCEPTION 'Legacy ordering changed: got ranks % and %', v_rank_first, v_rank_second;
  END IF;
END $$;

ROLLBACK;
