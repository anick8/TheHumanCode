-- ============================================================================
-- 27. Clear responses
-- ============================================================================

-- The host's "Clear" action wipes what the audience produced (Participants,
-- Votes, Comments, joined wheel Entries, Spins) and keeps what the host
-- authored (Questions, Options, images, answer keys, manual wheel Entries,
-- theme and settings). responses_cleared_at lets open phones tell a Clear
-- apart from an individual removal: after a Clear they quietly return to the
-- join form (or, in a Poll, to an open question) instead of a "removed" screen.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS responses_cleared_at timestamptz;

-- get_clearable_counts: what a Clear would delete, for the confirm dialog.
CREATE OR REPLACE FUNCTION public.get_clearable_counts(p_session_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
BEGIN
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

-- clear_session_responses: the Clear itself. Hard delete, one transaction.
-- Votes go first so the scored-quiz structure locks are already lifted.
-- A quiz is also rewound to not-started; the other settings are untouched.
CREATE OR REPLACE FUNCTION public.clear_session_responses(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
BEGIN
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
