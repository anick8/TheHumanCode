-- ============================================================================
-- 35. Treasure Hunt: Clue choices
-- ============================================================================

-- A clue may offer 2-4 buttons; tapping one reveals organizer-written text
-- (the further clue). Choices are reveal text, not links between clues, so
-- clues stay unchained and nothing is recorded about who tapped what.
-- Stored as [{"label": "...", "reveal": "..."}]; NULL means no choices.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS clue_choices jsonb;

CREATE OR REPLACE FUNCTION public.clue_choices_valid(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p IS NULL THEN true
    WHEN jsonb_typeof(p) <> 'array' THEN false
    WHEN jsonb_array_length(p) NOT BETWEEN 2 AND 4 THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p) AS e
      WHERE jsonb_typeof(e) <> 'object'
        OR jsonb_typeof(e -> 'label') IS DISTINCT FROM 'string'
        OR jsonb_typeof(e -> 'reveal') IS DISTINCT FROM 'string'
        OR char_length(btrim(e ->> 'label')) NOT BETWEEN 1 AND 40
        OR char_length(btrim(e ->> 'reveal')) NOT BETWEEN 1 AND 500
    )
  END;
$$;

ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_clue_choices_valid;
ALTER TABLE questions ADD CONSTRAINT questions_clue_choices_valid
  CHECK (public.clue_choices_valid(clue_choices));

-- get_clue now also returns the button labels (never the reveal text, which
-- only reveal_clue_choice() hands out, one choice at a time). The return
-- type changes, so the function is dropped and recreated.
DROP FUNCTION IF EXISTS public.get_clue(text);

CREATE FUNCTION public.get_clue(p_token text)
RETURNS TABLE (
  status text,
  clue_message text,
  clue_number integer,
  session_title text,
  choices jsonb
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
    RETURN QUERY SELECT 'missing'::text, NULL::text, NULL::integer, NULL::text, NULL::jsonb;
    RETURN;
  END IF;

  SELECT * INTO v_session FROM public.sessions WHERE id = v_question.session_id;
  IF NOT FOUND OR v_session.session_type <> 'treasure_hunt' THEN
    RETURN QUERY SELECT 'missing'::text, NULL::text, NULL::integer, NULL::text, NULL::jsonb;
    RETURN;
  END IF;

  IF NOT v_session.is_active THEN
    RETURN QUERY SELECT 'not_live'::text, NULL::text, v_question.order_index + 1, v_session.title, NULL::jsonb;
    RETURN;
  END IF;

  IF NOT public.owner_has_access(v_session.owner_id) THEN
    RETURN QUERY SELECT 'closed'::text, NULL::text, v_question.order_index + 1, v_session.title, NULL::jsonb;
    RETURN;
  END IF;

  IF v_question.clue_choices IS NOT NULL THEN
    SELECT jsonb_agg(t.e -> 'label' ORDER BY t.ord) INTO v_labels
    FROM jsonb_array_elements(v_question.clue_choices) WITH ORDINALITY AS t(e, ord);
  END IF;

  RETURN QUERY SELECT 'live'::text, v_question.text, v_question.order_index + 1, v_session.title, v_labels;
END;
$$;

REVOKE ALL ON FUNCTION public.get_clue(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_clue(text) TO anon, authenticated;

-- Reveals one choice's text (p_index is 0-based, matching the order of the
-- labels get_clue returned). Same live/closed gate as get_clue; nothing is
-- stored about the tap.
CREATE OR REPLACE FUNCTION public.reveal_clue_choice(p_token text, p_index integer)
RETURNS TABLE (status text, reveal text)
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
    RETURN QUERY SELECT 'missing'::text, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_session FROM public.sessions WHERE id = v_question.session_id;
  IF NOT FOUND OR v_session.session_type <> 'treasure_hunt' THEN
    RETURN QUERY SELECT 'missing'::text, NULL::text;
    RETURN;
  END IF;

  IF NOT v_session.is_active THEN
    RETURN QUERY SELECT 'not_live'::text, NULL::text;
    RETURN;
  END IF;

  IF NOT public.owner_has_access(v_session.owner_id) THEN
    RETURN QUERY SELECT 'closed'::text, NULL::text;
    RETURN;
  END IF;

  IF v_question.clue_choices IS NULL
     OR p_index IS NULL
     OR p_index < 0
     OR p_index >= jsonb_array_length(v_question.clue_choices) THEN
    RETURN QUERY SELECT 'missing'::text, NULL::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'live'::text, v_question.clue_choices -> p_index ->> 'reveal';
END;
$$;

REVOKE ALL ON FUNCTION public.reveal_clue_choice(text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.reveal_clue_choice(text, integer) TO anon, authenticated;
