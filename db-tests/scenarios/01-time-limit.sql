-- Ticket: per-question Time limit. Default 20s, range 5-120, frozen once answered.
\ir ../helpers.sql
BEGIN;

DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(1);
  v_question uuid;
  v_limit integer;
BEGIN
  v_question := pg_temp.question_at(v_session, 0);

  -- A new question gets a 20 second Time limit.
  SELECT time_limit_seconds INTO v_limit FROM public.questions WHERE id = v_question;
  IF v_limit IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION 'expected default Time limit 20, got %', v_limit;
  END IF;

  -- The boundaries 5 and 120 are accepted.
  UPDATE public.questions SET time_limit_seconds = 5 WHERE id = v_question;
  UPDATE public.questions SET time_limit_seconds = 120 WHERE id = v_question;

  -- Anything outside 5-120 is rejected.
  BEGIN
    UPDATE public.questions SET time_limit_seconds = 4 WHERE id = v_question;
    RAISE EXCEPTION 'a 4 second Time limit was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.questions SET time_limit_seconds = 121 WHERE id = v_question;
    RAISE EXCEPTION 'a 121 second Time limit was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $$;

-- Once a Participant has Answered, the Time limit can no longer change.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(1);
  v_question uuid := pg_temp.question_at(v_session, 0);
  v_token text := pg_temp.join_as(v_session, 'Ada');
BEGIN
  UPDATE public.sessions SET current_question_index = 0 WHERE id = v_session;
  PERFORM public.submit_identified_vote(v_token, v_question, pg_temp.option_of(v_question, 0));
  BEGIN
    UPDATE public.questions SET time_limit_seconds = 30 WHERE id = v_question;
    RAISE EXCEPTION 'Time limit changed after an Answer';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%Time limit cannot change%' THEN RAISE; END IF;
  END;
END $$;

ROLLBACK;
