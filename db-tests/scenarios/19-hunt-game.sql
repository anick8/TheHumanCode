-- Ticket: Treasure Hunt game (database seam). Players join and are approved by
-- the organizer, the hunt clock gates scans and picks, the server locks the
-- first pick, the board ranks, reset clears the run. Hunts that are not games
-- keep today's anonymous behaviour.
\ir ../helpers.sql
BEGIN;

-- An active treasure hunt with p_clues clues; clue 0 has two choices. Returns the session id.
-- Clue tokens are 'c<i>-<session id>'.
CREATE FUNCTION pg_temp.make_hunt(p_game boolean, p_clues integer DEFAULT 3) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_session uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, v_owner || '@test.local');
  PERFORM pg_temp.grant_to(v_owner, now() - interval '1 day', NULL);
  INSERT INTO public.sessions (id, owner_id, title, slug, session_type, participation_mode, is_scored, is_active, hunt_game)
  VALUES (v_session, v_owner, 'Hunt', 'hunt-' || v_session, 'treasure_hunt', 'anonymous', false, true, p_game);
  FOR i IN 0..p_clues - 1 LOOP
    INSERT INTO public.questions (session_id, text, order_index, clue_token, clue_choices)
    VALUES (v_session, 'Clue ' || i, i, 'c' || i || '-' || v_session,
            CASE WHEN i = 0 THEN '[{"label":"L","reveal":"left"},{"label":"R","reveal":"right"}]'::jsonb END);
  END LOOP;
  RETURN v_session;
END $$;

CREATE FUNCTION pg_temp.pid(p_token text) RETURNS uuid
LANGUAGE sql AS $$ SELECT id FROM public.participants WHERE join_token = p_token $$;

-- Joins through the RPC and (optionally) approves as the owner.
CREATE FUNCTION pg_temp.hunt_join(p_session uuid, p_name text, p_approve boolean DEFAULT true) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_token text := 'tok-' || gen_random_uuid();
BEGIN
  PERFORM public.join_hunt(p_session, p_name, v_token);
  IF p_approve THEN
    PERFORM pg_temp.act_as_owner(p_session);
    PERFORM public.set_hunt_approval(pg_temp.pid(v_token), 'approved');
  END IF;
  RETURN v_token;
END $$;

CREATE FUNCTION pg_temp.scans_of(p_token text) RETURNS integer
LANGUAGE sql AS $$ SELECT count(*)::int FROM public.hunt_scans WHERE participant_id = pg_temp.pid(p_token) $$;

-- 1. A join creates a pending Participant; a scan while pending records nothing.
DO $$
DECLARE
  v_s uuid := pg_temp.make_hunt(true);
  v_tok text := 'tok-' || gen_random_uuid();
  v_status text; v_approval text;
BEGIN
  SELECT c.status INTO v_status FROM public.get_clue('c1-' || v_s, v_tok) c;
  IF v_status <> 'join_required' THEN RAISE EXCEPTION 'unknown phone: %', v_status; END IF;

  PERFORM public.join_hunt(v_s, '  Ada  ', v_tok);
  SELECT approval_status INTO v_approval FROM public.participants WHERE join_token = v_tok;
  IF v_approval <> 'pending' THEN RAISE EXCEPTION 'join status: %', v_approval; END IF;
  IF (SELECT name FROM public.participants WHERE join_token = v_tok) <> 'Ada' THEN
    RAISE EXCEPTION 'name not trimmed';
  END IF;
  IF pg_temp.error_of(format('SELECT public.join_hunt(%L, %L, %L)', v_s, '', 'tok-x')) IS NULL THEN
    RAISE EXCEPTION 'empty name accepted';
  END IF;
  IF pg_temp.error_of(format('SELECT public.join_hunt(%L, %L, %L)', v_s, repeat('x', 41), 'tok-y')) IS NULL THEN
    RAISE EXCEPTION '41-char name accepted';
  END IF;

  -- Rejoining with the same token returns the same Participant.
  PERFORM public.join_hunt(v_s, 'Ada', v_tok);
  IF (SELECT count(*) FROM public.participants WHERE session_id = v_s) <> 1 THEN
    RAISE EXCEPTION 'rejoin created a second participant';
  END IF;

  SELECT c.status INTO v_status FROM public.get_clue('c1-' || v_s, v_tok) c;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'pending scan: %', v_status; END IF;
  IF pg_temp.scans_of(v_tok) <> 0 THEN RAISE EXCEPTION 'pending scan recorded'; END IF;
  SELECT s.approval_status INTO v_approval FROM public.get_hunt_status(v_s, v_tok) s;
  IF v_approval <> 'pending' THEN RAISE EXCEPTION 'status rpc: %', v_approval; END IF;
END $$;

-- 2. Approved but before the start: not_started, nothing recorded, no message.
DO $$
DECLARE
  v_s uuid := pg_temp.make_hunt(true);
  v_tok text := pg_temp.hunt_join(v_s, 'Ada');
  v_status text; v_msg text; v_state text;
BEGIN
  SELECT c.status, c.clue_message INTO v_status, v_msg FROM public.get_clue('c1-' || v_s, v_tok) c;
  IF v_status <> 'not_started' OR v_msg IS NOT NULL THEN
    RAISE EXCEPTION 'before start: % / %', v_status, v_msg;
  END IF;
  IF pg_temp.scans_of(v_tok) <> 0 THEN RAISE EXCEPTION 'scan recorded before start'; END IF;
  SELECT s.hunt_state INTO v_state FROM public.get_hunt_status(v_s, v_tok) s;
  IF v_state <> 'not_started' THEN RAISE EXCEPTION 'state: %', v_state; END IF;
END $$;

-- 3. Running: the first scan is recorded; a rescan keeps the original time.
DO $$
DECLARE
  v_s uuid := pg_temp.make_hunt(true);
  v_tok text := pg_temp.hunt_join(v_s, 'Ada');
  v_status text; v_msg text; v_first timestamptz; v_found integer; v_total integer;
BEGIN
  PERFORM pg_temp.act_as_owner(v_s);
  PERFORM public.start_hunt(v_s, NULL);

  SELECT c.status, c.clue_message INTO v_status, v_msg FROM public.get_clue('c1-' || v_s, v_tok) c;
  IF v_status <> 'live' OR v_msg <> 'Clue 1' THEN RAISE EXCEPTION 'running: % / %', v_status, v_msg; END IF;
  IF pg_temp.scans_of(v_tok) <> 1 THEN RAISE EXCEPTION 'scan not recorded'; END IF;

  UPDATE public.hunt_scans SET first_scanned_at = now() - interval '5 minutes'
   WHERE participant_id = pg_temp.pid(v_tok);
  SELECT first_scanned_at INTO v_first FROM public.hunt_scans WHERE participant_id = pg_temp.pid(v_tok);

  PERFORM public.get_clue('c1-' || v_s, v_tok);
  IF (SELECT first_scanned_at FROM public.hunt_scans WHERE participant_id = pg_temp.pid(v_tok)) <> v_first THEN
    RAISE EXCEPTION 'rescan changed the first-found time';
  END IF;
  IF pg_temp.scans_of(v_tok) <> 1 THEN RAISE EXCEPTION 'rescan added a row'; END IF;

  PERFORM public.get_clue('c2-' || v_s, v_tok);
  SELECT s.clues_found, s.total_clues INTO v_found, v_total FROM public.get_hunt_status(v_s, v_tok) s;
  IF v_found <> 2 OR v_total <> 3 THEN RAISE EXCEPTION 'progress: % of %', v_found, v_total; END IF;
END $$;

-- 4. The first pick is stored; a second pick returns the original as locked.
DO $$
DECLARE
  v_s uuid := pg_temp.make_hunt(true);
  v_tok text := pg_temp.hunt_join(v_s, 'Ada');
  v_status text; v_reveal text; v_idx integer; v_locked integer; v_locked_reveal text;
BEGIN
  PERFORM pg_temp.act_as_owner(v_s);
  PERFORM public.start_hunt(v_s, NULL);

  -- A pick needs a recorded scan first.
  SELECT r.status INTO v_status FROM public.reveal_clue_choice('c0-' || v_s, 0, v_tok) r;
  IF v_status = 'live' THEN RAISE EXCEPTION 'pick accepted without a scan'; END IF;

  PERFORM public.get_clue('c0-' || v_s, v_tok);
  SELECT r.status, r.reveal, r.picked_index INTO v_status, v_reveal, v_idx
    FROM public.reveal_clue_choice('c0-' || v_s, 1, v_tok) r;
  IF v_status <> 'live' OR v_reveal <> 'right' OR v_idx <> 1 THEN
    RAISE EXCEPTION 'first pick: % / % / %', v_status, v_reveal, v_idx;
  END IF;

  SELECT r.status, r.reveal, r.picked_index INTO v_status, v_reveal, v_idx
    FROM public.reveal_clue_choice('c0-' || v_s, 0, v_tok) r;
  IF v_status <> 'locked' OR v_reveal <> 'right' OR v_idx <> 1 THEN
    RAISE EXCEPTION 'second pick: % / % / %', v_status, v_reveal, v_idx;
  END IF;

  -- get_clue shows the lock again.
  SELECT c.locked_index, c.locked_reveal INTO v_locked, v_locked_reveal FROM public.get_clue('c0-' || v_s, v_tok) c;
  IF v_locked <> 1 OR v_locked_reveal <> 'right' THEN
    RAISE EXCEPTION 'get_clue lock: % / %', v_locked, v_locked_reveal;
  END IF;
END $$;

-- 5. Joining after the start is refused; approving someone pending still works.
DO $$
DECLARE
  v_s uuid := pg_temp.make_hunt(true);
  v_pending text := pg_temp.hunt_join(v_s, 'Slow', false);
  v_status text;
BEGIN
  PERFORM pg_temp.act_as_owner(v_s);
  PERFORM public.start_hunt(v_s, NULL);

  IF pg_temp.error_of(format('SELECT public.join_hunt(%L, %L, %L)', v_s, 'Late', 'tok-late')) IS NULL THEN
    RAISE EXCEPTION 'join accepted after the start';
  END IF;

  PERFORM public.set_hunt_approval(pg_temp.pid(v_pending), 'approved');
  SELECT c.status INTO v_status FROM public.get_clue('c1-' || v_s, v_pending) c;
  IF v_status <> 'live' THEN RAISE EXCEPTION 'late-approved scan: %', v_status; END IF;

  -- A known token may still ask for its Participant after the start.
  PERFORM public.join_hunt(v_s, 'Slow', v_pending);
END $$;

-- 5b. Close entries blocks new joins before the start.
DO $$
DECLARE v_s uuid := pg_temp.make_hunt(true);
BEGIN
  UPDATE public.sessions SET entries_closed = true WHERE id = v_s;
  IF pg_temp.error_of(format('SELECT public.join_hunt(%L, %L, %L)', v_s, 'Ada', 'tok-c')) IS NULL THEN
    RAISE EXCEPTION 'join accepted with entries closed';
  END IF;
END $$;

-- 6. Past the end time, or after stop: over, nothing recorded, picks refused.
DO $$
DECLARE
  v_s uuid := pg_temp.make_hunt(true);
  v_tok text := pg_temp.hunt_join(v_s, 'Ada');
  v_status text; v_pick text;
BEGIN
  PERFORM pg_temp.act_as_owner(v_s);
  PERFORM public.start_hunt(v_s, 10);
  IF (SELECT hunt_ends_at FROM public.sessions WHERE id = v_s) IS NULL THEN RAISE EXCEPTION 'no end time'; END IF;
  PERFORM public.get_clue('c0-' || v_s, v_tok);

  UPDATE public.sessions SET hunt_started_at = now() - interval '20 minutes',
                             hunt_ends_at = now() - interval '10 minutes' WHERE id = v_s;
  SELECT c.status INTO v_status FROM public.get_clue('c1-' || v_s, v_tok) c;
  IF v_status <> 'over' THEN RAISE EXCEPTION 'past end: %', v_status; END IF;
  IF pg_temp.scans_of(v_tok) <> 1 THEN RAISE EXCEPTION 'scan recorded after the end'; END IF;
  SELECT r.status INTO v_pick FROM public.reveal_clue_choice('c0-' || v_s, 0, v_tok) r;
  IF v_pick = 'live' THEN RAISE EXCEPTION 'pick accepted after the end'; END IF;
END $$;

DO $$
DECLARE
  v_s uuid := pg_temp.make_hunt(true);
  v_tok text := pg_temp.hunt_join(v_s, 'Bo');
  v_status text;
BEGIN
  PERFORM pg_temp.act_as_owner(v_s);
  PERFORM public.start_hunt(v_s, NULL);
  PERFORM public.stop_hunt(v_s);
  SELECT c.status INTO v_status FROM public.get_clue('c1-' || v_s, v_tok) c;
  IF v_status <> 'over' THEN RAISE EXCEPTION 'after stop: %', v_status; END IF;
  IF pg_temp.scans_of(v_tok) <> 0 THEN RAISE EXCEPTION 'scan recorded after stop'; END IF;
  IF (SELECT s.hunt_state FROM public.get_hunt_status(v_s, v_tok) s) <> 'over' THEN
    RAISE EXCEPTION 'status not over after stop';
  END IF;
END $$;

-- 7. A rejected or removed token cannot sign up again; its scans give removed.
DO $$
DECLARE
  v_s uuid := pg_temp.make_hunt(true);
  v_rej text := pg_temp.hunt_join(v_s, 'Rejected', false);
  v_rem text := pg_temp.hunt_join(v_s, 'Removed');
  v_status text;
BEGIN
  PERFORM pg_temp.act_as_owner(v_s);
  PERFORM public.set_hunt_approval(pg_temp.pid(v_rej), 'rejected');
  PERFORM public.remove_participant(pg_temp.pid(v_rem));

  PERFORM public.join_hunt(v_s, 'Again', v_rej);
  PERFORM public.join_hunt(v_s, 'Again', v_rem);
  IF (SELECT approval_status FROM public.participants WHERE join_token = v_rej) <> 'rejected'
     OR (SELECT approval_status FROM public.participants WHERE join_token = v_rem) <> 'rejected' THEN
    RAISE EXCEPTION 'a rejoin cleared the decision';
  END IF;

  PERFORM public.start_hunt(v_s, NULL);
  SELECT c.status INTO v_status FROM public.get_clue('c1-' || v_s, v_rej) c;
  IF v_status <> 'removed' THEN RAISE EXCEPTION 'rejected scan: %', v_status; END IF;
  SELECT c.status INTO v_status FROM public.get_clue('c1-' || v_s, v_rem) c;
  IF v_status <> 'removed' THEN RAISE EXCEPTION 'removed scan: %', v_status; END IF;
  IF pg_temp.scans_of(v_rej) + pg_temp.scans_of(v_rem) <> 0 THEN RAISE EXCEPTION 'removed scan recorded'; END IF;
  IF (SELECT s.approval_status FROM public.get_hunt_status(v_s, v_rem) s) <> 'rejected' THEN
    RAISE EXCEPTION 'status rpc for removed';
  END IF;
END $$;

-- 8. The board ranks by clues found desc, then last scan asc, incl. unfinished.
DO $$
DECLARE
  v_s uuid := pg_temp.make_hunt(true, 3);
  v_slow text := pg_temp.hunt_join(v_s, 'Slow');
  v_fast text := pg_temp.hunt_join(v_s, 'Fast');
  v_part text := pg_temp.hunt_join(v_s, 'Partial');
  v_none text := pg_temp.hunt_join(v_s, 'None');
  v_pend text := pg_temp.hunt_join(v_s, 'Pending', false);
  v_names text[];
  v_ranks integer[];
  v_found integer[];
  v_pick_label text;
BEGIN
  PERFORM pg_temp.act_as_owner(v_s);
  PERFORM public.start_hunt(v_s, NULL);
  FOR i IN 0..2 LOOP
    PERFORM public.get_clue('c' || i || '-' || v_s, v_slow);
    PERFORM public.get_clue('c' || i || '-' || v_s, v_fast);
  END LOOP;
  PERFORM public.get_clue('c0-' || v_s, v_part);
  PERFORM public.reveal_clue_choice('c0-' || v_s, 0, v_fast);
  UPDATE public.hunt_scans SET first_scanned_at = now() + interval '9 minutes'
   WHERE participant_id = pg_temp.pid(v_slow);
  UPDATE public.hunt_scans SET first_scanned_at = now() + interval '3 minutes'
   WHERE participant_id = pg_temp.pid(v_fast);

  SELECT array_agg(b.name ORDER BY b.rank, b.name), array_agg(b.rank ORDER BY b.rank, b.name),
         array_agg(b.clues_found ORDER BY b.rank, b.name)
    INTO v_names, v_ranks, v_found
    FROM public.get_hunt_board(v_s) b WHERE b.approval_status = 'approved';
  IF v_names <> ARRAY['Fast', 'Slow', 'Partial', 'None'] OR v_ranks <> ARRAY[1, 2, 3, 4]
     OR v_found <> ARRAY[3, 3, 1, 0] THEN
    RAISE EXCEPTION 'board: % % %', v_names, v_ranks, v_found;
  END IF;

  IF (SELECT count(*) FROM public.get_hunt_board(v_s)) <> 5 THEN RAISE EXCEPTION 'board omits pending'; END IF;
  IF (SELECT b.rank FROM public.get_hunt_board(v_s) b WHERE b.name = 'Pending') IS NOT NULL THEN
    RAISE EXCEPTION 'pending player ranked';
  END IF;

  SELECT s ->> 'picked_label' INTO v_pick_label
    FROM public.get_hunt_board(v_s) b, jsonb_array_elements(b.scans) s
   WHERE b.name = 'Fast' AND (s ->> 'clue_number')::int = 1;
  IF v_pick_label <> 'L' THEN RAISE EXCEPTION 'picked label: %', v_pick_label; END IF;

  -- A player sees their rank once the hunt is over.
  IF (SELECT s.rank FROM public.get_hunt_status(v_s, v_fast) s) IS NOT NULL THEN
    RAISE EXCEPTION 'rank shown while running';
  END IF;
  PERFORM public.stop_hunt(v_s);
  IF (SELECT s.rank FROM public.get_hunt_status(v_s, v_fast) s) <> 1
     OR (SELECT s.rank FROM public.get_hunt_status(v_s, v_none) s) <> 4 THEN
    RAISE EXCEPTION 'player ranks after stop';
  END IF;
END $$;

-- 9. Reset removes Participants and scans and keeps the clue tokens.
DO $$
DECLARE
  v_s uuid := pg_temp.make_hunt(true);
  v_tok text := pg_temp.hunt_join(v_s, 'Ada');
  v_tokens_before text[];
  v_tokens_after text[];
BEGIN
  SELECT array_agg(clue_token ORDER BY order_index) INTO v_tokens_before FROM public.questions WHERE session_id = v_s;
  PERFORM pg_temp.act_as_owner(v_s);
  PERFORM public.start_hunt(v_s, 5);
  PERFORM public.get_clue('c0-' || v_s, v_tok);
  PERFORM public.reset_hunt(v_s);

  IF EXISTS (SELECT 1 FROM public.participants WHERE session_id = v_s) THEN RAISE EXCEPTION 'participants remain'; END IF;
  IF EXISTS (SELECT 1 FROM public.hunt_scans s JOIN public.questions q ON q.id = s.question_id WHERE q.session_id = v_s) THEN
    RAISE EXCEPTION 'scans remain';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sessions WHERE id = v_s
              AND (hunt_started_at IS NOT NULL OR hunt_ends_at IS NOT NULL OR hunt_stopped_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'clock not cleared';
  END IF;
  SELECT array_agg(clue_token ORDER BY order_index) INTO v_tokens_after FROM public.questions WHERE session_id = v_s;
  IF v_tokens_before IS DISTINCT FROM v_tokens_after OR array_length(v_tokens_after, 1) <> 3 THEN
    RAISE EXCEPTION 'clue tokens changed';
  END IF;
  -- The same join token is free to join again.
  PERFORM public.join_hunt(v_s, 'Ada', v_tok);
END $$;

-- 10. A hunt that is not a game keeps today's anonymous behaviour.
DO $$
DECLARE
  v_s uuid := pg_temp.make_hunt(false);
  v_status text; v_msg text; v_reveal text; v_rstatus text; v_locked integer;
BEGIN
  SELECT c.status, c.clue_message, c.locked_index INTO v_status, v_msg, v_locked
    FROM public.get_clue('c0-' || v_s) c;
  IF v_status <> 'live' OR v_msg <> 'Clue 0' OR v_locked IS NOT NULL THEN
    RAISE EXCEPTION 'plain hunt: % / % / %', v_status, v_msg, v_locked;
  END IF;
  SELECT c.status INTO v_status FROM public.get_clue('c0-' || v_s, 'tok-whatever') c;
  IF v_status <> 'live' THEN RAISE EXCEPTION 'plain hunt with token: %', v_status; END IF;
  SELECT r.status, r.reveal INTO v_rstatus, v_reveal FROM public.reveal_clue_choice('c0-' || v_s, 1) r;
  IF v_rstatus <> 'live' OR v_reveal <> 'right' THEN RAISE EXCEPTION 'plain reveal: % / %', v_rstatus, v_reveal; END IF;
  SELECT r.status, r.reveal INTO v_rstatus, v_reveal FROM public.reveal_clue_choice('c0-' || v_s, 0) r;
  IF v_rstatus <> 'live' OR v_reveal <> 'left' THEN RAISE EXCEPTION 'plain re-pick: % / %', v_rstatus, v_reveal; END IF;
  IF EXISTS (SELECT 1 FROM public.hunt_scans h JOIN public.questions q ON q.id = h.question_id WHERE q.session_id = v_s) THEN RAISE EXCEPTION 'plain hunt recorded a scan'; END IF;
  IF pg_temp.error_of(format('SELECT public.join_hunt(%L, %L, %L)', v_s, 'Ada', 'tok-p')) IS NULL THEN
    RAISE EXCEPTION 'joined a hunt that is not a game';
  END IF;
END $$;

-- 10b. Other session types default new participants to approved.
DO $$
DECLARE
  v_quiz uuid := pg_temp.make_quiz(1);
  v_tok text := pg_temp.join_as(v_quiz, 'Quizzer');
BEGIN
  IF (SELECT approval_status FROM public.participants WHERE join_token = v_tok) <> 'approved' THEN
    RAISE EXCEPTION 'quiz participant not approved by default';
  END IF;
END $$;

-- 11. Organizer RPCs are refused for someone who is not the owner.
DO $$
DECLARE
  v_s uuid := pg_temp.make_hunt(true);
  v_tok text := pg_temp.hunt_join(v_s, 'Ada', false);
  v_id uuid := pg_temp.pid(v_tok);
  v_call text;
BEGIN
  PERFORM pg_temp.act_as_stranger();
  FOREACH v_call IN ARRAY ARRAY[
    format('SELECT public.set_hunt_approval(%L, %L)', v_id, 'approved'),
    format('SELECT public.approve_all_hunt_players(%L)', v_s),
    format('SELECT public.start_hunt(%L, NULL)', v_s),
    format('SELECT public.stop_hunt(%L)', v_s),
    format('SELECT public.reset_hunt(%L)', v_s),
    format('SELECT * FROM public.get_hunt_board(%L)', v_s),
    format('SELECT public.remove_participant(%L)', v_id)
  ] LOOP
    IF pg_temp.error_of(v_call) IS NULL THEN RAISE EXCEPTION 'non-owner allowed: %', v_call; END IF;
  END LOOP;

  IF (SELECT approval_status FROM public.participants WHERE id = v_id) <> 'pending' THEN
    RAISE EXCEPTION 'stranger changed a participant';
  END IF;
  IF (SELECT hunt_started_at FROM public.sessions WHERE id = v_s) IS NOT NULL THEN
    RAISE EXCEPTION 'stranger started the hunt';
  END IF;

  -- Approve all, as the owner, approves every pending player.
  PERFORM pg_temp.hunt_join(v_s, 'Bo', false);
  PERFORM pg_temp.act_as_owner(v_s);
  IF public.approve_all_hunt_players(v_s) <> 2 THEN RAISE EXCEPTION 'approve all count'; END IF;
  IF EXISTS (SELECT 1 FROM public.participants WHERE session_id = v_s AND approval_status <> 'approved') THEN
    RAISE EXCEPTION 'approve all left someone';
  END IF;
END $$;

ROLLBACK;
