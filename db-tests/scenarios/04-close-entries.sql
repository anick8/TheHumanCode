-- Ticket: close entries. Quiz/Comments refuse new joins, Poll refuses votes;
-- already-joined devices keep playing; the host can reopen.
\ir ../helpers.sql
BEGIN;

-- A quiz: closed refuses a new join, lets a joined token rejoin, reopens.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(1);
  v_token text;
BEGIN
  v_token := pg_temp.join_as(v_session, 'Early');
  PERFORM pg_temp.open_question(v_session, 0, 20, 0);

  UPDATE public.sessions SET entries_closed = true WHERE id = v_session;

  BEGIN
    PERFORM pg_temp.join_as(v_session, 'Late');
    RAISE EXCEPTION 'a new join was accepted while entries were closed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Entries are closed for this session' THEN RAISE; END IF;
  END;

  -- The same device (same token) still resolves.
  PERFORM public.join_session(v_session, 'Early', NULL, v_token);

  -- A joined participant can still answer.
  PERFORM public.submit_identified_vote(
    v_token, pg_temp.question_at(v_session, 0),
    pg_temp.option_of(pg_temp.question_at(v_session, 0), 0));

  UPDATE public.sessions SET entries_closed = false WHERE id = v_session;
  PERFORM pg_temp.join_as(v_session, 'Late');
END $$;

-- A poll: closed refuses every vote; reopening accepts them again.
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_question uuid := gen_random_uuid();
  v_option uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, v_owner || '@test.local');
  INSERT INTO public.sessions (id, owner_id, title, slug, session_type, participation_mode)
  VALUES (v_session, v_owner, 'Scenario poll', 'scn-' || v_session, 'poll', 'anonymous');
  INSERT INTO public.questions (id, session_id, text, order_index) VALUES (v_question, v_session, 'Q', 0);
  INSERT INTO public.options (id, question_id, text, order_index) VALUES (v_option, v_question, 'A', 0);

  PERFORM public.submit_anonymous_vote('voter-1', v_question, v_option);

  UPDATE public.sessions SET entries_closed = true WHERE id = v_session;
  BEGIN
    PERFORM public.submit_anonymous_vote('voter-2', v_question, v_option);
    RAISE EXCEPTION 'a vote was accepted while the poll was closed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Voting is closed' THEN RAISE; END IF;
  END;
  -- Even a voter who already voted is refused: nothing gets in.
  BEGIN
    PERFORM public.submit_anonymous_vote('voter-1', v_question, v_option);
    RAISE EXCEPTION 'a repeat vote was accepted while the poll was closed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Voting is closed' THEN RAISE; END IF;
  END;

  UPDATE public.sessions SET entries_closed = false WHERE id = v_session;
  PERFORM public.submit_anonymous_vote('voter-2', v_question, v_option);

  IF (SELECT count(*) FROM public.votes WHERE question_id = v_question) <> 2 THEN
    RAISE EXCEPTION 'expected 2 votes after reopening';
  END IF;
END $$;

ROLLBACK;
