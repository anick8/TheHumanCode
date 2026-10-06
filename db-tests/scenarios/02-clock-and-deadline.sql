-- Ticket: the question clock and Lock deadline. The first open stamps the open
-- time once; a Lock after Time limit + 1s grace is refused with time_up.
-- Elapsed time is simulated by back-dating opened_at (now() is frozen in a txn).
\ir ../helpers.sql
BEGIN;

-- Opening a question stamps its open time once; restarting to the lobby and
-- reopening never moves it.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(2);
  v_q0 uuid := pg_temp.question_at(v_session, 0);
  v_q1 uuid := pg_temp.question_at(v_session, 1);
  v_open timestamptz;
  v_backdated timestamptz := now() - interval '10 seconds';
BEGIN
  SELECT opened_at INTO v_open FROM public.questions WHERE id = v_q0;
  IF v_open IS NOT NULL THEN RAISE EXCEPTION 'Q0 has an open time before it was opened'; END IF;

  UPDATE public.sessions SET current_question_index = 0 WHERE id = v_session;
  SELECT opened_at INTO v_open FROM public.questions WHERE id = v_q0;
  IF v_open IS NULL THEN RAISE EXCEPTION 'opening Q0 did not stamp its open time'; END IF;
  IF (SELECT opened_at FROM public.questions WHERE id = v_q1) IS NOT NULL THEN
    RAISE EXCEPTION 'opening Q0 stamped Q1 too';
  END IF;

  UPDATE public.questions SET opened_at = v_backdated WHERE id = v_q0;
  UPDATE public.sessions SET current_question_index = -1 WHERE id = v_session;
  UPDATE public.sessions SET current_question_index = 1 WHERE id = v_session;
  UPDATE public.sessions SET current_question_index = 0 WHERE id = v_session;
  SELECT opened_at INTO v_open FROM public.questions WHERE id = v_q0;
  IF v_open IS DISTINCT FROM v_backdated THEN
    RAISE EXCEPTION 'reopening Q0 moved its open time from % to %', v_backdated, v_open;
  END IF;
END $$;

-- A Lock inside Time limit + 1s grace is accepted.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(1);
  v_q uuid := pg_temp.question_at(v_session, 0);
  v_token text := pg_temp.join_as(v_session, 'Ada');
  v_recorded boolean;
  v_time_up boolean;
BEGIN
  UPDATE public.sessions SET current_question_index = 0 WHERE id = v_session;
  UPDATE public.questions SET opened_at = now() - interval '20.5 seconds' WHERE id = v_q;
  SELECT recorded, time_up INTO v_recorded, v_time_up
    FROM public.submit_identified_vote(v_token, v_q, pg_temp.option_of(v_q, 0));
  IF v_recorded IS NOT TRUE OR v_time_up IS TRUE THEN
    RAISE EXCEPTION 'a Lock inside the grace window was refused (recorded=%, time_up=%)', v_recorded, v_time_up;
  END IF;
END $$;

-- A Lock after the deadline is refused with time_up and records nothing.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(1);
  v_q uuid := pg_temp.question_at(v_session, 0);
  v_token text := pg_temp.join_as(v_session, 'Bo');
  v_recorded boolean;
  v_time_up boolean;
BEGIN
  UPDATE public.sessions SET current_question_index = 0 WHERE id = v_session;
  UPDATE public.questions SET opened_at = now() - interval '22 seconds' WHERE id = v_q;
  SELECT recorded, time_up INTO v_recorded, v_time_up
    FROM public.submit_identified_vote(v_token, v_q, pg_temp.option_of(v_q, 0));
  IF v_recorded IS NOT FALSE OR v_time_up IS NOT TRUE THEN
    RAISE EXCEPTION 'a late Lock was not refused with time_up (recorded=%, time_up=%)', v_recorded, v_time_up;
  END IF;
  IF EXISTS (SELECT 1 FROM public.votes WHERE question_id = v_q) THEN
    RAISE EXCEPTION 'a refused Lock still stored a vote';
  END IF;
END $$;

-- A question opened before this shipped (no open time) has no deadline.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(1);
  v_q uuid := pg_temp.question_at(v_session, 0);
  v_token text := pg_temp.join_as(v_session, 'Cy');
  v_recorded boolean;
BEGIN
  UPDATE public.sessions SET current_question_index = 0 WHERE id = v_session;
  UPDATE public.questions SET opened_at = NULL WHERE id = v_q;
  SELECT recorded INTO v_recorded
    FROM public.submit_identified_vote(v_token, v_q, pg_temp.option_of(v_q, 0));
  IF v_recorded IS NOT TRUE THEN RAISE EXCEPTION 'a question without an open time refused a Lock'; END IF;
END $$;

ROLLBACK;
