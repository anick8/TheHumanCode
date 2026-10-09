-- Ticket: clear responses. The host's Clear deletes what the audience produced
-- (Participants, Votes, Comments, joined Entries, Spins) and keeps what the host
-- authored (Questions, Options, keys, manual Entries). A quiz rewinds to
-- not-started. Owner only; a treasure hunt is refused.
\ir ../helpers.sql
BEGIN;

-- Quiz: players and answers go, questions/options/keys stay, state rewinds,
-- and the structure lock lifts.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(2);
  v_a text;
  v_b text;
  v_counts json;
BEGIN
  v_a := pg_temp.join_as(v_session, 'Alice');
  v_b := pg_temp.join_as(v_session, 'Bob');
  PERFORM pg_temp.open_question(v_session, 0, 20, 0);
  PERFORM pg_temp.lock_at(v_a, pg_temp.question_at(v_session, 0), 0, 1000);
  PERFORM pg_temp.lock_at(v_b, pg_temp.question_at(v_session, 0), 1, 2000);
  UPDATE public.sessions SET results_revealed = true, show_leaderboard = true, scored_closed = true
   WHERE id = v_session;

  PERFORM pg_temp.act_as_owner(v_session);
  v_counts := public.get_clearable_counts(v_session);
  IF (v_counts->>'participants')::int <> 2 OR (v_counts->>'votes')::int <> 2 THEN
    RAISE EXCEPTION 'counts wrong: %', v_counts;
  END IF;

  PERFORM public.clear_session_responses(v_session);

  IF EXISTS (SELECT 1 FROM public.participants WHERE session_id = v_session) THEN
    RAISE EXCEPTION 'participants survived the clear';
  END IF;
  IF EXISTS (SELECT 1 FROM public.votes v JOIN public.questions q ON q.id = v.question_id
              WHERE q.session_id = v_session) THEN
    RAISE EXCEPTION 'votes survived the clear';
  END IF;
  IF (SELECT count(*) FROM public.questions WHERE session_id = v_session) <> 2
     OR (SELECT count(*) FROM public.options o JOIN public.questions q ON q.id = o.question_id
          WHERE q.session_id = v_session) <> 4
     OR (SELECT count(*) FROM public.question_keys k JOIN public.questions q ON q.id = k.question_id
          WHERE q.session_id = v_session) <> 2 THEN
    RAISE EXCEPTION 'questions, options or keys were deleted';
  END IF;
  IF EXISTS (SELECT 1 FROM public.questions WHERE session_id = v_session
              AND (opened_at IS NOT NULL OR revealed_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'question clocks were not rewound';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sessions WHERE id = v_session
                  AND current_question_index = -1 AND NOT results_revealed
                  AND NOT show_leaderboard AND NOT scored_closed
                  AND responses_cleared_at IS NOT NULL) THEN
    RAISE EXCEPTION 'quiz state was not rewound';
  END IF;
  -- Structure lock is lifted: a question can be deleted again.
  DELETE FROM public.questions WHERE id = pg_temp.question_at(v_session, 1);
END $$;

-- Poll: anonymous votes go, questions stay; entries_closed is untouched.
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
  PERFORM public.submit_anonymous_vote('v1', v_question, v_option);
  PERFORM public.submit_anonymous_vote('v2', v_question, v_option);
  UPDATE public.sessions SET entries_closed = true WHERE id = v_session;

  PERFORM pg_temp.act_as_owner(v_session);
  IF (public.get_clearable_counts(v_session)->>'votes')::int <> 2 THEN
    RAISE EXCEPTION 'poll vote count wrong';
  END IF;
  PERFORM public.clear_session_responses(v_session);

  IF EXISTS (SELECT 1 FROM public.votes WHERE question_id = v_question) THEN
    RAISE EXCEPTION 'poll votes survived the clear';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.options WHERE id = v_option) THEN
    RAISE EXCEPTION 'poll option was deleted';
  END IF;
  IF NOT (SELECT entries_closed FROM public.sessions WHERE id = v_session) THEN
    RAISE EXCEPTION 'clear changed entries_closed';
  END IF;
END $$;

-- Wheel: joined Entries and Spins go; manual Entries stay and come back.
DO $$
DECLARE
  v_session uuid := pg_temp.make_wheel();
  v_entry uuid;
BEGIN
  PERFORM pg_temp.join_as(v_session, 'Joiner');
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.add_wheel_entries(v_session, ARRAY['M1', 'M2']);
  SELECT id INTO v_entry FROM public.wheel_entries WHERE session_id = v_session AND label = 'M2';
  PERFORM public.remove_wheel_entry(v_entry);
  PERFORM public.spin_wheel(v_session);

  PERFORM public.clear_session_responses(v_session);

  IF EXISTS (SELECT 1 FROM public.wheel_spins WHERE session_id = v_session) THEN
    RAISE EXCEPTION 'spins survived the clear';
  END IF;
  IF pg_temp.active_labels(v_session) <> ARRAY['M1', 'M2'] THEN
    RAISE EXCEPTION 'wheel entries wrong after clear: %', pg_temp.active_labels(v_session);
  END IF;
  IF EXISTS (SELECT 1 FROM public.wheel_entries WHERE session_id = v_session AND kind = 'joined') THEN
    RAISE EXCEPTION 'joined entries survived the clear';
  END IF;
END $$;

-- Comments: participants and comments go, the question stays.
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_question uuid := gen_random_uuid();
  v_token text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, v_owner || '@test.local');
  INSERT INTO public.sessions (id, owner_id, title, slug, session_type, participation_mode)
  VALUES (v_session, v_owner, 'Scenario comments', 'scn-' || v_session, 'comments', 'identified');
  INSERT INTO public.questions (id, session_id, text, order_index) VALUES (v_question, v_session, 'Q', 0);
  v_token := pg_temp.join_as(v_session, 'Cara');
  PERFORM public.submit_comment(v_token, v_question, 'hello');

  PERFORM pg_temp.act_as_owner(v_session);
  IF (public.get_clearable_counts(v_session)->>'comments')::int <> 1 THEN
    RAISE EXCEPTION 'comment count wrong';
  END IF;
  PERFORM public.clear_session_responses(v_session);

  IF EXISTS (SELECT 1 FROM public.comments WHERE question_id = v_question)
     OR EXISTS (SELECT 1 FROM public.participants WHERE session_id = v_session) THEN
    RAISE EXCEPTION 'comments or participants survived the clear';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.questions WHERE id = v_question) THEN
    RAISE EXCEPTION 'comments question was deleted';
  END IF;
END $$;

-- Authorization and scope: strangers and treasure hunts are refused.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(1);
  v_hunt uuid := gen_random_uuid();
  v_owner uuid;
  v_err text;
BEGIN
  PERFORM pg_temp.act_as_stranger();
  v_err := pg_temp.error_of(format('SELECT public.clear_session_responses(%L)', v_session));
  IF v_err IS DISTINCT FROM 'Not authorized' THEN RAISE EXCEPTION 'stranger cleared: %', v_err; END IF;
  v_err := pg_temp.error_of(format('SELECT public.get_clearable_counts(%L)', v_session));
  IF v_err IS DISTINCT FROM 'Not authorized' THEN RAISE EXCEPTION 'stranger read counts: %', v_err; END IF;

  SELECT owner_id INTO v_owner FROM public.sessions WHERE id = v_session;
  INSERT INTO public.sessions (id, owner_id, title, slug, session_type, participation_mode)
  VALUES (v_hunt, v_owner, 'Hunt', 'scn-' || v_hunt, 'treasure_hunt', 'anonymous');
  PERFORM pg_temp.act_as_owner(v_hunt);
  v_err := pg_temp.error_of(format('SELECT public.clear_session_responses(%L)', v_hunt));
  IF v_err IS NULL THEN RAISE EXCEPTION 'a treasure hunt was cleared'; END IF;
END $$;

ROLLBACK;
