-- Fixtures shared by the scenario scripts. Everything lives in pg_temp, so it
-- disappears with the transaction each scenario rolls back.

-- A scored quiz owned by a fresh organizer, with p_questions questions that
-- each have two options; option 0 is the correct answer. Returns the session id.
CREATE FUNCTION pg_temp.make_quiz(p_questions integer DEFAULT 2) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_question uuid;
  v_option uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, v_owner || '@test.local');
  INSERT INTO public.sessions (id, owner_id, title, slug, session_type, participation_mode, is_scored, current_question_index)
  VALUES (v_session, v_owner, 'Scenario quiz', 'scn-' || v_session, 'quiz', 'identified', true, -1);
  FOR i IN 0..p_questions - 1 LOOP
    v_question := gen_random_uuid();
    INSERT INTO public.questions (id, session_id, text, order_index) VALUES (v_question, v_session, 'Q' || i, i);
    v_option := gen_random_uuid();
    INSERT INTO public.options (id, question_id, text, order_index) VALUES (v_option, v_question, 'right', 0);
    INSERT INTO public.options (question_id, text, order_index) VALUES (v_question, 'wrong', 1);
    INSERT INTO public.question_keys (question_id, option_id) VALUES (v_question, v_option);
  END LOOP;
  RETURN v_session;
END $$;

-- Joins a participant through the public RPC and returns their join token.
CREATE FUNCTION pg_temp.join_as(p_session uuid, p_name text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_token text := 'tok-' || gen_random_uuid();
BEGIN
  PERFORM public.join_session(p_session, p_name, NULL, v_token);
  RETURN v_token;
END $$;

-- The id of the question at a given position of a session.
CREATE FUNCTION pg_temp.question_at(p_session uuid, p_index integer) RETURNS uuid
LANGUAGE sql AS $$
  SELECT id FROM public.questions WHERE session_id = p_session AND order_index = p_index
$$;

-- Option id of the right (0) or wrong (1) choice of a question.
CREATE FUNCTION pg_temp.option_of(p_question uuid, p_order integer) RETURNS uuid
LANGUAGE sql AS $$
  SELECT id FROM public.options WHERE question_id = p_question AND order_index = p_order
$$;

-- Acts as the session's organizer for auth.uid()-guarded RPCs.
CREATE FUNCTION pg_temp.act_as_owner(p_session uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT owner_id INTO v_owner FROM public.sessions WHERE id = p_session;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
END $$;

-- Opens the question at p_index with the given Time limit, then back-dates its
-- open time so p_elapsed_s seconds have already passed (now() is frozen inside
-- a transaction, so elapsed time can only be simulated).
CREATE FUNCTION pg_temp.open_question(p_session uuid, p_index integer, p_limit_s integer, p_elapsed_s integer)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_question uuid := pg_temp.question_at(p_session, p_index);
BEGIN
  UPDATE public.questions SET time_limit_seconds = p_limit_s WHERE id = v_question;
  UPDATE public.sessions SET current_question_index = p_index, results_revealed = false WHERE id = p_session;
  UPDATE public.questions SET opened_at = now() - make_interval(secs => p_elapsed_s) WHERE id = v_question;
END $$;

-- Locks through the public RPC (option 0 = right, 1 = wrong), then back-dates
-- the stored Lock so it landed p_ms milliseconds after the question opened.
CREATE FUNCTION pg_temp.lock_at(p_token text, p_question uuid, p_option_order integer, p_ms integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.submit_identified_vote(p_token, p_question, pg_temp.option_of(p_question, p_option_order));
  UPDATE public.votes v
     SET created_at = (SELECT q.opened_at FROM public.questions q WHERE q.id = p_question)
                      + make_interval(secs => p_ms / 1000.0)
   WHERE v.question_id = p_question
     AND v.participant_id = (SELECT id FROM public.participants WHERE join_token = p_token);
END $$;

