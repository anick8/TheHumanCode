-- Ticket: host removal. The owner can kick a Participant (their answers
-- cascade, the Leaderboard drops them) and delete one Comment; no one else can.
\ir ../helpers.sql
BEGIN;

-- Kicking a quiz Participant.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(1);
  v_question uuid := pg_temp.question_at(v_session, 0);
  v_keep text := pg_temp.join_as(v_session, 'Keeper');
  v_kick text := pg_temp.join_as(v_session, 'Kicked');
  v_kick_id uuid;
BEGIN
  PERFORM pg_temp.open_question(v_session, 0, 20, 0);
  PERFORM public.submit_identified_vote(v_kick, v_question, pg_temp.option_of(v_question, 0));
  SELECT id INTO v_kick_id FROM public.participants WHERE join_token = v_kick;

  -- A stranger (no matching auth.uid) cannot remove anyone.
  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  BEGIN
    PERFORM public.remove_participant(v_kick_id);
    RAISE EXCEPTION 'a non-owner removed a participant';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Participant not found' THEN RAISE; END IF;
  END;

  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.remove_participant(v_kick_id);

  IF public.participant_exists(v_kick) THEN RAISE EXCEPTION 'kicked token still exists'; END IF;
  IF NOT public.participant_exists(v_keep) THEN RAISE EXCEPTION 'the other participant was removed'; END IF;
  IF EXISTS (SELECT 1 FROM public.votes WHERE participant_id = v_kick_id) THEN
    RAISE EXCEPTION 'the kicked participant''s answer was not removed';
  END IF;
  IF (SELECT count(*) FROM public.get_leaderboard(v_session)) <> 1 THEN
    RAISE EXCEPTION 'leaderboard still lists the kicked participant';
  END IF;

  -- They may rejoin while entries are open.
  PERFORM pg_temp.join_as(v_session, 'Kicked');
END $$;

-- A poll's votes are anonymous: there is nobody to remove.
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_participant uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, v_owner || '@test.local');
  INSERT INTO public.sessions (id, owner_id, title, slug, session_type, participation_mode)
  VALUES (v_session, v_owner, 'Scenario poll', 'scn-' || v_session, 'poll', 'anonymous');
  INSERT INTO public.participants (id, session_id, name, join_token)
  VALUES (v_participant, v_session, 'Odd', 'tok-' || v_participant);

  PERFORM pg_temp.act_as_owner(v_session);
  BEGIN
    PERFORM public.remove_participant(v_participant);
    RAISE EXCEPTION 'a participant was removed from a poll';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Participants can only be removed%' THEN RAISE; END IF;
  END;
END $$;

-- Deleting a single Comment.
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
  v_question uuid := gen_random_uuid();
  v_token text := 'tok-' || gen_random_uuid();
  v_participant uuid;
  v_a uuid;
  v_b uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, v_owner || '@test.local');
  INSERT INTO public.sessions (id, owner_id, title, slug, session_type, participation_mode)
  VALUES (v_session, v_owner, 'Scenario comments', 'scn-' || v_session, 'comments', 'identified');
  INSERT INTO public.questions (id, session_id, text, order_index) VALUES (v_question, v_session, 'Img', 0);
  PERFORM public.join_session(v_session, 'Commenter', NULL, v_token);
  SELECT id INTO v_participant FROM public.participants WHERE join_token = v_token;

  SELECT comment_id INTO v_a FROM public.submit_comment(v_token, v_question, 'keep me');
  SELECT comment_id INTO v_b FROM public.submit_comment(v_token, v_question, 'delete me');

  PERFORM set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  BEGIN
    PERFORM public.delete_comment(v_b);
    RAISE EXCEPTION 'a non-owner deleted a comment';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Comment not found' THEN RAISE; END IF;
  END;

  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM public.delete_comment(v_b);

  IF EXISTS (SELECT 1 FROM public.comments WHERE id = v_b) THEN RAISE EXCEPTION 'comment not deleted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.comments WHERE id = v_a) THEN RAISE EXCEPTION 'wrong comment deleted'; END IF;
  IF EXISTS (SELECT 1 FROM public.get_own_comments(v_token, v_question) WHERE comment_id = v_b) THEN
    RAISE EXCEPTION 'author still sees the deleted comment';
  END IF;
END $$;

ROLLBACK;
