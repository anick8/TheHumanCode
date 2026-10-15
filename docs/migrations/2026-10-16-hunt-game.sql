-- ============================================================================
-- 38. Treasure Hunt game: join, approval, timed scans, locked picks, board
-- ============================================================================

-- A hunt can be switched into a game. Hunts that are not games (the default
-- here) keep today's anonymous behaviour.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hunt_game boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hunt_started_at timestamptz;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hunt_ends_at timestamptz;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS hunt_stopped_at timestamptz;

-- Approval of a Participant. Defaults to approved so Quiz, Comments and Wheel
-- are unaffected; only join_hunt() creates pending rows.
ALTER TABLE participants ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved';
ALTER TABLE participants DROP CONSTRAINT IF EXISTS participants_approval_status_check;
ALTER TABLE participants ADD CONSTRAINT participants_approval_status_check
  CHECK (approval_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE participants ADD COLUMN IF NOT EXISTS approved_at timestamptz;


-- One row per (participant, clue): the first scan and the first pick. The
-- primary key is what makes "first scan only" and "first pick only" hold.
CREATE TABLE IF NOT EXISTS hunt_scans (
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  first_scanned_at timestamptz NOT NULL DEFAULT now(),
  picked_index integer,
  picked_at timestamptz,
  PRIMARY KEY (participant_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_hunt_scans_question ON hunt_scans(question_id);

-- Only the session owner can read; every write goes through the RPCs below.
ALTER TABLE hunt_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can view hunt scans" ON hunt_scans;
CREATE POLICY "Owners can view hunt scans" ON hunt_scans
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM questions q
      JOIN sessions s ON s.id = q.session_id
      WHERE q.id = hunt_scans.question_id AND s.owner_id = auth.uid()
    )
  );

REVOKE ALL ON hunt_scans FROM anon;
REVOKE INSERT, UPDATE, DELETE ON hunt_scans FROM authenticated;

-- The hunt's state: 'not_started', 'running' or 'over'. The one place the
-- running rule lives; the database clock decides, never the phone.
CREATE OR REPLACE FUNCTION public.hunt_state_of(p_session public.sessions)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_session.hunt_started_at IS NULL THEN 'not_started'
    WHEN p_session.hunt_stopped_at IS NOT NULL THEN 'over'
    WHEN p_session.hunt_ends_at IS NOT NULL AND now() >= p_session.hunt_ends_at THEN 'over'
    ELSE 'running'
  END
$$;

REVOKE ALL ON FUNCTION public.hunt_state_of(public.sessions) FROM public, anon, authenticated;

-- Approved Participants ranked by clues found (desc), then last scan (asc).
CREATE OR REPLACE FUNCTION public.hunt_ranking(p_session_id uuid)
RETURNS TABLE (participant_id uuid, clues_found integer, last_scan_at timestamptz, rank integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.pid, t.found, t.last_scan,
         rank() OVER (ORDER BY t.found DESC, t.last_scan ASC NULLS LAST)::integer
    FROM (
      SELECT p.id AS pid,
             count(h.question_id)::integer AS found,
             max(h.first_scanned_at) AS last_scan
        FROM public.participants p
        LEFT JOIN public.hunt_scans h ON h.participant_id = p.id
       WHERE p.session_id = p_session_id AND p.approval_status = 'approved'
       GROUP BY p.id
    ) t
$$;

REVOKE ALL ON FUNCTION public.hunt_ranking(uuid) FROM public, anon, authenticated;

-- Returns the session when the caller owns it, is an organizer and it is a
-- hunt game; raises otherwise.
CREATE OR REPLACE FUNCTION public.hunt_owned_session(p_session_id uuid)
RETURNS public.sessions
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_session.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Session not found';
  END IF;
  IF NOT public.is_organizer() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_session.session_type <> 'treasure_hunt' OR NOT v_session.hunt_game THEN
    RAISE EXCEPTION 'This hunt is not a game';
  END IF;
  RETURN v_session;
END;
$$;

REVOKE ALL ON FUNCTION public.hunt_owned_session(uuid) FROM public, anon, authenticated;

-- Player: join a hunt game. Creates a pending Participant, or returns the one
-- this token already has (whatever its status, so a decision sticks; a
-- rejected token gets its rejected row back, which keeps that phone blocked).
CREATE OR REPLACE FUNCTION public.join_hunt(p_session_id uuid, p_name text, p_join_token text)
RETURNS TABLE (participant_id uuid, participant_name text, approval_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_variable
DECLARE
  v_session public.sessions%ROWTYPE;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
BEGIN
  SELECT * INTO v_session FROM public.sessions
   WHERE id = p_session_id AND is_active = true
   FOR UPDATE;
  IF NOT FOUND OR v_session.session_type <> 'treasure_hunt' OR NOT v_session.hunt_game THEN
    RAISE EXCEPTION 'This hunt is not accepting players';
  END IF;
  IF NOT public.owner_has_access(v_session.owner_id) THEN
    RAISE EXCEPTION 'This session is closed';
  END IF;
  IF p_join_token IS NULL OR btrim(p_join_token) = '' THEN
    RAISE EXCEPTION 'A join token is required';
  END IF;

  SELECT p.id INTO v_id FROM public.participants p
   WHERE p.session_id = p_session_id AND p.join_token = p_join_token;

  IF v_id IS NULL THEN
    IF v_session.hunt_started_at IS NOT NULL THEN
      RAISE EXCEPTION 'Joining is closed: the hunt has started';
    END IF;
    IF v_session.entries_closed THEN
      RAISE EXCEPTION 'Entries are closed for this session';
    END IF;
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'A name is required to join';
    END IF;
    IF char_length(v_name) > 40 THEN
      RAISE EXCEPTION 'A name can be at most 40 characters';
    END IF;
    IF v_session.max_participants IS NOT NULL AND
       (SELECT count(*) FROM public.participants pc
         WHERE pc.session_id = p_session_id
           AND pc.approval_status IN ('pending', 'approved'))
         >= v_session.max_participants THEN
      RAISE EXCEPTION 'This session is full';
    END IF;
    INSERT INTO public.participants (session_id, name, join_token, approval_status)
    VALUES (p_session_id, v_name, p_join_token, 'pending')
    RETURNING id INTO v_id;
  END IF;

  RETURN QUERY
    SELECT p.id, p.name, p.approval_status FROM public.participants p WHERE p.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.join_hunt(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.join_hunt(uuid, text, text) TO anon, authenticated;

-- Player: my status. approval_status is 'unknown' for a token the hunt has
-- not seen. rank and last_scan_at are filled only once the hunt is over.
CREATE OR REPLACE FUNCTION public.get_hunt_status(p_session_id uuid, p_join_token text)
RETURNS TABLE (
  approval_status text,
  hunt_state text,
  hunt_started_at timestamptz,
  hunt_ends_at timestamptz,
  hunt_stopped_at timestamptz,
  server_now timestamptz,
  clues_found integer,
  total_clues integer,
  rank integer,
  last_scan_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
#variable_conflict use_variable
DECLARE
  v_session public.sessions%ROWTYPE;
  v_participant public.participants%ROWTYPE;
  v_state text;
  v_found integer := 0;
  v_last timestamptz;
  v_rank integer;
BEGIN
  SELECT * INTO v_session FROM public.sessions
   WHERE id = p_session_id AND session_type = 'treasure_hunt' AND hunt_game;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  v_state := public.hunt_state_of(v_session);

  SELECT * INTO v_participant FROM public.participants p
   WHERE p.session_id = p_session_id AND p.join_token = p_join_token;

  IF FOUND THEN
    SELECT count(*)::integer, max(h.first_scanned_at) INTO v_found, v_last
      FROM public.hunt_scans h WHERE h.participant_id = v_participant.id;
    IF v_state = 'over' AND v_participant.approval_status = 'approved' THEN
      SELECT r.rank INTO v_rank FROM public.hunt_ranking(p_session_id) r
       WHERE r.participant_id = v_participant.id;
    ELSE
      v_last := NULL;
    END IF;
  END IF;

  RETURN QUERY SELECT
    CASE WHEN v_participant.id IS NULL THEN 'unknown' ELSE v_participant.approval_status END,
    v_state,
    v_session.hunt_started_at,
    v_session.hunt_ends_at,
    v_session.hunt_stopped_at,
    now(),
    v_found,
    (SELECT count(*)::integer FROM public.questions WHERE session_id = p_session_id),
    v_rank,
    v_last;
END;
$$;

REVOKE ALL ON FUNCTION public.get_hunt_status(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_hunt_status(uuid, text) TO anon, authenticated;

-- get_clue gains an optional join token and, for game hunts, a gate status
-- (join_required, pending, removed, not_started, over, live) plus the
-- finder's locked pick. The return type changes, so the function is dropped
-- and recreated. It writes (the first scan), so it is no longer STABLE.
DROP FUNCTION IF EXISTS public.get_clue(text);

CREATE FUNCTION public.get_clue(p_token text, p_join_token text DEFAULT NULL)
RETURNS TABLE (
  status text,
  clue_message text,
  clue_number integer,
  session_title text,
  choices jsonb,
  confirm_choice boolean,
  theme jsonb,
  session_id uuid,
  session_slug text,
  locked_index integer,
  locked_reveal text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_variable
DECLARE
  v_question public.questions;
  v_session public.sessions;
  v_labels jsonb;
  v_participant public.participants;
  v_state text;
  v_locked integer;
  v_gate text;
BEGIN
  SELECT * INTO v_question FROM public.questions q WHERE q.clue_token = p_token;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'missing'::text, NULL::text, NULL::integer, NULL::text, NULL::jsonb, NULL::boolean,
                        NULL::jsonb, NULL::uuid, NULL::text, NULL::integer, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_session FROM public.sessions s WHERE s.id = v_question.session_id;
  IF NOT FOUND OR v_session.session_type <> 'treasure_hunt' THEN
    RETURN QUERY SELECT 'missing'::text, NULL::text, NULL::integer, NULL::text, NULL::jsonb, NULL::boolean,
                        NULL::jsonb, NULL::uuid, NULL::text, NULL::integer, NULL::text;
    RETURN;
  END IF;

  IF NOT v_session.is_active THEN
    RETURN QUERY SELECT 'not_live'::text, NULL::text, v_question.order_index + 1, v_session.title, NULL::jsonb,
                        NULL::boolean, v_session.theme, NULL::uuid, NULL::text, NULL::integer, NULL::text;
    RETURN;
  END IF;

  IF NOT public.owner_has_access(v_session.owner_id) THEN
    RETURN QUERY SELECT 'closed'::text, NULL::text, v_question.order_index + 1, v_session.title, NULL::jsonb,
                        NULL::boolean, v_session.theme, NULL::uuid, NULL::text, NULL::integer, NULL::text;
    RETURN;
  END IF;

  IF v_session.hunt_game THEN
    v_state := public.hunt_state_of(v_session);
    IF p_join_token IS NOT NULL THEN
      SELECT * INTO v_participant FROM public.participants p
       WHERE p.session_id = v_session.id AND p.join_token = p_join_token;
    END IF;

    v_gate := CASE
      WHEN v_participant.id IS NULL THEN 'join_required'
      WHEN v_participant.approval_status = 'rejected' THEN 'removed'
      WHEN v_participant.approval_status = 'pending' THEN 'pending'
      WHEN v_state = 'not_started' THEN 'not_started'
      WHEN v_state = 'over' THEN 'over'
      ELSE 'live'
    END;

    IF v_gate <> 'live' THEN
      RETURN QUERY SELECT v_gate, NULL::text, v_question.order_index + 1, v_session.title, NULL::jsonb,
                          NULL::boolean, v_session.theme, v_session.id, v_session.slug, NULL::integer, NULL::text;
      RETURN;
    END IF;

    INSERT INTO public.hunt_scans (participant_id, question_id)
    VALUES (v_participant.id, v_question.id)
    ON CONFLICT (participant_id, question_id) DO NOTHING;

    SELECT h.picked_index INTO v_locked FROM public.hunt_scans h
     WHERE h.participant_id = v_participant.id AND h.question_id = v_question.id;
  END IF;

  IF v_question.clue_choices IS NOT NULL THEN
    SELECT jsonb_agg(t.e -> 'label' ORDER BY t.ord) INTO v_labels
    FROM jsonb_array_elements(v_question.clue_choices) WITH ORDINALITY AS t(e, ord);
  END IF;

  RETURN QUERY SELECT
    'live'::text,
    v_question.text,
    v_question.order_index + 1,
    v_session.title,
    v_labels,
    (v_question.clue_confirm_choice AND v_question.clue_choices IS NOT NULL),
    v_session.theme,
    CASE WHEN v_session.hunt_game THEN v_session.id END,
    CASE WHEN v_session.hunt_game THEN v_session.slug END,
    v_locked,
    CASE WHEN v_locked IS NOT NULL THEN v_question.clue_choices -> v_locked ->> 'reveal' END;
END;
$$;

REVOKE ALL ON FUNCTION public.get_clue(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_clue(text, text) TO anon, authenticated;

-- reveal_clue_choice gains an optional join token. For game hunts it needs a
-- recorded scan and a running hunt; it stores the first pick and answers
-- 'locked' with that original pick afterwards. The return type changes.
DROP FUNCTION IF EXISTS public.reveal_clue_choice(text, integer);

CREATE FUNCTION public.reveal_clue_choice(p_token text, p_index integer, p_join_token text DEFAULT NULL)
RETURNS TABLE (status text, reveal text, picked_index integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_variable
DECLARE
  v_question public.questions;
  v_session public.sessions;
  v_participant public.participants;
  v_scan public.hunt_scans;
  v_state text;
  v_scanned boolean;
  v_updated boolean;
BEGIN
  SELECT * INTO v_question FROM public.questions q WHERE q.clue_token = p_token;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'missing'::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  SELECT * INTO v_session FROM public.sessions s WHERE s.id = v_question.session_id;
  IF NOT FOUND OR v_session.session_type <> 'treasure_hunt' THEN
    RETURN QUERY SELECT 'missing'::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  IF NOT v_session.is_active THEN
    RETURN QUERY SELECT 'not_live'::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  IF NOT public.owner_has_access(v_session.owner_id) THEN
    RETURN QUERY SELECT 'closed'::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  IF v_question.clue_choices IS NULL
     OR p_index IS NULL
     OR p_index < 0
     OR p_index >= jsonb_array_length(v_question.clue_choices) THEN
    RETURN QUERY SELECT 'missing'::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  IF NOT v_session.hunt_game THEN
    RETURN QUERY SELECT 'live'::text, v_question.clue_choices -> p_index ->> 'reveal', p_index;
    RETURN;
  END IF;

  IF p_join_token IS NOT NULL THEN
    SELECT * INTO v_participant FROM public.participants p
     WHERE p.session_id = v_session.id AND p.join_token = p_join_token;
  END IF;
  IF v_participant.id IS NULL THEN
    RETURN QUERY SELECT 'join_required'::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  IF v_participant.approval_status = 'rejected' THEN
    RETURN QUERY SELECT 'removed'::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  IF v_participant.approval_status = 'pending' THEN
    RETURN QUERY SELECT 'pending'::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  -- A pick already made stays, whatever the clock says now.
  SELECT * INTO v_scan FROM public.hunt_scans h
   WHERE h.participant_id = v_participant.id AND h.question_id = v_question.id;
  v_scanned := FOUND;
  IF v_scanned AND v_scan.picked_index IS NOT NULL THEN
    RETURN QUERY SELECT 'locked'::text, v_question.clue_choices -> v_scan.picked_index ->> 'reveal',
                        v_scan.picked_index;
    RETURN;
  END IF;

  v_state := public.hunt_state_of(v_session);
  IF v_state <> 'running' THEN
    RETURN QUERY SELECT v_state, NULL::text, NULL::integer;
    RETURN;
  END IF;
  IF NOT v_scanned THEN
    RETURN QUERY SELECT 'not_scanned'::text, NULL::text, NULL::integer;
    RETURN;
  END IF;

  -- Atomic first pick: only a row with no pick yet is updated, so two
  -- concurrent taps cannot both win.
  UPDATE public.hunt_scans h
     SET picked_index = p_index, picked_at = now()
   WHERE h.participant_id = v_participant.id AND h.question_id = v_question.id
     AND h.picked_index IS NULL
  RETURNING * INTO v_scan;
  v_updated := FOUND;

  IF NOT v_updated THEN
    SELECT * INTO v_scan FROM public.hunt_scans h
     WHERE h.participant_id = v_participant.id AND h.question_id = v_question.id;
    IF v_scan.picked_index IS NOT NULL THEN
      RETURN QUERY SELECT 'locked'::text, v_question.clue_choices -> v_scan.picked_index ->> 'reveal',
                          v_scan.picked_index;
    ELSE
      RETURN QUERY SELECT 'not_scanned'::text, NULL::text, NULL::integer;
    END IF;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'live'::text, v_question.clue_choices -> p_index ->> 'reveal', p_index;
END;
$$;

REVOKE ALL ON FUNCTION public.reveal_clue_choice(text, integer, text) FROM public;
GRANT EXECUTE ON FUNCTION public.reveal_clue_choice(text, integer, text) TO anon, authenticated;

-- Organizer: approve or reject one Participant ('approved' or 'rejected').
CREATE OR REPLACE FUNCTION public.set_hunt_approval(p_participant_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session_id uuid;
BEGIN
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Status must be approved or rejected';
  END IF;
  SELECT session_id INTO v_session_id FROM public.participants WHERE id = p_participant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Participant not found';
  END IF;
  PERFORM public.hunt_owned_session(v_session_id);

  UPDATE public.participants
     SET approval_status = p_status,
         approved_at = CASE WHEN p_status = 'approved' THEN coalesce(approved_at, now()) ELSE NULL END
   WHERE id = p_participant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_hunt_approval(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_hunt_approval(uuid, text) TO authenticated;

-- Organizer: approve every pending Participant. Returns how many.
CREATE OR REPLACE FUNCTION public.approve_all_hunt_players(p_session_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM public.hunt_owned_session(p_session_id);
  UPDATE public.participants
     SET approval_status = 'approved', approved_at = now()
   WHERE session_id = p_session_id AND approval_status = 'pending';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_all_hunt_players(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.approve_all_hunt_players(uuid) TO authenticated;

-- Organizer: start the hunt clock, with an optional length in minutes.
CREATE OR REPLACE FUNCTION public.start_hunt(p_session_id uuid, p_minutes integer DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
BEGIN
  v_session := public.hunt_owned_session(p_session_id);
  IF v_session.hunt_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'The hunt has already started; reset it to run it again';
  END IF;
  IF p_minutes IS NOT NULL AND p_minutes <= 0 THEN
    RAISE EXCEPTION 'The length must be a positive number of minutes';
  END IF;

  UPDATE public.sessions
     SET hunt_started_at = now(),
         hunt_ends_at = CASE WHEN p_minutes IS NULL THEN NULL ELSE now() + make_interval(mins => p_minutes) END,
         hunt_stopped_at = NULL
   WHERE id = p_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_hunt(uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.start_hunt(uuid, integer) TO authenticated;

-- Organizer: stop the clock now.
CREATE OR REPLACE FUNCTION public.stop_hunt(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
BEGIN
  v_session := public.hunt_owned_session(p_session_id);
  IF v_session.hunt_started_at IS NULL THEN
    RAISE EXCEPTION 'The hunt has not started';
  END IF;
  IF public.hunt_state_of(v_session) = 'over' THEN
    RETURN;
  END IF;
  UPDATE public.sessions SET hunt_stopped_at = now() WHERE id = p_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.stop_hunt(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.stop_hunt(uuid) TO authenticated;

-- Organizer: delete the run (Participants, their scans and picks) and clear
-- the clock. Clues and their tokens are untouched.
CREATE OR REPLACE FUNCTION public.reset_hunt(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.hunt_owned_session(p_session_id);
  -- Cascades to hunt_scans.
  DELETE FROM public.participants WHERE session_id = p_session_id;
  UPDATE public.sessions
     SET hunt_started_at = NULL, hunt_ends_at = NULL, hunt_stopped_at = NULL
   WHERE id = p_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_hunt(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reset_hunt(uuid) TO authenticated;

-- Organizer: one row per Participant. rank is null unless approved. scans is
-- a JSON array, one entry per clue found: clue_number, scanned_at,
-- picked_label, picked_at.
CREATE OR REPLACE FUNCTION public.get_hunt_board(p_session_id uuid)
RETURNS TABLE (
  participant_id uuid,
  name text,
  approval_status text,
  joined_at timestamptz,
  approved_at timestamptz,
  clues_found integer,
  last_scan_at timestamptz,
  rank integer,
  scans jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.hunt_owned_session(p_session_id);

  RETURN QUERY
    SELECT p.id,
           p.name,
           p.approval_status,
           p.created_at,
           p.approved_at,
           (SELECT count(*)::integer FROM public.hunt_scans h WHERE h.participant_id = p.id),
           (SELECT max(h.first_scanned_at) FROM public.hunt_scans h WHERE h.participant_id = p.id),
           r.rank,
           coalesce((
             SELECT jsonb_agg(jsonb_build_object(
                      'clue_number', q.order_index + 1,
                      'question_id', q.id,
                      'scanned_at', h.first_scanned_at,
                      'picked_label', CASE WHEN h.picked_index IS NOT NULL
                                           THEN q.clue_choices -> h.picked_index ->> 'label' END,
                      'picked_at', h.picked_at) ORDER BY q.order_index)
               FROM public.hunt_scans h
               JOIN public.questions q ON q.id = h.question_id
              WHERE h.participant_id = p.id
           ), '[]'::jsonb)
      FROM public.participants p
      LEFT JOIN public.hunt_ranking(p_session_id) r ON r.participant_id = p.id
     WHERE p.session_id = p_session_id
     ORDER BY r.rank NULLS LAST, p.created_at, p.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_hunt_board(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_hunt_board(uuid) TO authenticated;

-- remove_participant: also allowed on a Treasure Hunt. A game hunt keeps the
-- row as 'rejected' so the removed phone cannot sign up again with its token;
-- a hunt that is not a game has no Participants to keep.
CREATE OR REPLACE FUNCTION public.remove_participant(p_participant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
BEGIN
  SELECT s.* INTO v_session
    FROM public.participants p
    JOIN public.sessions s ON s.id = p.session_id
   WHERE p.id = p_participant_id;

  IF NOT FOUND OR v_session.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Participant not found';
  END IF;
  IF NOT public.is_organizer() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_session.session_type NOT IN ('quiz', 'comments', 'treasure_hunt') THEN
    RAISE EXCEPTION 'Participants can only be removed from a quiz, comments or treasure hunt session';
  END IF;

  IF v_session.session_type = 'treasure_hunt' AND v_session.hunt_game THEN
    UPDATE public.participants
       SET approval_status = 'rejected', approved_at = NULL
     WHERE id = p_participant_id;
  ELSE
    DELETE FROM public.participants WHERE id = p_participant_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_participant(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.remove_participant(uuid) TO authenticated;
