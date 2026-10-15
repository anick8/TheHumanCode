-- Treasure Hunt: the public clue page is branded with the session's Design.

-- get_clue also returns the session's theme (colors, fonts, logo) so the
-- public clue page can wear the organizer's Design. The return type changes,
-- so the function is dropped and recreated.
DROP FUNCTION IF EXISTS public.get_clue(text);

CREATE FUNCTION public.get_clue(p_token text)
RETURNS TABLE (
  status text,
  clue_message text,
  clue_number integer,
  session_title text,
  choices jsonb,
  confirm_choice boolean,
  theme jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
DECLARE
  v_question public.questions;
  v_session public.sessions;
  v_labels jsonb;
BEGIN
  SELECT * INTO v_question FROM public.questions WHERE clue_token = p_token;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'missing'::text, NULL::text, NULL::integer, NULL::text, NULL::jsonb, NULL::boolean, NULL::jsonb;
    RETURN;
  END IF;

  SELECT * INTO v_session FROM public.sessions WHERE id = v_question.session_id;
  IF NOT FOUND OR v_session.session_type <> 'treasure_hunt' THEN
    RETURN QUERY SELECT 'missing'::text, NULL::text, NULL::integer, NULL::text, NULL::jsonb, NULL::boolean, NULL::jsonb;
    RETURN;
  END IF;

  IF NOT v_session.is_active THEN
    RETURN QUERY SELECT 'not_live'::text, NULL::text, v_question.order_index + 1, v_session.title, NULL::jsonb, NULL::boolean, v_session.theme;
    RETURN;
  END IF;

  IF NOT public.owner_has_access(v_session.owner_id) THEN
    RETURN QUERY SELECT 'closed'::text, NULL::text, v_question.order_index + 1, v_session.title, NULL::jsonb, NULL::boolean, v_session.theme;
    RETURN;
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
    v_session.theme;
END;
$$;

REVOKE ALL ON FUNCTION public.get_clue(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_clue(text) TO anon, authenticated;
