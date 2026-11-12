-- Pictionary: public letter blanks. word_pattern is the Word with letters/digits masked
-- as "_" (punctuation kept, whitespace collapsed to single spaces), e.g. "ice cream" -> "___ _____".
-- NULL until a Word is chosen; the Word itself stays hidden until the reveal.
ALTER TABLE public.pictionary_rounds ADD COLUMN IF NOT EXISTS word_pattern text;

CREATE OR REPLACE FUNCTION public.pictionary_word_pattern(p_word text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT regexp_replace(regexp_replace(btrim(p_word), '\w', '_', 'g'), '\s+', ' ', 'g')
$$;
REVOKE ALL ON FUNCTION public.pictionary_word_pattern(text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pictionary_begin_drawing(p_round_id uuid, p_word_id uuid)
RETURNS public.pictionary_rounds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_round public.pictionary_rounds%ROWTYPE;
BEGIN
  UPDATE public.pictionary_words SET used_round_id = p_round_id WHERE id = p_word_id;
  UPDATE public.pictionary_words SET offered_round_id = NULL WHERE offered_round_id = p_round_id;
  UPDATE public.pictionary_rounds r
     SET status = 'drawing', started_at = now(),
         ends_at = now() + make_interval(secs => s.pictionary_round_seconds),
         word_pattern = (SELECT public.pictionary_word_pattern(w.word) FROM public.pictionary_words w WHERE w.id = p_word_id)
    FROM public.sessions s
   WHERE r.id = p_round_id AND s.id = r.session_id
  RETURNING r.* INTO v_round;
  RETURN v_round;
END;
$$;
REVOKE ALL ON FUNCTION public.pictionary_begin_drawing(uuid, uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pick_another_pictionary_drawer(p_session_id uuid, p_drawer_id uuid DEFAULT NULL)
RETURNS public.pictionary_rounds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_round public.pictionary_rounds%ROWTYPE;
  v_drawer uuid := p_drawer_id;
BEGIN
  PERFORM public.pictionary_owned_session(p_session_id);
  SELECT * INTO v_round FROM public.pictionary_rounds WHERE session_id = p_session_id ORDER BY round_number DESC LIMIT 1;
  IF NOT FOUND OR v_round.status = 'revealed' THEN
    RAISE EXCEPTION 'There is no live round to change the drawer of';
  END IF;

  IF v_drawer IS NULL THEN
    v_drawer := public.pictionary_pick_drawer(p_session_id, v_round.drawer_id);
    IF v_drawer IS NULL THEN
      RAISE EXCEPTION 'There is no other participant to draw';
    END IF;
  ELSIF v_drawer IS NOT DISTINCT FROM v_round.drawer_id THEN
    RAISE EXCEPTION 'That participant is already the drawer';
  ELSIF NOT EXISTS (SELECT 1 FROM public.participants WHERE id = v_drawer AND session_id = p_session_id) THEN
    RAISE EXCEPTION 'That participant is not in this session';
  END IF;

  UPDATE public.pictionary_words SET used_round_id = NULL WHERE used_round_id = v_round.id;
  UPDATE public.pictionary_rounds
     SET drawer_id = v_drawer, status = 'choosing', started_at = NULL, ends_at = NULL,
         word_pattern = NULL, choose_deadline = now() + interval '15 seconds'
   WHERE id = v_round.id
  RETURNING * INTO v_round;
  PERFORM public.pictionary_offer_words(v_round.id);
  RETURN v_round;
END;
$$;
REVOKE ALL ON FUNCTION public.pick_another_pictionary_drawer(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pick_another_pictionary_drawer(uuid, uuid) TO authenticated;
