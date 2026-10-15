-- Ticket: optional "are you sure?" before a clue choice is revealed.
-- get_clue exposes confirm_choice only for a live clue that has choices.
\ir ../helpers.sql
BEGIN;

DO $$
DECLARE
  v_owner uuid := pg_temp.make_user('owner');
  v_hunt uuid := gen_random_uuid();
  v_status text;
  v_confirm boolean;
  v_default boolean;
BEGIN
  PERFORM pg_temp.grant_to(v_owner, now() - interval '5 days', now() + interval '1 day');
  INSERT INTO public.sessions (id, owner_id, title, slug, session_type, participation_mode, is_scored, is_active)
  VALUES (v_hunt, v_owner, 'H', 'h-' || v_hunt, 'treasure_hunt', 'anonymous', false, false);
  INSERT INTO public.questions (id, session_id, text, order_index, clue_token, clue_choices, clue_confirm_choice) VALUES
    (gen_random_uuid(), v_hunt, 'On', 0, 'on-' || v_hunt,
     '[{"label":"L","reveal":"a"},{"label":"R","reveal":"b"}]', true),
    (gen_random_uuid(), v_hunt, 'Off', 1, 'off-' || v_hunt,
     '[{"label":"L","reveal":"a"},{"label":"R","reveal":"b"}]', false),
    (gen_random_uuid(), v_hunt, 'NoChoices', 2, 'none-' || v_hunt, NULL, true);

  SELECT clue_confirm_choice INTO v_default FROM public.questions
  WHERE clue_token = 'off-' || v_hunt;
  IF v_default IS NOT false THEN RAISE EXCEPTION 'flag should store false'; END IF;

  -- Not live: nothing is exposed.
  SELECT c.status, c.confirm_choice INTO v_status, v_confirm FROM public.get_clue('on-' || v_hunt) c;
  IF v_status <> 'not_live' OR v_confirm IS NOT NULL THEN
    RAISE EXCEPTION 'inactive: % / %', v_status, v_confirm;
  END IF;

  UPDATE public.sessions SET is_active = true WHERE id = v_hunt;

  SELECT c.confirm_choice INTO v_confirm FROM public.get_clue('on-' || v_hunt) c;
  IF v_confirm IS NOT true THEN RAISE EXCEPTION 'flagged clue: %', v_confirm; END IF;

  SELECT c.confirm_choice INTO v_confirm FROM public.get_clue('off-' || v_hunt) c;
  IF v_confirm IS NOT false THEN RAISE EXCEPTION 'unflagged clue: %', v_confirm; END IF;

  SELECT c.confirm_choice INTO v_confirm FROM public.get_clue('none-' || v_hunt) c;
  IF v_confirm IS NOT false THEN RAISE EXCEPTION 'flag without choices: %', v_confirm; END IF;
END $$;

ROLLBACK;
