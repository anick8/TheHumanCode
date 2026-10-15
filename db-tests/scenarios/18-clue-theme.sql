-- Ticket: get_clue returns the session's theme so the public clue page can be
-- branded. It does so for live, not-live and closed clues, and NULL for an
-- unknown token.
\ir ../helpers.sql
BEGIN;

DO $$
DECLARE
  v_owner uuid := pg_temp.make_user('owner');
  v_hunt uuid := gen_random_uuid();
  v_status text;
  v_theme jsonb;
BEGIN
  PERFORM pg_temp.grant_to(v_owner, now() - interval '5 days', now() + interval '1 day');
  INSERT INTO public.sessions (id, owner_id, title, slug, session_type, participation_mode, is_scored, is_active, theme)
  VALUES (v_hunt, v_owner, 'H', 'h-' || v_hunt, 'treasure_hunt', 'anonymous', false, false,
          '{"primary":"#2563eb","background":"#f8fafc"}');
  INSERT INTO public.questions (session_id, text, order_index, clue_token)
  VALUES (v_hunt, 'Clue', 0, 'theme-' || v_hunt);

  SELECT c.status, c.theme INTO v_status, v_theme FROM public.get_clue('theme-' || v_hunt) c;
  IF v_status <> 'not_live' OR v_theme ->> 'primary' <> '#2563eb' THEN
    RAISE EXCEPTION 'not_live theme: % / %', v_status, v_theme;
  END IF;

  UPDATE public.sessions SET is_active = true WHERE id = v_hunt;
  SELECT c.status, c.theme INTO v_status, v_theme FROM public.get_clue('theme-' || v_hunt) c;
  IF v_status <> 'live' OR v_theme ->> 'background' <> '#f8fafc' THEN
    RAISE EXCEPTION 'live theme: % / %', v_status, v_theme;
  END IF;

  PERFORM pg_temp.grant_to(v_owner, now() - interval '5 days', now() - interval '7 hours');
  SELECT c.status, c.theme INTO v_status, v_theme FROM public.get_clue('theme-' || v_hunt) c;
  IF v_status <> 'closed' OR v_theme ->> 'primary' <> '#2563eb' THEN
    RAISE EXCEPTION 'closed theme: % / %', v_status, v_theme;
  END IF;

  SELECT c.status, c.theme INTO v_status, v_theme FROM public.get_clue('nope-' || v_hunt) c;
  IF v_status <> 'missing' OR v_theme IS NOT NULL THEN
    RAISE EXCEPTION 'missing theme: % / %', v_status, v_theme;
  END IF;
END $$;

ROLLBACK;
