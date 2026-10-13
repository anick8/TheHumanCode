-- Ticket: Treasure Hunt clue choices. A clue may carry 2-4 {label, reveal}
-- choices. get_clue hands out the labels only; reveal_clue_choice hands out
-- one reveal at a time, under the same live/closed gate as get_clue.
\ir ../helpers.sql
BEGIN;

DO $$
DECLARE
  v_owner uuid := pg_temp.make_user('owner');
  v_hunt uuid := gen_random_uuid();
  v_q uuid := gen_random_uuid();
  v_plain uuid := gen_random_uuid();
  v_status text;
  v_message text;
  v_choices jsonb;
  v_reveal text;
  v_err text;
BEGIN
  PERFORM pg_temp.grant_to(v_owner, now() - interval '5 days', now() + interval '1 day');
  INSERT INTO public.sessions (id, owner_id, title, slug, session_type, participation_mode, is_scored, is_active)
  VALUES (v_hunt, v_owner, 'H', 'h-' || v_hunt, 'treasure_hunt', 'anonymous', false, false);
  INSERT INTO public.questions (id, session_id, text, order_index, clue_token, clue_choices) VALUES
    (v_q, v_hunt, 'Fork in the road', 0, 'fork-' || v_hunt,
     '[{"label":"Left","reveal":"Try the library"},{"label":"Right","reveal":"Try the fountain"}]'),
    (v_plain, v_hunt, 'Plain clue', 1, 'plain-' || v_hunt, NULL);

  -- Constraint: 2-4 choices, non-empty bounded label and reveal.
  v_err := pg_temp.error_of(format(
    'UPDATE public.questions SET clue_choices = %L WHERE id = %L',
    '[{"label":"Only","reveal":"one"}]', v_q));
  IF v_err IS NULL THEN RAISE EXCEPTION 'one choice accepted'; END IF;
  v_err := pg_temp.error_of(format(
    'UPDATE public.questions SET clue_choices = %L WHERE id = %L',
    '[{"label":"a","reveal":"1"},{"label":"b","reveal":"2"},{"label":"c","reveal":"3"},{"label":"d","reveal":"4"},{"label":"e","reveal":"5"}]', v_q));
  IF v_err IS NULL THEN RAISE EXCEPTION 'five choices accepted'; END IF;
  v_err := pg_temp.error_of(format(
    'UPDATE public.questions SET clue_choices = %L WHERE id = %L',
    '[{"label":"  ","reveal":"x"},{"label":"b","reveal":"y"}]', v_q));
  IF v_err IS NULL THEN RAISE EXCEPTION 'blank label accepted'; END IF;
  v_err := pg_temp.error_of(format(
    'UPDATE public.questions SET clue_choices = %L WHERE id = %L',
    '[{"label":"a","reveal":""},{"label":"b","reveal":"y"}]', v_q));
  IF v_err IS NULL THEN RAISE EXCEPTION 'empty reveal accepted'; END IF;
  v_err := pg_temp.error_of(format(
    'UPDATE public.questions SET clue_choices = %L WHERE id = %L',
    jsonb_build_array(jsonb_build_object('label', repeat('x', 41), 'reveal', 'y'),
                      jsonb_build_object('label', 'b', 'reveal', 'y'))::text, v_q));
  IF v_err IS NULL THEN RAISE EXCEPTION '41-char label accepted'; END IF;
  v_err := pg_temp.error_of(format(
    'UPDATE public.questions SET clue_choices = %L WHERE id = %L', '{"label":"a"}', v_q));
  IF v_err IS NULL THEN RAISE EXCEPTION 'non-array accepted'; END IF;

  -- Inactive hunt: nothing is revealed.
  SELECT c.status, c.choices INTO v_status, v_choices FROM public.get_clue('fork-' || v_hunt) c;
  IF v_status <> 'not_live' OR v_choices IS NOT NULL THEN
    RAISE EXCEPTION 'inactive hunt: % / %', v_status, v_choices;
  END IF;
  SELECT r.status, r.reveal INTO v_status, v_reveal FROM public.reveal_clue_choice('fork-' || v_hunt, 0) r;
  IF v_status <> 'not_live' OR v_reveal IS NOT NULL THEN
    RAISE EXCEPTION 'inactive reveal: % / %', v_status, v_reveal;
  END IF;

  UPDATE public.sessions SET is_active = true WHERE id = v_hunt;

  -- Live: labels only, in order; reveal text never appears in get_clue.
  SELECT c.status, c.clue_message, c.choices INTO v_status, v_message, v_choices
  FROM public.get_clue('fork-' || v_hunt) c;
  IF v_status <> 'live' OR v_message <> 'Fork in the road' THEN
    RAISE EXCEPTION 'live clue: % / %', v_status, v_message;
  END IF;
  IF v_choices IS DISTINCT FROM '["Left","Right"]'::jsonb THEN
    RAISE EXCEPTION 'choices should be labels only, got %', v_choices;
  END IF;

  -- A clue without choices is unchanged.
  SELECT c.status, c.choices INTO v_status, v_choices FROM public.get_clue('plain-' || v_hunt) c;
  IF v_status <> 'live' OR v_choices IS NOT NULL THEN
    RAISE EXCEPTION 'plain clue: % / %', v_status, v_choices;
  END IF;
  SELECT r.status INTO v_status FROM public.reveal_clue_choice('plain-' || v_hunt, 0) r;
  IF v_status <> 'missing' THEN RAISE EXCEPTION 'plain reveal should be missing, got %', v_status; END IF;

  -- Reveal returns exactly the chosen text.
  SELECT r.status, r.reveal INTO v_status, v_reveal FROM public.reveal_clue_choice('fork-' || v_hunt, 0) r;
  IF v_status <> 'live' OR v_reveal <> 'Try the library' THEN
    RAISE EXCEPTION 'reveal 0: % / %', v_status, v_reveal;
  END IF;
  SELECT r.status, r.reveal INTO v_status, v_reveal FROM public.reveal_clue_choice('fork-' || v_hunt, 1) r;
  IF v_status <> 'live' OR v_reveal <> 'Try the fountain' THEN
    RAISE EXCEPTION 'reveal 1: % / %', v_status, v_reveal;
  END IF;

  -- Out-of-range, negative, null index and unknown token.
  SELECT r.status, r.reveal INTO v_status, v_reveal FROM public.reveal_clue_choice('fork-' || v_hunt, 2) r;
  IF v_status <> 'missing' OR v_reveal IS NOT NULL THEN RAISE EXCEPTION 'index 2: % / %', v_status, v_reveal; END IF;
  SELECT r.status INTO v_status FROM public.reveal_clue_choice('fork-' || v_hunt, -1) r;
  IF v_status <> 'missing' THEN RAISE EXCEPTION 'index -1: %', v_status; END IF;
  SELECT r.status INTO v_status FROM public.reveal_clue_choice('fork-' || v_hunt, NULL) r;
  IF v_status <> 'missing' THEN RAISE EXCEPTION 'null index: %', v_status; END IF;
  SELECT r.status INTO v_status FROM public.reveal_clue_choice('nope', 0) r;
  IF v_status <> 'missing' THEN RAISE EXCEPTION 'unknown token: %', v_status; END IF;

  -- A signed-out phone can call both and still cannot read the table.
  SET LOCAL ROLE anon;
  SELECT c.status, c.choices INTO v_status, v_choices FROM public.get_clue('fork-' || v_hunt) c;
  IF v_status <> 'live' OR jsonb_array_length(v_choices) <> 2 THEN
    RAISE EXCEPTION 'anon get_clue: % / %', v_status, v_choices;
  END IF;
  SELECT r.status, r.reveal INTO v_status, v_reveal FROM public.reveal_clue_choice('fork-' || v_hunt, 1) r;
  IF v_status <> 'live' OR v_reveal <> 'Try the fountain' THEN
    RAISE EXCEPTION 'anon reveal: % / %', v_status, v_reveal;
  END IF;
  IF EXISTS (SELECT 1 FROM public.questions WHERE session_id = v_hunt) THEN
    RAISE EXCEPTION 'anon can read hunt questions directly';
  END IF;
  RESET ROLE;

  -- Lapsed owner (past grace): closed, nothing revealed.
  PERFORM pg_temp.grant_to(v_owner, now() - interval '5 days', now() - interval '7 hours');
  SELECT c.status, c.clue_message, c.choices INTO v_status, v_message, v_choices
  FROM public.get_clue('fork-' || v_hunt) c;
  IF v_status <> 'closed' OR v_message IS NOT NULL OR v_choices IS NOT NULL THEN
    RAISE EXCEPTION 'lapsed clue: % / % / %', v_status, v_message, v_choices;
  END IF;
  SELECT r.status, r.reveal INTO v_status, v_reveal FROM public.reveal_clue_choice('fork-' || v_hunt, 0) r;
  IF v_status <> 'closed' OR v_reveal IS NOT NULL THEN
    RAISE EXCEPTION 'lapsed reveal: % / %', v_status, v_reveal;
  END IF;
END $$;

ROLLBACK;
