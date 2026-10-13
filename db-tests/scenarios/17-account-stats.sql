-- Ticket: account_stats() gives an organizer totals, a 12-week series and the
-- busiest sessions for their own sessions only, and is not callable signed out.
\ir ../helpers.sql
BEGIN;

DO $$
DECLARE
  v_me uuid := pg_temp.make_user('stats');
  v_other uuid := pg_temp.make_user('stranger');
  v_poll uuid := gen_random_uuid();
  v_quiz uuid := gen_random_uuid();
  v_theirs uuid := gen_random_uuid();
  v_q_poll uuid := gen_random_uuid();
  v_q_quiz uuid := gen_random_uuid();
  v_q_theirs uuid := gen_random_uuid();
  v_opt_poll uuid := gen_random_uuid();
  v_opt_quiz uuid := gen_random_uuid();
  v_opt_theirs uuid := gen_random_uuid();
  v_part uuid := gen_random_uuid();
  v_stats jsonb;
  v_weeks jsonb;
BEGIN
  PERFORM pg_temp.grant_to(v_me, now() - interval '30 days', NULL);

  INSERT INTO public.sessions (id, owner_id, title, slug, session_type, participation_mode, is_scored)
  VALUES
    (v_poll, v_me, 'My poll', 'st-' || v_poll, 'poll', 'anonymous', false),
    (v_quiz, v_me, 'My quiz', 'st-' || v_quiz, 'quiz', 'identified', true),
    (v_theirs, v_other, 'Not mine', 'st-' || v_theirs, 'poll', 'anonymous', false);

  INSERT INTO public.questions (id, session_id, text, order_index, opened_at)
  VALUES
    (v_q_poll, v_poll, 'P?', 0, now() - interval '1 day'),
    (v_q_quiz, v_quiz, 'Q?', 0, NULL),
    (v_q_theirs, v_theirs, 'T?', 0, now());
  INSERT INTO public.options (id, question_id, text, order_index)
  VALUES (v_opt_poll, v_q_poll, 'a', 0), (v_opt_quiz, v_q_quiz, 'a', 0), (v_opt_theirs, v_q_theirs, 'a', 0);

  -- Two anonymous voters on the poll (this week and 3 weeks ago), one
  -- identified participant on the quiz, and a stranger's vote that must not count.
  INSERT INTO public.votes (option_id, question_id, voter_token, created_at) VALUES
    (v_opt_poll, v_q_poll, 'anon-1', now()),
    (v_opt_poll, v_q_poll, 'anon-2', now() - interval '21 days'),
    (v_opt_theirs, v_q_theirs, 'anon-3', now());
  INSERT INTO public.participants (id, session_id, name, join_token) VALUES (v_part, v_quiz, 'Ada', 'tok-' || v_part);
  INSERT INTO public.votes (option_id, question_id, voter_token, participant_id, created_at)
  VALUES (v_opt_quiz, v_q_quiz, 'tok-' || v_part, v_part, now());

  PERFORM pg_temp.act_as_user(v_me);
  v_stats := public.account_stats();

  IF (v_stats #>> '{totals,sessions}')::int <> 2 THEN RAISE EXCEPTION 'sessions: %', v_stats; END IF;
  IF (v_stats #>> '{totals,by_type,poll}')::int <> 1 OR (v_stats #>> '{totals,by_type,quiz}')::int <> 1 THEN
    RAISE EXCEPTION 'by_type: %', v_stats;
  END IF;
  IF (v_stats #>> '{totals,responses}')::int <> 3 THEN RAISE EXCEPTION 'responses should be 3 (own votes only): %', v_stats; END IF;
  IF (v_stats #>> '{totals,people}')::int <> 3 THEN RAISE EXCEPTION 'people should be 2 anon + 1 participant: %', v_stats; END IF;
  IF (v_stats #>> '{totals,sessions_run}')::int <> 2 THEN RAISE EXCEPTION 'sessions_run: %', v_stats; END IF;

  v_weeks := v_stats -> 'weekly';
  IF jsonb_array_length(v_weeks) <> 12 THEN RAISE EXCEPTION 'expected 12 weeks, got %', jsonb_array_length(v_weeks); END IF;
  IF (SELECT sum((w ->> 'responses')::int) FROM jsonb_array_elements(v_weeks) w) <> 3 THEN
    RAISE EXCEPTION 'weekly should sum to 3: %', v_weeks;
  END IF;
  IF (v_weeks -> 11 ->> 'responses')::int <> 2 THEN RAISE EXCEPTION 'current week should hold 2: %', v_weeks; END IF;
  IF (v_weeks -> 8 ->> 'responses')::int <> 1 THEN RAISE EXCEPTION 'three weeks ago should hold 1: %', v_weeks; END IF;

  IF jsonb_array_length(v_stats -> 'top_sessions') <> 2 THEN RAISE EXCEPTION 'top_sessions: %', v_stats -> 'top_sessions'; END IF;
  IF v_stats #>> '{top_sessions,0,title}' <> 'My poll' THEN RAISE EXCEPTION 'busiest session first: %', v_stats -> 'top_sessions'; END IF;

  -- A stranger with nothing gets zeros and the full 12 weeks.
  PERFORM pg_temp.act_as_user(pg_temp.make_user('empty'));
  v_stats := public.account_stats();
  IF (v_stats #>> '{totals,sessions}')::int <> 0 OR (v_stats #>> '{totals,responses}')::int <> 0 THEN
    RAISE EXCEPTION 'empty account should be zeros: %', v_stats;
  END IF;
  IF jsonb_array_length(v_stats -> 'weekly') <> 12 OR v_stats -> 'top_sessions' <> '[]'::jsonb THEN
    RAISE EXCEPTION 'empty account shape: %', v_stats;
  END IF;

  IF has_function_privilege('anon', 'public.account_stats()', 'execute') THEN
    RAISE EXCEPTION 'account_stats() is executable by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.account_stats()', 'execute') THEN
    RAISE EXCEPTION 'account_stats() is not executable by authenticated';
  END IF;
END $$;

ROLLBACK;
