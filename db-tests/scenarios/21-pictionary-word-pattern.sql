-- Ticket: public Word pattern (letter blanks) without exposing the Word.
\ir ../helpers.sql
BEGIN;

CREATE FUNCTION pg_temp.pattern_of(p_session uuid) RETURNS text
LANGUAGE sql AS $$ SELECT (pg_temp.latest_round(p_session)).word_pattern $$;

-- NULL while choosing, set after choose; multi-word and punctuation; reset on pick-another-Drawer.
DO $$
DECLARE
  v_session uuid := pg_temp.make_pictionary(E'ice cream\nx-ray\nfish');
  v_w uuid;
  v_r public.pictionary_rounds;
BEGIN
  PERFORM pg_temp.join_as(v_session, 'Ann');
  PERFORM pg_temp.join_as(v_session, 'Ben');
  PERFORM pg_temp.join_as(v_session, 'Cy');
  PERFORM public.start_pictionary_round(v_session);
  IF pg_temp.pattern_of(v_session) IS NOT NULL THEN RAISE EXCEPTION 'pattern set while choosing'; END IF;

  SELECT c.word_id INTO v_w FROM public.get_pictionary_choices(pg_temp.drawer_token(v_session)) c WHERE c.word = 'ice cream';
  PERFORM public.choose_pictionary_word(pg_temp.drawer_token(v_session), v_w);
  IF pg_temp.pattern_of(v_session) IS DISTINCT FROM '___ _____' THEN
    RAISE EXCEPTION 'multi-word pattern wrong: %', pg_temp.pattern_of(v_session);
  END IF;
  IF (pg_temp.latest_round(v_session)).word IS NOT NULL THEN RAISE EXCEPTION 'word exposed while drawing'; END IF;

  PERFORM public.pick_another_pictionary_drawer(v_session);
  IF pg_temp.pattern_of(v_session) IS NOT NULL THEN RAISE EXCEPTION 'pattern survived pick-another'; END IF;

  SELECT c.word_id INTO v_w FROM public.get_pictionary_choices(pg_temp.drawer_token(v_session)) c WHERE c.word = 'x-ray';
  PERFORM public.choose_pictionary_word(pg_temp.drawer_token(v_session), v_w);
  IF pg_temp.pattern_of(v_session) IS DISTINCT FROM '_-___' THEN
    RAISE EXCEPTION 'punctuation pattern wrong: %', pg_temp.pattern_of(v_session);
  END IF;

  -- Public read: anon sees the pattern and a NULL word until the reveal.
  SET LOCAL ROLE anon;
  SELECT * INTO v_r FROM public.pictionary_rounds WHERE session_id = v_session;
  RESET ROLE;
  IF v_r.word_pattern IS DISTINCT FROM '_-___' OR v_r.word IS NOT NULL THEN
    RAISE EXCEPTION 'anon read wrong: pattern %, word %', v_r.word_pattern, v_r.word;
  END IF;

  PERFORM public.skip_pictionary_round(v_session);
  IF (pg_temp.latest_round(v_session)).word IS DISTINCT FROM 'x-ray' THEN RAISE EXCEPTION 'word not revealed'; END IF;
END $$;

-- Auto-pick sets the pattern too.
DO $$
DECLARE
  v_session uuid := pg_temp.make_pictionary(E'cat\ndog\nfish');
BEGIN
  PERFORM pg_temp.join_as(v_session, 'Ann');
  PERFORM pg_temp.join_as(v_session, 'Ben');
  PERFORM public.start_pictionary_round(v_session);
  UPDATE public.pictionary_rounds SET choose_deadline = now() - interval '1 second' WHERE session_id = v_session;
  PERFORM public.auto_pick_pictionary_word(v_session);
  IF pg_temp.pattern_of(v_session) !~ '^_{3,4}$' OR (pg_temp.latest_round(v_session)).word IS NOT NULL THEN
    RAISE EXCEPTION 'auto-pick pattern wrong: %', pg_temp.pattern_of(v_session);
  END IF;
END $$;

ROLLBACK;
