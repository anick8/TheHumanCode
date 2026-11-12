-- ============================================================================
-- Pictionary review fixes: plural matching, Round timing, swap and race fixes
-- ============================================================================

-- ---- matching ---------------------------------------------------------------
-- Lowercase and strip punctuation (shared by norm and the word splitter).
CREATE OR REPLACE FUNCTION public.pictionary_clean(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT btrim(regexp_replace(lower(coalesce(p_text, '')), '[^[:alnum:][:space:]]', '', 'g'))
$$;

-- Clean, optionally drop a leading a/an/the, remove spaces. No plural stripping:
-- pictionary_forms adds those so both sides are compared with and without it.
CREATE OR REPLACE FUNCTION public.pictionary_norm(p_text text, p_drop_article boolean)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_s text := public.pictionary_clean(p_text);
BEGIN
  IF p_drop_article THEN
    v_s := regexp_replace(v_s, '^(a|an|the)\s+', '');
  END IF;
  RETURN regexp_replace(v_s, '\s+', '', 'g');
END;
$$;

-- The string plus its singular guesses (drop s, drop es). A stem under 3 letters
-- is never produced, so "bus" is not "bu" and short words stay strict.
CREATE OR REPLACE FUNCTION public.pictionary_forms(p_s text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[p_s]
      || CASE WHEN p_s ~ 's$' AND char_length(p_s) >= 4 THEN ARRAY[left(p_s, -1)] ELSE ARRAY[]::text[] END
      || CASE WHEN p_s ~ 'es$' AND char_length(p_s) >= 5 THEN ARRAY[left(p_s, -2)] ELSE ARRAY[]::text[] END
$$;

-- Does the Guess match the Word? Equal (with or without a plural), or within the
-- typo allowance (0 for up to 4 letters, 1 for 5-8, 2 for 9+). A Guess of up to 5
-- words also matches on any single word or any adjacent pair.
CREATE OR REPLACE FUNCTION public.pictionary_matches(p_guess text, p_word text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_word text := public.pictionary_norm(p_word, true);
  v_wforms text[] := public.pictionary_forms(v_word);
  v_allow integer;
  v_words text[] := regexp_split_to_array(public.pictionary_clean(p_guess), '\s+');
  v_cands text[] := ARRAY[public.pictionary_norm(p_guess, true)];
  v_c text;
  v_cf text;
  v_wf text;
BEGIN
  IF v_word = '' THEN RETURN false; END IF;
  v_allow := CASE WHEN char_length(v_word) <= 4 THEN 0 WHEN char_length(v_word) <= 8 THEN 1 ELSE 2 END;
  IF array_length(v_words, 1) BETWEEN 2 AND 5 THEN
    FOR i IN 1..array_length(v_words, 1) LOOP
      v_cands := v_cands || public.pictionary_norm(v_words[i], false);
      IF i < array_length(v_words, 1) THEN
        v_cands := v_cands || public.pictionary_norm(v_words[i] || v_words[i + 1], false);
      END IF;
    END LOOP;
  END IF;
  FOREACH v_c IN ARRAY v_cands LOOP
    IF v_c = '' THEN CONTINUE; END IF;
    FOREACH v_cf IN ARRAY public.pictionary_forms(v_c) LOOP
      FOREACH v_wf IN ARRAY v_wforms LOOP
        -- the length check also keeps levenshtein under its 255-character limit
        IF abs(char_length(v_cf) - char_length(v_wf)) <= v_allow
           AND extensions.levenshtein(v_cf, v_wf) <= v_allow THEN
          RETURN true;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.pictionary_clean(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.pictionary_forms(text) FROM public, anon, authenticated;

-- ---- scoring from the Round's own timing -------------------------------------
-- Round time is started_at to ends_at, so editing the session setting never
-- changes a live Round's scores or Change winner.
CREATE OR REPLACE FUNCTION public.pictionary_award(p_round_id uuid, p_comment_id uuid)
RETURNS public.pictionary_rounds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_round public.pictionary_rounds%ROWTYPE;
BEGIN
  UPDATE public.pictionary_rounds r
     SET winner_comment_id = c.id,
         winner_participant_id = c.participant_id,
         winner_points = greatest(300, least(1000, floor(
           1000 * greatest(0, extract(epoch FROM r.ends_at - c.created_at))
                / nullif(extract(epoch FROM r.ends_at - r.started_at), 0))::integer)),
         drawer_points = 500,
         end_reason = 'guessed'
    FROM public.comments c
   WHERE r.id = p_round_id AND c.id = p_comment_id
  RETURNING r.* INTO v_round;
  RETURN v_round;
END;
$$;
REVOKE ALL ON FUNCTION public.pictionary_award(uuid, uuid) FROM public, anon, authenticated;

-- ---- round time lock ---------------------------------------------------------
-- As before, plus pictionary_round_seconds freezes once the first Round exists.
CREATE OR REPLACE FUNCTION public.prevent_identity_change_after_votes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (NEW.participation_mode IS DISTINCT FROM OLD.participation_mode
      OR NEW.identity_requires_name IS DISTINCT FROM OLD.identity_requires_name
      OR NEW.identity_requires_id IS DISTINCT FROM OLD.identity_requires_id
      OR NEW.is_scored IS DISTINCT FROM OLD.is_scored
      OR NEW.score_time_limit_seconds IS DISTINCT FROM OLD.score_time_limit_seconds
      OR NEW.quiz_format IS DISTINCT FROM OLD.quiz_format)
     AND EXISTS (
       SELECT 1 FROM public.votes v
       JOIN public.questions q ON q.id = v.question_id
       WHERE q.session_id = NEW.id
     )
  THEN
    RAISE EXCEPTION 'The session type cannot be changed after voting has started';
  END IF;

  -- Wheel -> Comments changes no flag above, so the type itself is checked.
  IF (NEW.session_type IS DISTINCT FROM OLD.session_type
      OR NEW.participation_mode IS DISTINCT FROM OLD.participation_mode
      OR NEW.identity_requires_name IS DISTINCT FROM OLD.identity_requires_name
      OR NEW.identity_requires_id IS DISTINCT FROM OLD.identity_requires_id
      OR NEW.is_scored IS DISTINCT FROM OLD.is_scored)
     AND EXISTS (SELECT 1 FROM public.wheel_spins w WHERE w.session_id = NEW.id)
  THEN
    RAISE EXCEPTION 'The session type cannot be changed after the wheel has been spun';
  END IF;

  IF (NEW.session_type IS DISTINCT FROM OLD.session_type
      OR NEW.participation_mode IS DISTINCT FROM OLD.participation_mode
      OR NEW.identity_requires_name IS DISTINCT FROM OLD.identity_requires_name
      OR NEW.identity_requires_id IS DISTINCT FROM OLD.identity_requires_id
      OR NEW.is_scored IS DISTINCT FROM OLD.is_scored)
     AND EXISTS (SELECT 1 FROM public.pictionary_rounds r WHERE r.session_id = NEW.id)
  THEN
    RAISE EXCEPTION 'The session type cannot be changed after the first Pictionary round has started';
  END IF;

  IF NEW.pictionary_round_seconds IS DISTINCT FROM OLD.pictionary_round_seconds
     AND EXISTS (SELECT 1 FROM public.pictionary_rounds r WHERE r.session_id = NEW.id)
  THEN
    RAISE EXCEPTION 'The round time cannot be changed after the first Pictionary round has started';
  END IF;
  RETURN NEW;
END;
$$;

-- ---- submit a Guess: lock the session row, stamp real server time -----------------
-- Same session-row lock as the owner functions, so a Guess, a skip, a timeout and
-- an auto-pick are serialised and each re-reads the Round after the lock. created_at
-- is clock_timestamp(), so first match = order of real server time, not of
-- transaction start.
CREATE OR REPLACE FUNCTION public.submit_pictionary_guess(p_join_token text, p_body text)
RETURNS TABLE (comment_id uuid, won boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_participant public.participants%ROWTYPE;
  v_round public.pictionary_rounds%ROWTYPE;
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
  v_won boolean;
BEGIN
  v_participant := public.pictionary_participant(p_join_token);
  PERFORM 1 FROM public.sessions WHERE id = v_participant.session_id FOR UPDATE;
  SELECT * INTO v_round FROM public.pictionary_rounds
   WHERE session_id = v_participant.session_id ORDER BY round_number DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_round.status <> 'drawing' OR clock_timestamp() >= v_round.ends_at THEN
    RAISE EXCEPTION 'Guesses are not open right now';
  END IF;
  IF v_round.drawer_id = v_participant.id THEN
    RAISE EXCEPTION 'The drawer cannot guess';
  END IF;
  IF v_body = '' THEN
    RAISE EXCEPTION 'Type a guess first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.comments c
              WHERE c.participant_id = v_participant.id AND c.round_id IS NOT NULL
                AND c.created_at > clock_timestamp() - interval '2 seconds') THEN
    RAISE EXCEPTION 'Please wait a moment before guessing again';
  END IF;

  INSERT INTO public.comments (round_id, participant_id, body, created_at)
  VALUES (v_round.id, v_participant.id, left(v_body, 500), clock_timestamp())
  RETURNING id INTO v_id;

  v_won := public.pictionary_matches(v_body,
    (SELECT w.word FROM public.pictionary_words w WHERE w.used_round_id = v_round.id));
  IF v_won THEN
    PERFORM public.end_pictionary_round(v_round.id, 'guessed');
    PERFORM public.pictionary_award(v_round.id, v_id);
  END IF;
  RETURN QUERY SELECT v_id, v_won;
END;
$$;

-- ---- the Drawer's pick: same lock ------------------------------------------------
CREATE OR REPLACE FUNCTION public.choose_pictionary_word(p_join_token text, p_word_id uuid)
RETURNS public.pictionary_rounds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_participant public.participants%ROWTYPE;
  v_round public.pictionary_rounds%ROWTYPE;
BEGIN
  v_participant := public.pictionary_participant(p_join_token);
  PERFORM 1 FROM public.sessions WHERE id = v_participant.session_id FOR UPDATE;
  SELECT * INTO v_round FROM public.pictionary_rounds
   WHERE session_id = v_participant.session_id ORDER BY round_number DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_round.status <> 'choosing' OR v_round.drawer_id IS DISTINCT FROM v_participant.id THEN
    RAISE EXCEPTION 'You are not choosing a word';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pictionary_words WHERE id = p_word_id AND offered_round_id = v_round.id) THEN
    RAISE EXCEPTION 'That word was not offered to you';
  END IF;
  RETURN public.pictionary_begin_drawing(v_round.id, p_word_id);
END;
$$;

-- ---- auto-pick: a no-op unless the Round is still choosing with offers ------------
CREATE OR REPLACE FUNCTION public.auto_pick_pictionary_word(p_session_id uuid)
RETURNS public.pictionary_rounds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_round public.pictionary_rounds%ROWTYPE;
  v_word uuid;
BEGIN
  PERFORM public.pictionary_owned_session(p_session_id);
  SELECT * INTO v_round FROM public.pictionary_rounds WHERE session_id = p_session_id ORDER BY round_number DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No word is waiting to be picked';
  END IF;
  -- the Drawer picked (or the Round ended) while this call waited for the lock
  IF v_round.status <> 'choosing' THEN
    RETURN v_round;
  END IF;
  IF now() < v_round.choose_deadline THEN
    RAISE EXCEPTION 'The time to choose is not up yet';
  END IF;
  SELECT id INTO v_word FROM public.pictionary_words WHERE offered_round_id = v_round.id ORDER BY random() LIMIT 1;
  IF v_word IS NULL THEN
    RETURN v_round;
  END IF;
  RETURN public.pictionary_begin_drawing(v_round.id, v_word);
END;
$$;

-- ---- pick another Drawer: Guesses belong to the old Word and timer --------------
-- The Round's Guesses are deleted with the swap: they were judged against the old
-- Word and scored against the old ends_at, and one may be by the new Drawer.
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

  DELETE FROM public.comments WHERE round_id = v_round.id;
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

-- ---- host pick: never the Drawer's own Guess --------------------------------------
CREATE OR REPLACE FUNCTION public.pick_pictionary_winner(p_session_id uuid, p_comment_id uuid)
RETURNS public.pictionary_rounds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_round public.pictionary_rounds%ROWTYPE;
BEGIN
  PERFORM public.pictionary_owned_session(p_session_id);
  SELECT * INTO v_round FROM public.pictionary_rounds
   WHERE session_id = p_session_id ORDER BY round_number DESC LIMIT 1;
  IF NOT FOUND OR v_round.status = 'choosing' THEN
    RAISE EXCEPTION 'There is no round to pick a winner for';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.comments WHERE id = p_comment_id AND round_id = v_round.id) THEN
    RAISE EXCEPTION 'That guess is not from the current round';
  END IF;
  IF EXISTS (SELECT 1 FROM public.comments WHERE id = p_comment_id AND participant_id = v_round.drawer_id) THEN
    RAISE EXCEPTION 'The drawer cannot win their own round';
  END IF;
  IF v_round.status = 'drawing' THEN
    PERFORM public.end_pictionary_round(v_round.id, 'guessed');
  END IF;
  RETURN public.pictionary_award(v_round.id, p_comment_id);
END;
$$;
REVOKE ALL ON FUNCTION public.pick_pictionary_winner(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pick_pictionary_winner(uuid, uuid) TO authenticated;
