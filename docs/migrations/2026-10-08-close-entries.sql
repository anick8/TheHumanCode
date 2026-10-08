-- ============================================================================
-- 26. Close entries and host removal
-- ============================================================================

-- The host's "close entries" switch. Quiz and Comments: nobody new can join
-- (a device that already joined keeps playing). Poll has no join step, so the
-- same flag closes voting for everyone. Manual only, reopenable.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS entries_closed boolean NOT NULL DEFAULT false;

-- join_session: as section 2, plus the closed check. A rejoin that presents a
-- join token already stored for this session still resolves, so a reload on a
-- phone that is already in keeps working while entries are closed.
CREATE OR REPLACE FUNCTION public.join_session(
  p_session_id uuid,
  p_name text,
  p_external_id text,
  p_join_token text
)
RETURNS TABLE (participant_id uuid, participant_name text, participant_external_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_external text := nullif(btrim(coalesce(p_external_id, '')), '');
  v_id uuid;
BEGIN
  SELECT * INTO v_session FROM public.sessions
   WHERE id = p_session_id AND is_active = true;

  IF NOT FOUND OR v_session.participation_mode <> 'identified' THEN
    RAISE EXCEPTION 'This session is not accepting identified participants';
  END IF;
  IF v_session.identity_requires_name AND v_name IS NULL THEN
    RAISE EXCEPTION 'A name is required to join';
  END IF;
  IF v_session.identity_requires_id AND v_external IS NULL THEN
    RAISE EXCEPTION 'An ID is required to join';
  END IF;
  IF p_join_token IS NULL OR btrim(p_join_token) = '' THEN
    RAISE EXCEPTION 'A join token is required';
  END IF;

  IF v_session.entries_closed AND NOT EXISTS (
    SELECT 1 FROM public.participants
     WHERE session_id = p_session_id AND join_token = p_join_token
  ) THEN
    RAISE EXCEPTION 'Entries are closed for this session';
  END IF;

  IF v_external IS NOT NULL THEN
    -- Same-token rule as before: a rejoin with the same external_id must also
    -- present the same join_token, so knowing an ID alone cannot steal it.
    INSERT INTO public.participants (session_id, name, external_id, join_token)
    VALUES (p_session_id, v_name, v_external, p_join_token)
    ON CONFLICT (session_id, external_id) WHERE external_id IS NOT NULL
    DO UPDATE SET name = EXCLUDED.name
      WHERE public.participants.join_token = EXCLUDED.join_token
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'This ID has already joined this session from a different device';
    END IF;
  ELSE
    INSERT INTO public.participants (session_id, name, external_id, join_token)
    VALUES (p_session_id, v_name, NULL, p_join_token)
    RETURNING id INTO v_id;
  END IF;

  RETURN QUERY
    SELECT p.id, p.name, p.external_id FROM public.participants p WHERE p.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.join_session(uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.join_session(uuid, text, text, text) TO anon, authenticated;

-- submit_anonymous_vote: as section 21, plus "Voting is closed" for a Poll
-- whose host closed entries. A repeat vote is refused too - nothing gets in.
CREATE OR REPLACE FUNCTION public.submit_anonymous_vote(
  p_voter_token text,
  p_question_id uuid,
  p_option_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- Per question, per network. Generous on purpose: a whole room on one
  -- conference Wi-Fi shares a single IP. It stops scripted stuffing, not crowds.
  c_ip_cap CONSTANT integer := 300;
  v_session public.sessions%ROWTYPE;
  v_question public.questions%ROWTYPE;
  v_index integer;
  v_ip text;
  v_ip_hash text;
BEGIN
  IF p_voter_token IS NULL OR char_length(p_voter_token) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid voter token';
  END IF;

  SELECT * INTO v_question FROM public.questions WHERE id = p_question_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown question';
  END IF;

  SELECT * INTO v_session FROM public.sessions WHERE id = v_question.session_id;
  IF NOT FOUND OR v_session.is_active = false THEN
    RAISE EXCEPTION 'This session is not active';
  END IF;
  IF v_session.participation_mode <> 'anonymous' THEN
    RAISE EXCEPTION 'This session requires joining first';
  END IF;
  IF v_session.entries_closed THEN
    RAISE EXCEPTION 'Voting is closed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.options WHERE id = p_option_id AND question_id = p_question_id
  ) THEN
    RAISE EXCEPTION 'That option does not belong to the question';
  END IF;

  -- Presenter-driven session: only the question on screen accepts votes, and
  -- not once its results are revealed. Self-paced (index IS NULL) accepts any.
  IF v_session.current_question_index IS NOT NULL THEN
    SELECT sub.idx INTO v_index FROM (
      SELECT id, (row_number() OVER (ORDER BY order_index) - 1) AS idx
      FROM public.questions WHERE session_id = v_session.id
    ) sub WHERE sub.id = p_question_id;

    IF v_index IS DISTINCT FROM v_session.current_question_index
       OR v_session.results_revealed THEN
      RAISE EXCEPTION 'This question is not open for votes';
    END IF;
  END IF;

  -- Only a hash of the caller's IP is stored. Absent header (e.g. local dev)
  -- skips the cap rather than failing the vote.
  v_ip := btrim(split_part(
    coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1));
  IF v_ip <> '' THEN
    v_ip_hash := md5(v_ip);
    IF (SELECT count(*) FROM public.votes
         WHERE question_id = p_question_id AND voter_ip_hash = v_ip_hash) >= c_ip_cap THEN
      RAISE EXCEPTION 'Too many votes from this network';
    END IF;
  END IF;

  -- A repeat from the same browser is a no-op, matching the old 23505 handling.
  INSERT INTO public.votes (option_id, question_id, voter_token, voter_ip_hash)
  VALUES (p_option_id, p_question_id, p_voter_token, v_ip_hash)
  ON CONFLICT (question_id, voter_token) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_anonymous_vote(text, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_anonymous_vote(text, uuid, uuid) TO anon, authenticated;

-- participant_exists: lets a phone find out the host removed it. Returns only
-- a boolean for the caller's own join token, so it leaks nothing.
CREATE OR REPLACE FUNCTION public.participant_exists(p_join_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.participants WHERE join_token = p_join_token);
$$;

REVOKE ALL ON FUNCTION public.participant_exists(text) FROM public;
GRANT EXECUTE ON FUNCTION public.participant_exists(text) TO anon, authenticated;

-- remove_participant: the host kicks a Participant out of a Quiz or Comments
-- session. Hard delete; their votes/comments cascade and the Leaderboard
-- re-ranks without them. They may rejoin while entries are open.
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
  IF v_session.session_type NOT IN ('quiz', 'comments') THEN
    RAISE EXCEPTION 'Participants can only be removed from a quiz or comments session';
  END IF;

  DELETE FROM public.participants WHERE id = p_participant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_participant(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.remove_participant(uuid) TO authenticated;

-- delete_comment: the host removes one Comment. Hard delete.
CREATE OR REPLACE FUNCTION public.delete_comment(p_comment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT s.owner_id INTO v_owner
    FROM public.comments c
    JOIN public.questions q ON q.id = c.question_id
    JOIN public.sessions s ON s.id = q.session_id
   WHERE c.id = p_comment_id;

  IF NOT FOUND OR v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Comment not found';
  END IF;

  DELETE FROM public.comments WHERE id = p_comment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_comment(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_comment(uuid) TO authenticated;
