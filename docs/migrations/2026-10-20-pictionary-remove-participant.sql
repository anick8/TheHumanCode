-- Pictionary: the host can Remove a participant (spec #50, story 24). Same as the existing
-- function plus 'pictionary'. Round, winner and Drawer references are ON DELETE SET NULL, so a
-- removed Drawer leaves the Round recoverable with Pick another Drawer, and Guesses cascade.
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
  IF v_session.session_type NOT IN ('quiz', 'comments', 'pictionary') THEN
    RAISE EXCEPTION 'Participants can only be removed from a quiz, comments or Pictionary session';
  END IF;

  DELETE FROM public.participants WHERE id = p_participant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_participant(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.remove_participant(uuid) TO authenticated;
