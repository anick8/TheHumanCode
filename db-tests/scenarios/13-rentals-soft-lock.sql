-- Ticket: Rentals soft lock. A lapsed owner (expired past grace, or revoked)
-- keeps read access to their own Sessions and results but every write,
-- presenter RPC and attendee path is refused. An owner inside the grace
-- counts as active. Attendees see a neutral "closed" refusal.
\ir ../helpers.sql
BEGIN;

-- Owner read side survives a lapse; write side does not.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(2);
  v_token text;
  v_q uuid;
  v_n integer;
  v_err text;
  v_title text;
BEGIN
  v_token := pg_temp.join_as(v_session, 'Ann');
  PERFORM pg_temp.open_question(v_session, 0, 60, 5);
  v_q := pg_temp.question_at(v_session, 0);
  PERFORM pg_temp.lock_at(v_token, v_q, 0, 1000);
  -- Inactive, so only the owner policies can expose it.
  UPDATE public.sessions SET is_active = false WHERE id = v_session;
  PERFORM pg_temp.set_owner_state(v_session, 'expired');

  PERFORM pg_temp.act_as_owner(v_session);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_n FROM public.sessions WHERE id = v_session;
  IF v_n <> 1 THEN RAISE EXCEPTION 'expired owner cannot read own session'; END IF;
  SELECT count(*) INTO v_n FROM public.questions WHERE session_id = v_session;
  IF v_n <> 2 THEN RAISE EXCEPTION 'expired owner reads % questions', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.options WHERE question_id = v_q;
  IF v_n <> 2 THEN RAISE EXCEPTION 'expired owner reads % options', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.question_keys WHERE question_id = v_q;
  IF v_n <> 1 THEN RAISE EXCEPTION 'expired owner cannot read answer keys'; END IF;
  SELECT count(*) INTO v_n FROM public.votes WHERE question_id = v_q;
  IF v_n <> 1 THEN RAISE EXCEPTION 'expired owner cannot read votes'; END IF;
  SELECT count(*) INTO v_n FROM public.participants WHERE session_id = v_session;
  IF v_n <> 1 THEN RAISE EXCEPTION 'expired owner cannot read participants'; END IF;

  -- Writes: RLS filters UPDATE/DELETE to zero rows and rejects INSERT.
  UPDATE public.sessions SET title = 'hacked' WHERE id = v_session;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'expired owner updated a session'; END IF;
  UPDATE public.questions SET text = 'hacked' WHERE id = v_q;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'expired owner updated a question'; END IF;
  UPDATE public.options SET text = 'hacked' WHERE question_id = v_q;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'expired owner updated options'; END IF;
  UPDATE public.question_keys SET option_id = pg_temp.option_of(v_q, 1) WHERE question_id = v_q;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'expired owner changed an answer key'; END IF;
  DELETE FROM public.questions WHERE id = v_q;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'expired owner deleted a question'; END IF;
  DELETE FROM public.sessions WHERE id = v_session;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'expired owner deleted a session'; END IF;
  v_err := pg_temp.error_of(format(
    'INSERT INTO public.sessions (owner_id, title, slug) VALUES (%L, ''x'', ''x-%s'')',
    auth.uid(), gen_random_uuid()));
  IF v_err IS NULL THEN RAISE EXCEPTION 'expired owner created a session'; END IF;
  v_err := pg_temp.error_of(format(
    'INSERT INTO public.questions (session_id, text, order_index) VALUES (%L, ''x'', 9)', v_session));
  IF v_err IS NULL THEN RAISE EXCEPTION 'expired owner added a question'; END IF;
  v_err := pg_temp.error_of(format(
    'INSERT INTO public.options (question_id, text, order_index) VALUES (%L, ''x'', 9)', v_q));
  IF v_err IS NULL THEN RAISE EXCEPTION 'expired owner added an option'; END IF;

  RESET ROLE;
  SELECT title INTO v_title FROM public.sessions WHERE id = v_session;
  IF v_title <> 'Scenario quiz' THEN RAISE EXCEPTION 'title changed to %', v_title; END IF;
END $$;

-- Inside the grace the owner can still write (control); a revoked one reads
-- but cannot write.
DO $$
DECLARE
  v_session uuid := pg_temp.make_quiz(1);
  v_n integer;
BEGIN
  PERFORM pg_temp.act_as_owner(v_session);
  PERFORM pg_temp.set_owner_state(v_session, 'grace');
  SET LOCAL ROLE authenticated;
  UPDATE public.sessions SET title = 'in grace' WHERE id = v_session;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'owner inside grace could not write'; END IF;
  UPDATE public.questions SET text = 'in grace' WHERE session_id = v_session;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'owner inside grace could not edit questions'; END IF;
  RESET ROLE;

  PERFORM pg_temp.set_owner_state(v_session, 'revoked');
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.questions WHERE session_id = v_session;
  IF v_n <> 1 THEN RAISE EXCEPTION 'revoked owner cannot read questions'; END IF;
  UPDATE public.sessions SET title = 'revoked' WHERE id = v_session;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'revoked owner wrote a session'; END IF;
  RESET ROLE;
END $$;

-- Presenter and owner RPCs stay Organizer-only.
DO $$
DECLARE
  v_quiz uuid := pg_temp.make_quiz(1);
  v_wheel uuid := pg_temp.make_wheel();
  v_token text;
  v_entry uuid;
  v_spin uuid;
  v_comment uuid;
  v_participant uuid;
  v_err text;
BEGIN
  -- Set up everything while the owners are active.
  v_token := pg_temp.join_as(v_quiz, 'Ann');
  SELECT id INTO v_participant FROM public.participants WHERE join_token = v_token;
  PERFORM pg_temp.act_as_owner(v_wheel);
  PERFORM public.add_wheel_entries(v_wheel, ARRAY['Bob', 'Cy']);
  SELECT id INTO v_entry FROM public.wheel_entries WHERE session_id = v_wheel LIMIT 1;
  SELECT s.spin_id INTO v_spin FROM public.spin_wheel(v_wheel) s;
  INSERT INTO public.comments (question_id, participant_id, body)
  VALUES (pg_temp.question_at(v_quiz, 0), v_participant, 'hi') RETURNING id INTO v_comment;

  PERFORM pg_temp.set_owner_state(v_quiz, 'expired');
  PERFORM pg_temp.set_owner_state(v_wheel, 'revoked');

  PERFORM pg_temp.act_as_owner(v_quiz);
  v_err := pg_temp.error_of(format('SELECT public.reveal_quiz_question(%L)', v_quiz));
  IF v_err IS DISTINCT FROM 'Not authorized' THEN RAISE EXCEPTION 'reveal: %', v_err; END IF;
  v_err := pg_temp.error_of(format('SELECT public.remove_participant(%L)', v_participant));
  IF v_err IS DISTINCT FROM 'Not authorized' THEN RAISE EXCEPTION 'remove_participant: %', v_err; END IF;
  v_err := pg_temp.error_of(format('SELECT public.delete_comment(%L)', v_comment));
  IF v_err IS DISTINCT FROM 'Not authorized' THEN RAISE EXCEPTION 'delete_comment: %', v_err; END IF;
  v_err := pg_temp.error_of(format('SELECT public.get_clearable_counts(%L)', v_quiz));
  IF v_err IS DISTINCT FROM 'Not authorized' THEN RAISE EXCEPTION 'get_clearable_counts: %', v_err; END IF;
  v_err := pg_temp.error_of(format('SELECT public.clear_session_responses(%L)', v_quiz));
  IF v_err IS DISTINCT FROM 'Not authorized' THEN RAISE EXCEPTION 'clear_session_responses: %', v_err; END IF;

  PERFORM pg_temp.act_as_owner(v_wheel);
  v_err := pg_temp.error_of(format('SELECT public.add_wheel_entries(%L, ARRAY[''Eve''])', v_wheel));
  IF v_err IS DISTINCT FROM 'Not authorized' THEN RAISE EXCEPTION 'add_wheel_entries: %', v_err; END IF;
  v_err := pg_temp.error_of(format('SELECT public.remove_wheel_entry(%L)', v_entry));
  IF v_err IS DISTINCT FROM 'Not authorized' THEN RAISE EXCEPTION 'remove_wheel_entry: %', v_err; END IF;
  v_err := pg_temp.error_of(format('SELECT public.restore_wheel_entry(%L)', v_entry));
  IF v_err IS DISTINCT FROM 'Not authorized' THEN RAISE EXCEPTION 'restore_wheel_entry: %', v_err; END IF;
  v_err := pg_temp.error_of(format('SELECT public.spin_wheel(%L)', v_wheel));
  IF v_err IS DISTINCT FROM 'Not authorized' THEN RAISE EXCEPTION 'spin_wheel: %', v_err; END IF;
  v_err := pg_temp.error_of(format('SELECT public.resolve_wheel_pick(%L, true)', v_spin));
  IF v_err IS DISTINCT FROM 'Not authorized' THEN RAISE EXCEPTION 'resolve_wheel_pick: %', v_err; END IF;
  v_err := pg_temp.error_of(format('SELECT public.reset_wheel(%L)', v_wheel));
  IF v_err IS DISTINCT FROM 'Not authorized' THEN RAISE EXCEPTION 'reset_wheel: %', v_err; END IF;

  -- The wheel's Entries and Spins are still readable by the lapsed owner.
  SET LOCAL ROLE authenticated;
  IF (SELECT count(*) FROM public.wheel_entries WHERE session_id = v_wheel) < 1 THEN
    RAISE EXCEPTION 'lapsed owner cannot read wheel Entries';
  END IF;
  IF (SELECT count(*) FROM public.wheel_spins WHERE session_id = v_wheel) <> 1 THEN
    RAISE EXCEPTION 'lapsed owner cannot read wheel Spins';
  END IF;
  RESET ROLE;

  -- Back inside an active Grant the same calls work again.
  PERFORM pg_temp.set_owner_state(v_wheel, 'grace');
  PERFORM public.add_wheel_entries(v_wheel, ARRAY['Eve']);
END $$;

-- Attendees: refused on a lapsed owner's session, fine inside the grace.
DO $$
DECLARE
  v_quiz uuid := pg_temp.make_quiz(1);
  v_token text;
  v_q uuid;
  v_err text;
BEGIN
  PERFORM pg_temp.set_owner_state(v_quiz, 'grace');
  v_token := pg_temp.join_as(v_quiz, 'Ann');
  PERFORM pg_temp.open_question(v_quiz, 0, 60, 5);
  v_q := pg_temp.question_at(v_quiz, 0);
  IF NOT public.session_owner_has_access(v_quiz) THEN
    RAISE EXCEPTION 'owner inside grace should have access';
  END IF;
  PERFORM public.start_scored_session(v_token);
  PERFORM pg_temp.lock_at(v_token, v_q, 0, 1000);

  PERFORM pg_temp.set_owner_state(v_quiz, 'expired');
  IF public.session_owner_has_access(v_quiz) THEN
    RAISE EXCEPTION 'expired owner should not have access';
  END IF;
  v_err := pg_temp.error_of(format('SELECT public.join_session(%L, ''Bob'', NULL, ''tok-late'')', v_quiz));
  IF v_err IS DISTINCT FROM 'This session is closed' THEN RAISE EXCEPTION 'join: %', v_err; END IF;
  v_err := pg_temp.error_of(format('SELECT public.submit_identified_vote(%L, %L, %L)',
                                   v_token, v_q, pg_temp.option_of(v_q, 0)));
  IF v_err IS DISTINCT FROM 'This session is closed' THEN RAISE EXCEPTION 'vote: %', v_err; END IF;
  v_err := pg_temp.error_of(format('SELECT public.start_scored_session(%L)', v_token));
  IF v_err IS DISTINCT FROM 'This session is closed' THEN RAISE EXCEPTION 'start: %', v_err; END IF;

  -- Revoked: no grace.
  PERFORM pg_temp.set_owner_state(v_quiz, 'revoked');
  IF public.session_owner_has_access(v_quiz) THEN RAISE EXCEPTION 'revoked owner has access'; END IF;
  -- Renewed: attendees are back.
  PERFORM pg_temp.set_owner_state(v_quiz, 'active');
  IF NOT public.session_owner_has_access(v_quiz) THEN RAISE EXCEPTION 'renewed owner lacks access'; END IF;
  PERFORM pg_temp.join_as(v_quiz, 'Bob');
END $$;

-- Anonymous votes, comments, clues and the wheel phone.
DO $$
DECLARE
  v_owner uuid := pg_temp.make_user('owner');
  v_poll uuid := gen_random_uuid();
  v_comments uuid := gen_random_uuid();
  v_hunt uuid := gen_random_uuid();
  v_pq uuid := gen_random_uuid();
  v_po uuid := gen_random_uuid();
  v_cq uuid := gen_random_uuid();
  v_hq uuid := gen_random_uuid();
  v_tok text;
  v_wheel uuid := pg_temp.make_wheel();
  v_wtok text;
  v_status text;
  v_err text;
  v_n integer;
BEGIN
  PERFORM pg_temp.grant_to(v_owner, now() - interval '5 days', now() + interval '1 day');
  INSERT INTO public.sessions (id, owner_id, title, slug, session_type, participation_mode, is_scored, is_active)
  VALUES (v_poll, v_owner, 'P', 'p-' || v_poll, 'poll', 'anonymous', false, true),
         (v_comments, v_owner, 'C', 'c-' || v_comments, 'comments', 'identified', false, true),
         (v_hunt, v_owner, 'H', 'h-' || v_hunt, 'treasure_hunt', 'anonymous', false, false);
  INSERT INTO public.questions (id, session_id, text, order_index) VALUES
    (v_pq, v_poll, 'Q', 0), (v_cq, v_comments, 'img', 0);
  INSERT INTO public.questions (id, session_id, text, order_index, clue_token)
  VALUES (v_hq, v_hunt, 'Look up', 0, 'clue-' || v_hunt);
  INSERT INTO public.options (id, question_id, text, order_index) VALUES (v_po, v_pq, 'a', 0);
  v_wtok := pg_temp.join_as(v_wheel, 'Ann');
  PERFORM pg_temp.act_as_owner(v_wheel);
  PERFORM public.add_wheel_entries(v_wheel, ARRAY['Bob']);
  PERFORM public.spin_wheel(v_wheel);
  UPDATE public.wheel_spins SET created_at = now() - interval '1 minute' WHERE session_id = v_wheel;
  v_tok := pg_temp.join_as(v_comments, 'Ann');

  -- Active owner: everything works.
  PERFORM public.submit_anonymous_vote('anon-1', v_pq, v_po);
  SELECT c.status INTO v_status FROM public.get_clue('clue-' || v_hunt) c;
  IF v_status <> 'not_live' THEN RAISE EXCEPTION 'inactive hunt should read not_live, got %', v_status; END IF;
  UPDATE public.sessions SET is_active = true WHERE id = v_hunt;
  SELECT c.status INTO v_status FROM public.get_clue('clue-' || v_hunt) c;
  IF v_status <> 'live' THEN RAISE EXCEPTION 'active hunt should read live, got %', v_status; END IF;
  SELECT count(*) INTO v_n FROM public.get_wheel_latest_pick(v_wtok);
  IF v_n <> 1 THEN RAISE EXCEPTION 'wheel phone should see the pick, got % rows', v_n; END IF;

  -- Lapse every owner.
  PERFORM pg_temp.grant_to(v_owner, now() - interval '5 days', now() - interval '7 hours');
  PERFORM pg_temp.set_owner_state(v_wheel, 'expired');

  v_err := pg_temp.error_of(format('SELECT public.submit_anonymous_vote(%L, %L, %L)', 'anon-2', v_pq, v_po));
  IF v_err IS DISTINCT FROM 'This session is closed' THEN RAISE EXCEPTION 'anon vote: %', v_err; END IF;
  SELECT c.status INTO v_status FROM public.get_clue('clue-' || v_hunt) c;
  IF v_status <> 'closed' THEN RAISE EXCEPTION 'lapsed hunt should read closed, got %', v_status; END IF;
  SELECT count(*) INTO v_n FROM public.get_wheel_latest_pick(v_wtok);
  IF v_n <> 0 THEN RAISE EXCEPTION 'wheel phone still sees picks of a lapsed owner'; END IF;

  v_err := pg_temp.error_of(format('SELECT public.submit_comment(%L, %L, ''hello'')', v_tok, v_cq));
  IF v_err IS DISTINCT FROM 'This session is closed' THEN RAISE EXCEPTION 'comment: %', v_err; END IF;
  PERFORM pg_temp.grant_to(v_owner, now() - interval '5 days', now() - interval '1 hour');
  PERFORM public.submit_comment(v_tok, v_cq, 'hello');

  -- Seeded sample sessions have no owner and stay open.
  IF NOT public.session_owner_has_access((SELECT id FROM public.sessions WHERE owner_id IS NULL LIMIT 1)) THEN
    RAISE EXCEPTION 'ownerless sample session should stay open';
  END IF;
END $$;

ROLLBACK;
