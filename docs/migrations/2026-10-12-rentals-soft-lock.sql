-- ============================================================================
-- 31. Rentals soft lock
-- ============================================================================

-- A lapsed owner (Grant expired past the grace, or revoked) is soft-locked:
-- they keep read access to their own Sessions and results, but every write,
-- presenter RPC and storage write needs an Organizer, and their attendees are
-- refused with a neutral "closed" message. Nothing is deleted.

-- Does the owner of a session currently have access? Ownerless sessions (the
-- seeded samples) stay open. An owner inside the grace counts as active.
-- Server-side only: it takes any user id, so clients cannot call it.
CREATE OR REPLACE FUNCTION public.owner_has_access(p_owner uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT p_owner IS NULL
      OR public.organizer_state_for(p_owner) IN ('admin', 'active');
$$;

REVOKE ALL ON FUNCTION public.owner_has_access(uuid) FROM public, anon, authenticated;

-- What the attendee vote page asks, so it can say "This session is closed"
-- without learning anything about expiry or billing. True when the session's
-- owner has access (or the session does not exist or has no owner).
CREATE OR REPLACE FUNCTION public.session_owner_has_access(p_session_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT public.owner_has_access(
    (SELECT s.owner_id FROM public.sessions s WHERE s.id = p_session_id)
  );
$$;

REVOKE ALL ON FUNCTION public.session_owner_has_access(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.session_owner_has_access(uuid) TO anon, authenticated;

-- Owner policies split into a read side (owner only, no Organizer needed) and
-- a write side (owner and Organizer). Permissive policies are OR-ed, so the
-- old FOR ALL policies are dropped first.

-- Sessions
DROP POLICY IF EXISTS "Users can manage their own sessions" ON sessions;
DROP POLICY IF EXISTS "Owners can view their own sessions" ON sessions;
CREATE POLICY "Owners can view their own sessions" ON sessions
  FOR SELECT USING (auth.uid() = owner_id);
DROP POLICY IF EXISTS "Organizers can create their own sessions" ON sessions;
CREATE POLICY "Organizers can create their own sessions" ON sessions
  FOR INSERT WITH CHECK ((select public.is_organizer()) AND auth.uid() = owner_id);
DROP POLICY IF EXISTS "Organizers can update their own sessions" ON sessions;
CREATE POLICY "Organizers can update their own sessions" ON sessions
  FOR UPDATE USING ((select public.is_organizer()) AND auth.uid() = owner_id)
  WITH CHECK ((select public.is_organizer()) AND auth.uid() = owner_id);
DROP POLICY IF EXISTS "Organizers can delete their own sessions" ON sessions;
CREATE POLICY "Organizers can delete their own sessions" ON sessions
  FOR DELETE USING ((select public.is_organizer()) AND auth.uid() = owner_id);

-- Questions
DROP POLICY IF EXISTS "Users can manage questions in their sessions" ON questions;
DROP POLICY IF EXISTS "Owners can view questions in their sessions" ON questions;
CREATE POLICY "Owners can view questions in their sessions" ON questions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = questions.session_id
      AND sessions.owner_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Organizers can insert questions in their sessions" ON questions;
CREATE POLICY "Organizers can insert questions in their sessions" ON questions
  FOR INSERT WITH CHECK (
    (select public.is_organizer()) AND EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = questions.session_id
      AND sessions.owner_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Organizers can update questions in their sessions" ON questions;
CREATE POLICY "Organizers can update questions in their sessions" ON questions
  FOR UPDATE USING (
    (select public.is_organizer()) AND EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = questions.session_id
      AND sessions.owner_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Organizers can delete questions in their sessions" ON questions;
CREATE POLICY "Organizers can delete questions in their sessions" ON questions
  FOR DELETE USING (
    (select public.is_organizer()) AND EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = questions.session_id
      AND sessions.owner_id = auth.uid()
    )
  );

-- Options
DROP POLICY IF EXISTS "Users can manage options in their sessions" ON options;
DROP POLICY IF EXISTS "Owners can view options in their sessions" ON options;
CREATE POLICY "Owners can view options in their sessions" ON options
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM questions
      JOIN sessions ON sessions.id = questions.session_id
      WHERE questions.id = options.question_id
      AND sessions.owner_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Organizers can insert options in their sessions" ON options;
CREATE POLICY "Organizers can insert options in their sessions" ON options
  FOR INSERT WITH CHECK (
    (select public.is_organizer()) AND EXISTS (
      SELECT 1 FROM questions
      JOIN sessions ON sessions.id = questions.session_id
      WHERE questions.id = options.question_id
      AND sessions.owner_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Organizers can update options in their sessions" ON options;
CREATE POLICY "Organizers can update options in their sessions" ON options
  FOR UPDATE USING (
    (select public.is_organizer()) AND EXISTS (
      SELECT 1 FROM questions
      JOIN sessions ON sessions.id = questions.session_id
      WHERE questions.id = options.question_id
      AND sessions.owner_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Organizers can delete options in their sessions" ON options;
CREATE POLICY "Organizers can delete options in their sessions" ON options
  FOR DELETE USING (
    (select public.is_organizer()) AND EXISTS (
      SELECT 1 FROM questions
      JOIN sessions ON sessions.id = questions.session_id
      WHERE questions.id = options.question_id
      AND sessions.owner_id = auth.uid()
    )
  );

-- Answer keys
DROP POLICY IF EXISTS "Users can manage question keys in their sessions" ON question_keys;
DROP POLICY IF EXISTS "Owners can view question keys in their sessions" ON question_keys;
CREATE POLICY "Owners can view question keys in their sessions" ON question_keys
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM questions q
      JOIN sessions s ON s.id = q.session_id
      WHERE q.id = question_keys.question_id
      AND s.owner_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Organizers can insert question keys in their sessions" ON question_keys;
CREATE POLICY "Organizers can insert question keys in their sessions" ON question_keys
  FOR INSERT WITH CHECK (
    (select public.is_organizer()) AND EXISTS (
      SELECT 1 FROM questions q
      JOIN sessions s ON s.id = q.session_id
      WHERE q.id = question_keys.question_id
      AND s.owner_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Organizers can update question keys in their sessions" ON question_keys;
CREATE POLICY "Organizers can update question keys in their sessions" ON question_keys
  FOR UPDATE USING (
    (select public.is_organizer()) AND EXISTS (
      SELECT 1 FROM questions q
      JOIN sessions s ON s.id = q.session_id
      WHERE q.id = question_keys.question_id
      AND s.owner_id = auth.uid()
    )
  ) WITH CHECK (
    (select public.is_organizer()) AND EXISTS (
      SELECT 1 FROM questions q
      JOIN sessions s ON s.id = q.session_id
      WHERE q.id = question_keys.question_id
      AND s.owner_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Organizers can delete question keys in their sessions" ON question_keys;
CREATE POLICY "Organizers can delete question keys in their sessions" ON question_keys
  FOR DELETE USING (
    (select public.is_organizer()) AND EXISTS (
      SELECT 1 FROM questions q
      JOIN sessions s ON s.id = q.session_id
      WHERE q.id = question_keys.question_id
      AND s.owner_id = auth.uid()
    )
  );

-- Comments (attendees insert through submit_comment; the owner moderates)
DROP POLICY IF EXISTS "Users can manage comments in their sessions" ON comments;
DROP POLICY IF EXISTS "Owners can view comments in their sessions" ON comments;
CREATE POLICY "Owners can view comments in their sessions" ON comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM questions q
      JOIN sessions s ON s.id = q.session_id
      WHERE q.id = comments.question_id
      AND s.owner_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Organizers can insert comments in their sessions" ON comments;
CREATE POLICY "Organizers can insert comments in their sessions" ON comments
  FOR INSERT WITH CHECK (
    (select public.is_organizer()) AND EXISTS (
      SELECT 1 FROM questions q
      JOIN sessions s ON s.id = q.session_id
      WHERE q.id = comments.question_id
      AND s.owner_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Organizers can update comments in their sessions" ON comments;
CREATE POLICY "Organizers can update comments in their sessions" ON comments
  FOR UPDATE USING (
    (select public.is_organizer()) AND EXISTS (
      SELECT 1 FROM questions q
      JOIN sessions s ON s.id = q.session_id
      WHERE q.id = comments.question_id
      AND s.owner_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Organizers can delete comments in their sessions" ON comments;
CREATE POLICY "Organizers can delete comments in their sessions" ON comments
  FOR DELETE USING (
    (select public.is_organizer()) AND EXISTS (
      SELECT 1 FROM questions q
      JOIN sessions s ON s.id = q.session_id
      WHERE q.id = comments.question_id
      AND s.owner_id = auth.uid()
    )
  );

-- Votes, participants, wheel Entries and Spins already have owner-only SELECT
-- policies and no write policy; they read through the sessions policy above.

-- Owner RPCs: presenter and moderation calls now also need an Organizer.

-- reveal_quiz_question: needs an Organizer.
CREATE OR REPLACE FUNCTION public.reveal_quiz_question(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_question public.questions%ROWTYPE;
BEGIN
  IF NOT public.is_organizer() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_session.owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT v_session.is_scored THEN
    RAISE EXCEPTION 'This session is not scored';
  END IF;
  IF v_session.current_question_index IS NULL OR v_session.current_question_index < 0 THEN
    RAISE EXCEPTION 'No question is currently open';
  END IF;

  SELECT * INTO v_question FROM public.questions
  WHERE session_id = p_session_id AND order_index = v_session.current_question_index;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No question at this position';
  END IF;

  WITH judged AS (
    UPDATE public.votes v
    SET is_correct = (k.option_id IS NOT NULL AND k.option_id = v.option_id),
        awarded_points = CASE WHEN k.option_id IS NOT NULL AND k.option_id = v.option_id
                               THEN coalesce(q.points, 0) ELSE 0 END
    FROM public.questions q
    LEFT JOIN public.question_keys k ON k.question_id = q.id
    WHERE v.question_id = v_question.id
      AND q.id = v_question.id
      AND v.is_correct IS NULL
    RETURNING v.participant_id, v.awarded_points
  )
  UPDATE public.participants p
  SET score = p.score + judged.awarded_points,
      finished_at = CASE
        WHEN p.finished_at IS NOT NULL THEN p.finished_at
        WHEN p.answered_count >= (SELECT count(*) FROM public.questions WHERE session_id = p_session_id)
        THEN now() ELSE p.finished_at END
  FROM judged
  WHERE p.id = judged.participant_id;

  IF v_question.revealed_at IS NULL THEN
    IF v_question.opened_at IS NOT NULL THEN
      UPDATE public.participants p
         SET total_response_ms = p.total_response_ms + coalesce(
               (SELECT least(
                         greatest(0, round(extract(epoch FROM v.created_at - v_question.opened_at) * 1000)),
                         v_question.time_limit_seconds * 1000
                       )::bigint
                  FROM public.votes v
                 WHERE v.question_id = v_question.id AND v.participant_id = p.id),
               v_question.time_limit_seconds * 1000)
       WHERE p.session_id = p_session_id;
    END IF;
    UPDATE public.questions SET revealed_at = now() WHERE id = v_question.id;
  END IF;

  UPDATE public.sessions SET results_revealed = true, show_leaderboard = false WHERE id = p_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reveal_quiz_question(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reveal_quiz_question(uuid) TO authenticated;

-- add_wheel_entries: needs an Organizer.
CREATE OR REPLACE FUNCTION public.add_wheel_entries(p_session_id uuid, p_labels text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_added integer;
BEGIN
  IF NOT public.is_organizer() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_session.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_session.session_type <> 'wheel' THEN
    RAISE EXCEPTION 'This session is not a Wheel of Fortune';
  END IF;

  WITH cleaned AS (
    SELECT left(btrim(l.label), 24) AS label, l.ord
      FROM unnest(coalesce(p_labels, '{}'::text[])) WITH ORDINALITY AS l(label, ord)
     WHERE btrim(coalesce(l.label, '')) <> ''
  ), ins AS (
    INSERT INTO public.wheel_entries (session_id, label, kind, created_at)
    SELECT p_session_id, c.label, 'manual', clock_timestamp() + c.ord * interval '1 microsecond'
      FROM cleaned c ORDER BY c.ord
    RETURNING 1
  )
  SELECT count(*) INTO v_added FROM ins;
  RETURN v_added;
END;
$$;

REVOKE ALL ON FUNCTION public.add_wheel_entries(uuid, text[]) FROM public;
GRANT EXECUTE ON FUNCTION public.add_wheel_entries(uuid, text[]) TO authenticated;

-- remove_wheel_entry: needs an Organizer.
CREATE OR REPLACE FUNCTION public.remove_wheel_entry(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
BEGIN
  IF NOT public.is_organizer() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  PERFORM 1 FROM public.wheel_entries e
    JOIN public.sessions s ON s.id = e.session_id
   WHERE e.id = p_entry_id AND s.owner_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.wheel_entries SET removed_at = coalesce(removed_at, now()) WHERE id = p_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_wheel_entry(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.remove_wheel_entry(uuid) TO authenticated;

-- restore_wheel_entry: needs an Organizer.
CREATE OR REPLACE FUNCTION public.restore_wheel_entry(p_entry_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
BEGIN
  IF NOT public.is_organizer() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  PERFORM 1 FROM public.wheel_entries e
    JOIN public.sessions s ON s.id = e.session_id
   WHERE e.id = p_entry_id AND s.owner_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.wheel_entries SET removed_at = NULL WHERE id = p_entry_id;
END;
$$;

REVOKE ALL ON FUNCTION public.restore_wheel_entry(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.restore_wheel_entry(uuid) TO authenticated;

-- spin_wheel: needs an Organizer.
CREATE OR REPLACE FUNCTION public.spin_wheel(p_session_id uuid)
RETURNS TABLE (spin_id uuid, entry_id uuid, label text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_entry public.wheel_entries%ROWTYPE;
  v_active integer;
BEGIN
  IF NOT public.is_organizer() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  -- Locks the session row so two simultaneous Spins are serialised.
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_session.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_session.session_type <> 'wheel' THEN
    RAISE EXCEPTION 'This session is not a Wheel of Fortune';
  END IF;

  SELECT count(*) INTO v_active FROM public.wheel_entries e
   WHERE e.session_id = p_session_id AND e.removed_at IS NULL;
  IF v_active < 2 THEN
    RAISE EXCEPTION 'Add at least 2 entries before spinning';
  END IF;

  SELECT * INTO v_entry FROM public.wheel_entries e
   WHERE e.session_id = p_session_id AND e.removed_at IS NULL
   ORDER BY random() LIMIT 1;

  RETURN QUERY
    INSERT INTO public.wheel_spins AS w (session_id, entry_id, label)
    VALUES (p_session_id, v_entry.id, v_entry.label)
    RETURNING w.id, w.entry_id, w.label, w.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.spin_wheel(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.spin_wheel(uuid) TO authenticated;

-- resolve_wheel_pick: needs an Organizer.
CREATE OR REPLACE FUNCTION public.resolve_wheel_pick(p_spin_id uuid, p_remove boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_spin public.wheel_spins%ROWTYPE;
  v_session public.sessions%ROWTYPE;
  v_latest uuid;
BEGIN
  IF NOT public.is_organizer() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT s.* INTO v_session FROM public.sessions s
   WHERE s.id = (SELECT w.session_id FROM public.wheel_spins w WHERE w.id = p_spin_id)
     AND s.owner_id = auth.uid()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_session.session_type <> 'wheel' THEN
    RAISE EXCEPTION 'This session is not a Wheel of Fortune';
  END IF;
  SELECT * INTO v_spin FROM public.wheel_spins w WHERE w.id = p_spin_id;
  IF v_spin.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'This Pick has already been resolved';
  END IF;
  SELECT w.id INTO v_latest FROM public.wheel_spins w
   WHERE w.session_id = v_spin.session_id
   ORDER BY w.created_at DESC, w.id DESC LIMIT 1;
  IF v_latest IS DISTINCT FROM p_spin_id THEN
    RAISE EXCEPTION 'Only the latest Spin can be resolved';
  END IF;
  IF p_remove IS TRUE THEN
    UPDATE public.wheel_entries SET removed_at = coalesce(removed_at, now()) WHERE id = v_spin.entry_id;
    UPDATE public.wheel_spins SET removed = true WHERE id = p_spin_id;
  END IF;
  UPDATE public.wheel_spins SET resolved_at = now() WHERE id = p_spin_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_wheel_pick(uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_wheel_pick(uuid, boolean) TO authenticated;

-- reset_wheel: needs an Organizer.
CREATE OR REPLACE FUNCTION public.reset_wheel(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
BEGIN
  IF NOT public.is_organizer() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_session.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_session.session_type <> 'wheel' THEN
    RAISE EXCEPTION 'This session is not a Wheel of Fortune';
  END IF;
  DELETE FROM public.wheel_spins WHERE session_id = p_session_id;
  UPDATE public.wheel_entries SET removed_at = NULL
   WHERE session_id = p_session_id AND removed_at IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_wheel(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reset_wheel(uuid) TO authenticated;

-- remove_participant: needs an Organizer.
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
  IF v_session.session_type NOT IN ('quiz', 'comments') THEN
    RAISE EXCEPTION 'Participants can only be removed from a quiz or comments session';
  END IF;

  DELETE FROM public.participants WHERE id = p_participant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_participant(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.remove_participant(uuid) TO authenticated;

-- delete_comment: needs an Organizer.
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
  IF NOT public.is_organizer() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  DELETE FROM public.comments WHERE id = p_comment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_comment(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_comment(uuid) TO authenticated;

-- get_clearable_counts: needs an Organizer.
CREATE OR REPLACE FUNCTION public.get_clearable_counts(p_session_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
BEGIN
  IF NOT public.is_organizer() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_session.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN json_build_object(
    'participants', (SELECT count(*) FROM public.participants WHERE session_id = p_session_id),
    'votes', (SELECT count(*) FROM public.votes v
                JOIN public.questions q ON q.id = v.question_id
               WHERE q.session_id = p_session_id),
    'comments', (SELECT count(*) FROM public.comments c
                   JOIN public.questions q ON q.id = c.question_id
                  WHERE q.session_id = p_session_id),
    'spins', (SELECT count(*) FROM public.wheel_spins WHERE session_id = p_session_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_clearable_counts(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_clearable_counts(uuid) TO authenticated;

-- clear_session_responses: needs an Organizer.
CREATE OR REPLACE FUNCTION public.clear_session_responses(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
BEGIN
  IF NOT public.is_organizer() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_session.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_session.session_type = 'treasure_hunt' THEN
    RAISE EXCEPTION 'A treasure hunt has no responses to clear';
  END IF;

  DELETE FROM public.votes
   WHERE question_id IN (SELECT id FROM public.questions WHERE session_id = p_session_id);
  DELETE FROM public.wheel_spins WHERE session_id = p_session_id;
  -- Cascades to comments, identified votes and joined wheel Entries.
  DELETE FROM public.participants WHERE session_id = p_session_id;

  UPDATE public.wheel_entries SET removed_at = NULL
   WHERE session_id = p_session_id AND removed_at IS NOT NULL;

  IF v_session.is_scored THEN
    UPDATE public.questions SET opened_at = NULL, revealed_at = NULL
     WHERE session_id = p_session_id;
    UPDATE public.sessions
       SET current_question_index = CASE WHEN current_question_index IS NULL THEN NULL ELSE -1 END,
           results_revealed = false,
           show_leaderboard = false,
           scored_closed = false
     WHERE id = p_session_id;
  END IF;

  UPDATE public.sessions SET responses_cleared_at = now() WHERE id = p_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_session_responses(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.clear_session_responses(uuid) TO authenticated;

-- Attendee paths: refused when the session owner has no access.

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
  IF NOT public.owner_has_access(v_session.owner_id) THEN
    RAISE EXCEPTION 'This session is closed';
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
  IF NOT public.owner_has_access(v_session.owner_id) THEN
    RAISE EXCEPTION 'This session is closed';
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

CREATE OR REPLACE FUNCTION public.submit_identified_vote(
  p_join_token text,
  p_question_id uuid,
  p_option_id uuid
)
RETURNS TABLE (
  recorded_option_id uuid,
  recorded boolean,
  is_correct boolean,
  awarded_points integer,
  total_score integer,
  answered_count integer,
  finished_at timestamptz,
  time_up boolean,
  closed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- Covers network latency between a phone's last tap and the server.
  c_grace CONSTANT interval := interval '1 second';
  v_participant public.participants%ROWTYPE;
  v_session public.sessions%ROWTYPE;
  v_question public.questions%ROWTYPE;
  v_existing public.votes%ROWTYPE;
  v_score integer;
  v_answered integer;
  v_finished timestamptz;
BEGIN
  SELECT * INTO v_participant FROM public.participants WHERE join_token = p_join_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown participant';
  END IF;

  SELECT * INTO v_session FROM public.sessions WHERE id = v_participant.session_id;
  IF NOT FOUND OR v_session.is_active = false THEN
    RAISE EXCEPTION 'This session is not active';
  END IF;
  IF NOT public.owner_has_access(v_session.owner_id) THEN
    RAISE EXCEPTION 'This session is closed';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.options WHERE id = p_option_id AND question_id = p_question_id
  ) THEN
    RAISE EXCEPTION 'That option does not belong to the question';
  END IF;

  IF v_session.is_scored THEN
    IF v_session.scored_closed THEN
      RETURN QUERY SELECT NULL::uuid, false, NULL::boolean, 0, v_participant.score,
        v_participant.answered_count, v_participant.finished_at, false, true;
      RETURN;
    END IF;

    SELECT * INTO v_question FROM public.questions WHERE id = p_question_id;
    IF v_session.current_question_index IS NULL
       OR v_question.order_index IS DISTINCT FROM v_session.current_question_index
       OR v_session.results_revealed THEN
      RAISE EXCEPTION 'This question is not open for answers';
    END IF;
  END IF;

  -- Locked before: return the stored row and never lock twice.
  SELECT * INTO v_existing FROM public.votes v
   WHERE v.question_id = p_question_id AND v.participant_id = v_participant.id;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.option_id, false, v_existing.is_correct,
      v_existing.awarded_points, v_participant.score, v_participant.answered_count,
      v_participant.finished_at, false, v_session.scored_closed;
    RETURN;
  END IF;

  -- Past the Time limit: refuse. Questions with no open time have no deadline.
  IF v_session.is_scored
     AND v_question.opened_at IS NOT NULL
     AND now() > v_question.opened_at + make_interval(secs => v_question.time_limit_seconds) + c_grace
  THEN
    RETURN QUERY SELECT NULL::uuid, false, NULL::boolean, 0, v_participant.score,
      v_participant.answered_count, v_participant.finished_at, true, false;
    RETURN;
  END IF;

  INSERT INTO public.votes (option_id, question_id, voter_token, participant_id, is_correct, awarded_points)
  VALUES (p_option_id, p_question_id, v_participant.id::text, v_participant.id, NULL, 0);

  UPDATE public.participants p
     SET answered_count = p.answered_count + 1,
         finished_at = CASE
           WHEN p.finished_at IS NOT NULL THEN p.finished_at
           WHEN p.answered_count + 1 >= (
             SELECT count(*) FROM public.questions q WHERE q.session_id = v_participant.session_id
           ) THEN now()
           ELSE NULL
         END
   WHERE p.id = v_participant.id
  RETURNING p.score, p.answered_count, p.finished_at INTO v_score, v_answered, v_finished;

  RETURN QUERY SELECT p_option_id, true, NULL::boolean, 0, v_score, v_answered, v_finished, false, false;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_identified_vote(text, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_identified_vote(text, uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.start_scored_session(p_join_token text)
RETURNS TABLE (started_at timestamptz, deadline timestamptz, question_count integer, total_points integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_participant public.participants%ROWTYPE;
  v_session public.sessions%ROWTYPE;
  v_started timestamptz;
  v_count integer;
  v_total integer;
BEGIN
  SELECT * INTO v_participant FROM public.participants WHERE join_token = p_join_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown participant';
  END IF;

  SELECT * INTO v_session FROM public.sessions WHERE id = v_participant.session_id;
  IF NOT FOUND OR v_session.is_active = false THEN
    RAISE EXCEPTION 'This session is not active';
  END IF;
  IF NOT public.owner_has_access(v_session.owner_id) THEN
    RAISE EXCEPTION 'This session is closed';
  END IF;
  IF NOT v_session.is_scored THEN
    RAISE EXCEPTION 'This session is not scored';
  END IF;
  IF v_session.scored_closed THEN
    RAISE EXCEPTION 'This quiz is closed';
  END IF;

  v_started := coalesce(v_participant.started_at, now());
  IF v_participant.started_at IS NULL THEN
    UPDATE public.participants SET started_at = v_started WHERE id = v_participant.id;
  END IF;

  SELECT count(*), coalesce(sum(points), 0) INTO v_count, v_total
  FROM public.questions WHERE session_id = v_session.id;

  RETURN QUERY SELECT
    v_started,
    CASE WHEN v_session.score_time_limit_seconds IS NULL THEN NULL
         ELSE v_started + make_interval(secs => v_session.score_time_limit_seconds) END,
    v_count,
    v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.start_scored_session(text) FROM public;
GRANT EXECUTE ON FUNCTION public.start_scored_session(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_comment(
  p_join_token text,
  p_question_id uuid,
  p_body text
)
RETURNS TABLE (comment_id uuid, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_participant public.participants%ROWTYPE;
  v_session public.sessions%ROWTYPE;
  v_question public.questions%ROWTYPE;
  v_body text := btrim(coalesce(p_body, ''));
  v_index integer;
  v_id uuid;
  v_created timestamptz;
BEGIN
  SELECT * INTO v_participant FROM public.participants WHERE join_token = p_join_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown participant';
  END IF;

  SELECT * INTO v_session FROM public.sessions WHERE id = v_participant.session_id;
  IF NOT FOUND OR v_session.is_active = false THEN
    RAISE EXCEPTION 'This session is not active';
  END IF;
  IF NOT public.owner_has_access(v_session.owner_id) THEN
    RAISE EXCEPTION 'This session is closed';
  END IF;
  IF v_session.session_type <> 'comments' THEN
    RAISE EXCEPTION 'This session does not accept comments';
  END IF;

  SELECT * INTO v_question FROM public.questions
   WHERE id = p_question_id AND session_id = v_session.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That image does not belong to this session';
  END IF;

  IF char_length(v_body) < 1 OR char_length(v_body) > 500 THEN
    RAISE EXCEPTION 'A comment must be between 1 and 500 characters';
  END IF;

  -- Presenter-driven session: only the question currently on screen accepts
  -- comments. Self-paced sessions (current_question_index IS NULL) accept a
  -- comment on any of the session's own questions.
  --
  -- The position must be computed over ALL of the session's questions before
  -- filtering to p_question_id - filtering first would leave a one-row set,
  -- where row_number() always returns 1 (index 0) regardless of the
  -- question's real order, making every image past the first fail this check.
  IF v_session.current_question_index IS NOT NULL THEN
    SELECT sub.idx INTO v_index FROM (
      SELECT id, (row_number() OVER (ORDER BY order_index) - 1) AS idx
      FROM public.questions WHERE session_id = v_session.id
    ) sub WHERE sub.id = p_question_id;

    IF v_index IS DISTINCT FROM v_session.current_question_index THEN
      RAISE EXCEPTION 'This image is not currently open for comments';
    END IF;
  END IF;

  INSERT INTO public.comments (question_id, participant_id, body)
  VALUES (p_question_id, v_participant.id, v_body)
  RETURNING id, comments.created_at INTO v_id, v_created;

  RETURN QUERY SELECT v_id, v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_comment(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_comment(text, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_clue(p_token text)
RETURNS TABLE (
  status text,
  clue_message text,
  clue_number integer,
  session_title text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
DECLARE
  v_question public.questions;
  v_session public.sessions;
BEGIN
  SELECT * INTO v_question FROM public.questions WHERE clue_token = p_token;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'missing'::text, NULL::text, NULL::integer, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_session FROM public.sessions WHERE id = v_question.session_id;
  IF NOT FOUND OR v_session.session_type <> 'treasure_hunt' THEN
    RETURN QUERY SELECT 'missing'::text, NULL::text, NULL::integer, NULL::text;
    RETURN;
  END IF;

  IF NOT v_session.is_active THEN
    RETURN QUERY SELECT 'not_live'::text, NULL::text, v_question.order_index + 1, v_session.title;
    RETURN;
  END IF;

  IF NOT public.owner_has_access(v_session.owner_id) THEN
    RETURN QUERY SELECT 'closed'::text, NULL::text, v_question.order_index + 1, v_session.title;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'live'::text, v_question.text, v_question.order_index + 1, v_session.title;
END;
$$;

REVOKE ALL ON FUNCTION public.get_clue(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_clue(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_wheel_latest_pick(p_join_token text)
RETURNS TABLE (spin_id uuid, label text, picked_at timestamptz, is_you boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_participant public.participants%ROWTYPE;
BEGIN
  SELECT * INTO v_participant FROM public.participants WHERE join_token = p_join_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown participant';
  END IF;

  -- A lapsed owner's wheel stops showing picks on phones.
  IF NOT public.owner_has_access(
       (SELECT s.owner_id FROM public.sessions s WHERE s.id = v_participant.session_id)) THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT w.id, w.label, w.created_at,
           coalesce(w.entry_id = (SELECT e.id FROM public.wheel_entries e
                                   WHERE e.participant_id = v_participant.id), false)
      FROM public.wheel_spins w
     WHERE w.session_id = v_participant.session_id
       AND w.created_at <= clock_timestamp() - interval '7 seconds'
     ORDER BY w.created_at DESC, w.id DESC
     LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_wheel_latest_pick(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_wheel_latest_pick(text) TO anon, authenticated;
