-- ============================================================================
-- 28. Join limit
-- ============================================================================

-- An optional cap on how many Participants may join a session (the Wheel of
-- Fortune form exposes it). NULL means no limit. Manual Wheel Entries are not
-- Participants and never count.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS max_participants integer;
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_max_participants_positive;
ALTER TABLE sessions ADD CONSTRAINT sessions_max_participants_positive
  CHECK (max_participants IS NULL OR max_participants > 0);

-- join_session: as section 26, plus the limit. The session row is locked so two
-- concurrent joins cannot both take the last slot. Unlike closed entries, a
-- full session refuses every join_session call, known token or not: that call
-- always inserts a new Participant. A phone that already joined keeps playing
-- from its stored Participant, which never calls join_session again.
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
  v_known boolean;
BEGIN
  SELECT * INTO v_session FROM public.sessions
   WHERE id = p_session_id AND is_active = true
   FOR UPDATE;

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

  SELECT EXISTS (
    SELECT 1 FROM public.participants
     WHERE session_id = p_session_id AND join_token = p_join_token
  ) INTO v_known;

  IF v_session.entries_closed AND NOT v_known THEN
    RAISE EXCEPTION 'Entries are closed for this session';
  END IF;

  IF v_session.max_participants IS NOT NULL AND
     (SELECT count(*) FROM public.participants WHERE session_id = p_session_id)
       >= v_session.max_participants THEN
    RAISE EXCEPTION 'This session is full';
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
