-- ============================================================================
-- Pictionary: session type, hidden Words and the Round lifecycle (no guessing)
-- ============================================================================

-- A live drawing game. One Participant (the Drawer) picks a secret Word from
-- three offered and draws it; the others guess. This migration holds the
-- schema and the Round lifecycle only: Guess judging and scoring come later.
-- The Word lives in a table no client can read; the public Round record
-- carries it only after the Round is revealed.

-- Fuzzy matching for Guess judging (a later ticket); needs to exist in the
-- scratch database and on hosted Supabase.
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA extensions;

-- ---- session type and settings ---------------------------------------------
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_session_type_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_session_type_check
  CHECK (session_type IN ('poll', 'quiz', 'comments', 'treasure_hunt', 'wheel', 'pictionary'));

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_type_consistency;
ALTER TABLE sessions ADD CONSTRAINT sessions_type_consistency CHECK (
     (session_type = 'poll'          AND participation_mode = 'anonymous'  AND NOT is_scored)
  OR (session_type = 'quiz'          AND participation_mode = 'identified')
  OR (session_type = 'comments'      AND participation_mode = 'identified' AND NOT is_scored)
  OR (session_type = 'treasure_hunt' AND participation_mode = 'anonymous'  AND NOT is_scored)
  OR (session_type = 'wheel'         AND participation_mode = 'identified' AND NOT is_scored
                                     AND identity_requires_name AND NOT identity_requires_id)
  OR (session_type = 'pictionary'    AND participation_mode = 'identified' AND is_scored
                                     AND identity_requires_name AND NOT identity_requires_id)
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pictionary_round_count integer NOT NULL DEFAULT 8;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pictionary_round_seconds integer NOT NULL DEFAULT 80;
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_pictionary_round_count_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_pictionary_round_count_check
  CHECK (pictionary_round_count BETWEEN 1 AND 50);
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_pictionary_round_seconds_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_pictionary_round_seconds_check
  CHECK (pictionary_round_seconds BETWEEN 10 AND 600);

-- ---- Rounds (public, realtime) ---------------------------------------------
-- status: choosing (Drawer picks a Word, 15s) -> drawing (timer runs) -> revealed.
-- word stays NULL until revealed. winner_* and drawer_points are filled by the
-- Guess tickets; a Round ended by Skip or timeout leaves them empty / 0.
CREATE TABLE IF NOT EXISTS pictionary_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  round_number integer NOT NULL CHECK (round_number > 0),
  drawer_id uuid REFERENCES participants(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'choosing' CHECK (status IN ('choosing', 'drawing', 'revealed')),
  word text,
  choose_deadline timestamptz,
  started_at timestamptz,
  ends_at timestamptz,
  ended_at timestamptz,
  end_reason text CHECK (end_reason IN ('guessed', 'timeout', 'skipped')),
  winner_participant_id uuid REFERENCES participants(id) ON DELETE SET NULL,
  winner_points integer,
  drawer_points integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, round_number)
);

-- ---- hidden Word store -------------------------------------------------------
-- offered_round_id: on offer to that Round's Drawer. used_round_id: picked.
-- A Word with neither is in the pool.
CREATE TABLE IF NOT EXISTS pictionary_words (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  word text NOT NULL CHECK (char_length(word) BETWEEN 1 AND 40),
  position integer NOT NULL,
  offered_round_id uuid REFERENCES pictionary_rounds(id) ON DELETE SET NULL,
  used_round_id uuid REFERENCES pictionary_rounds(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_pictionary_words_session ON pictionary_words(session_id);

-- ---- Guesses reuse Comments ----------------------------------------------------
ALTER TABLE comments ALTER COLUMN question_id DROP NOT NULL;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS round_id uuid REFERENCES pictionary_rounds(id) ON DELETE CASCADE;
ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_question_or_round;
ALTER TABLE comments ADD CONSTRAINT comments_question_or_round
  CHECK (question_id IS NOT NULL OR round_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_comments_round ON comments(round_id, created_at);

ALTER TABLE pictionary_rounds ADD COLUMN IF NOT EXISTS winner_comment_id uuid REFERENCES comments(id) ON DELETE SET NULL;

-- ---- RLS ---------------------------------------------------------------------
-- Rounds: readable like Questions (active sessions, or the owner); every write
-- goes through the functions below. Words: no policy and no grant, so no client
-- can read or write them directly.
ALTER TABLE pictionary_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE pictionary_words ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view rounds of active sessions" ON pictionary_rounds;
CREATE POLICY "Anyone can view rounds of active sessions" ON pictionary_rounds FOR SELECT
  USING (EXISTS (SELECT 1 FROM sessions s WHERE s.id = pictionary_rounds.session_id AND s.is_active = true));

DROP POLICY IF EXISTS "Owners can view their rounds" ON pictionary_rounds;
CREATE POLICY "Owners can view their rounds" ON pictionary_rounds FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM sessions s WHERE s.id = pictionary_rounds.session_id AND s.owner_id = auth.uid()));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON pictionary_rounds FROM anon, authenticated;
REVOKE ALL ON pictionary_words FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pictionary_rounds'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE pictionary_rounds;
  END IF;
END $$;

-- ---- type lock ---------------------------------------------------------------
-- As before, plus the type freezes once the first Pictionary Round exists.
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
  RETURN NEW;
END;
$$;

-- ---- internal helpers (no client grants) ---------------------------------------
-- The caller's own Pictionary session, locked; refuses anyone else.
CREATE OR REPLACE FUNCTION public.pictionary_owned_session(p_session_id uuid)
RETURNS public.sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
BEGIN
  IF NOT public.is_organizer() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_session.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_session.session_type <> 'pictionary' THEN
    RAISE EXCEPTION 'This session is not a Pictionary';
  END IF;
  RETURN v_session;
END;
$$;

-- The Participant behind a join token, in a live Pictionary session.
CREATE OR REPLACE FUNCTION public.pictionary_participant(p_join_token text)
RETURNS public.participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_participant public.participants%ROWTYPE;
  v_session public.sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_participant FROM public.participants WHERE join_token = p_join_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown participant';
  END IF;
  SELECT * INTO v_session FROM public.sessions WHERE id = v_participant.session_id;
  IF NOT FOUND OR v_session.is_active = false OR v_session.session_type <> 'pictionary' THEN
    RAISE EXCEPTION 'This session is not active';
  END IF;
  IF NOT public.owner_has_access(v_session.owner_id) THEN
    RAISE EXCEPTION 'This session is closed';
  END IF;
  RETURN v_participant;
END;
$$;

-- The Participant of the session who has drawn least (random among ties), so
-- everyone draws once before anyone draws again. p_exclude is never chosen.
CREATE OR REPLACE FUNCTION public.pictionary_pick_drawer(p_session_id uuid, p_exclude uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id FROM public.participants p
   WHERE p.session_id = p_session_id AND p.id IS DISTINCT FROM p_exclude
   ORDER BY (SELECT count(*) FROM public.pictionary_rounds r WHERE r.drawer_id = p.id), random()
   LIMIT 1;
$$;

-- Offers up to 3 pool Words to a Round, replacing any earlier offer. An empty
-- pool starts over, so a long game never runs out.
CREATE OR REPLACE FUNCTION public.pictionary_offer_words(p_round_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session uuid;
BEGIN
  SELECT session_id INTO v_session FROM public.pictionary_rounds WHERE id = p_round_id;
  UPDATE public.pictionary_words SET offered_round_id = NULL WHERE offered_round_id = p_round_id;
  IF NOT EXISTS (SELECT 1 FROM public.pictionary_words WHERE session_id = v_session AND used_round_id IS NULL) THEN
    UPDATE public.pictionary_words SET used_round_id = NULL WHERE session_id = v_session;
  END IF;
  UPDATE public.pictionary_words SET offered_round_id = p_round_id
   WHERE id IN (SELECT id FROM public.pictionary_words
                 WHERE session_id = v_session AND used_round_id IS NULL
                 ORDER BY random() LIMIT 3);
END;
$$;

-- Picks a Word for a Round: the unchosen offers return to the pool and the
-- timer starts.
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
         ends_at = now() + make_interval(secs => s.pictionary_round_seconds)
    FROM public.sessions s
   WHERE r.id = p_round_id AND s.id = r.session_id
  RETURNING r.* INTO v_round;
  RETURN v_round;
END;
$$;

-- Ends a Round with no winner and reveals its Word (when one was picked). The
-- Guess tickets set winner_* themselves. Releases any Words still on offer.
CREATE OR REPLACE FUNCTION public.end_pictionary_round(p_round_id uuid, p_reason text)
RETURNS public.pictionary_rounds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_round public.pictionary_rounds%ROWTYPE;
BEGIN
  UPDATE public.pictionary_words SET offered_round_id = NULL WHERE offered_round_id = p_round_id;
  UPDATE public.pictionary_rounds
     SET status = 'revealed', ended_at = now(), end_reason = p_reason,
         word = (SELECT w.word FROM public.pictionary_words w WHERE w.used_round_id = p_round_id)
   WHERE id = p_round_id
  RETURNING * INTO v_round;
  RETURN v_round;
END;
$$;

REVOKE ALL ON FUNCTION public.pictionary_owned_session(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.pictionary_participant(text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.pictionary_pick_drawer(uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.pictionary_offer_words(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.pictionary_begin_drawing(uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.end_pictionary_round(uuid, text) FROM public, anon, authenticated;

-- ---- Word list (organizer) -----------------------------------------------------
-- One Word per line; trimmed, blanks dropped, duplicates (any case) dropped.
-- Locked once the first Round exists. Returns how many Words were stored.
CREATE OR REPLACE FUNCTION public.set_pictionary_words(p_session_id uuid, p_words text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  PERFORM public.pictionary_owned_session(p_session_id);
  IF EXISTS (SELECT 1 FROM public.pictionary_rounds WHERE session_id = p_session_id) THEN
    RAISE EXCEPTION 'The word list cannot be changed once the first round has started';
  END IF;

  DELETE FROM public.pictionary_words WHERE session_id = p_session_id;
  WITH lines AS (
    SELECT left(btrim(l.w), 40) AS word, l.ord
      FROM regexp_split_to_table(coalesce(p_words, ''), E'\r?\n') WITH ORDINALITY AS l(w, ord)
     WHERE btrim(l.w) <> ''
  ), uniq AS (
    SELECT DISTINCT ON (lower(word)) word, ord FROM lines ORDER BY lower(word), ord
  ), ins AS (
    INSERT INTO public.pictionary_words (session_id, word, position)
    SELECT p_session_id, word, row_number() OVER (ORDER BY ord) FROM uniq
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;
  IF v_count > 200 THEN
    RAISE EXCEPTION 'A word list can have at most 200 words';
  END IF;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pictionary_words(p_session_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
BEGIN
  IF NOT public.is_organizer() OR NOT EXISTS (
    SELECT 1 FROM public.sessions s
     WHERE s.id = p_session_id AND s.owner_id = auth.uid() AND s.session_type = 'pictionary'
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN coalesce((SELECT string_agg(word, E'\n' ORDER BY position)
                     FROM public.pictionary_words WHERE session_id = p_session_id), '');
END;
$$;

-- ---- Round lifecycle (organizer) -------------------------------------------------
-- Starts the next Round (also used for "Next"). p_drawer_id NULL = random among
-- Participants who have drawn least. Refuses while a Round is live, past the
-- last Round, under 2 Participants or under 3 Words.
CREATE OR REPLACE FUNCTION public.start_pictionary_round(p_session_id uuid, p_drawer_id uuid DEFAULT NULL)
RETURNS public.pictionary_rounds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_last public.pictionary_rounds%ROWTYPE;
  v_drawer uuid := p_drawer_id;
  v_round public.pictionary_rounds%ROWTYPE;
BEGIN
  v_session := public.pictionary_owned_session(p_session_id);

  SELECT * INTO v_last FROM public.pictionary_rounds WHERE session_id = p_session_id ORDER BY round_number DESC LIMIT 1;
  IF FOUND AND v_last.status <> 'revealed' THEN
    RAISE EXCEPTION 'A round is still in progress';
  END IF;
  IF FOUND AND v_last.round_number >= v_session.pictionary_round_count THEN
    RAISE EXCEPTION 'All rounds have been played';
  END IF;
  IF (SELECT count(*) FROM public.participants WHERE session_id = p_session_id) < 2 THEN
    RAISE EXCEPTION 'Start needs at least 2 participants';
  END IF;
  IF (SELECT count(*) FROM public.pictionary_words WHERE session_id = p_session_id) < 3 THEN
    RAISE EXCEPTION 'Add at least 3 words before starting';
  END IF;

  IF v_drawer IS NULL THEN
    v_drawer := public.pictionary_pick_drawer(p_session_id, NULL);
  ELSIF NOT EXISTS (SELECT 1 FROM public.participants WHERE id = v_drawer AND session_id = p_session_id) THEN
    RAISE EXCEPTION 'That participant is not in this session';
  END IF;

  INSERT INTO public.pictionary_rounds (session_id, round_number, drawer_id, choose_deadline)
  VALUES (p_session_id, coalesce(v_last.round_number, 0) + 1, v_drawer, now() + interval '15 seconds')
  RETURNING * INTO v_round;
  PERFORM public.pictionary_offer_words(v_round.id);
  RETURN v_round;
END;
$$;

-- Presenter fallback: after the 15s choosing window, picks a random offered Word.
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
  IF NOT FOUND OR v_round.status <> 'choosing' THEN
    RAISE EXCEPTION 'No word is waiting to be picked';
  END IF;
  IF now() < v_round.choose_deadline THEN
    RAISE EXCEPTION 'The time to choose is not up yet';
  END IF;
  SELECT id INTO v_word FROM public.pictionary_words WHERE offered_round_id = v_round.id ORDER BY random() LIMIT 1;
  RETURN public.pictionary_begin_drawing(v_round.id, v_word);
END;
$$;

-- Ends a Round whose time has run out: Word revealed, no winner, no points.
CREATE OR REPLACE FUNCTION public.timeout_pictionary_round(p_session_id uuid)
RETURNS public.pictionary_rounds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_round public.pictionary_rounds%ROWTYPE;
BEGIN
  PERFORM public.pictionary_owned_session(p_session_id);
  SELECT * INTO v_round FROM public.pictionary_rounds WHERE session_id = p_session_id ORDER BY round_number DESC LIMIT 1;
  IF NOT FOUND OR v_round.status <> 'drawing' THEN
    RAISE EXCEPTION 'No round is being drawn';
  END IF;
  IF now() < v_round.ends_at THEN
    RAISE EXCEPTION 'The time is not up yet';
  END IF;
  RETURN public.end_pictionary_round(v_round.id, 'timeout');
END;
$$;

-- Skip: ends a Choosing or Drawing Round with no winner and no points.
CREATE OR REPLACE FUNCTION public.skip_pictionary_round(p_session_id uuid)
RETURNS public.pictionary_rounds
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_round public.pictionary_rounds%ROWTYPE;
BEGIN
  PERFORM public.pictionary_owned_session(p_session_id);
  SELECT * INTO v_round FROM public.pictionary_rounds WHERE session_id = p_session_id ORDER BY round_number DESC LIMIT 1;
  IF NOT FOUND OR v_round.status = 'revealed' THEN
    RAISE EXCEPTION 'This round has already ended';
  END IF;
  RETURN public.end_pictionary_round(v_round.id, 'skipped');
END;
$$;

-- Pick another Drawer mid-round: the Round goes back to Choosing with fresh
-- Words (a Word already picked returns to the pool) and a new 15s window.
-- p_drawer_id NULL = random among the others who have drawn least.
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
         choose_deadline = now() + interval '15 seconds'
   WHERE id = v_round.id
  RETURNING * INTO v_round;
  PERFORM public.pictionary_offer_words(v_round.id);
  RETURN v_round;
END;
$$;

REVOKE ALL ON FUNCTION public.set_pictionary_words(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_pictionary_words(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_pictionary_words(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_pictionary_words(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.start_pictionary_round(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.start_pictionary_round(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.auto_pick_pictionary_word(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.auto_pick_pictionary_word(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.timeout_pictionary_round(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.timeout_pictionary_round(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.skip_pictionary_round(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.skip_pictionary_round(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.pick_another_pictionary_drawer(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pick_another_pictionary_drawer(uuid, uuid) TO authenticated;

-- ---- Drawer (join token) -----------------------------------------------------------
-- The Words on offer to the caller, who must be the Drawer of a Choosing Round.
CREATE OR REPLACE FUNCTION public.get_pictionary_choices(p_join_token text)
RETURNS TABLE (word_id uuid, word text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
DECLARE
  v_participant public.participants%ROWTYPE;
  v_round public.pictionary_rounds%ROWTYPE;
BEGIN
  v_participant := public.pictionary_participant(p_join_token);
  SELECT * INTO v_round FROM public.pictionary_rounds
   WHERE session_id = v_participant.session_id ORDER BY round_number DESC LIMIT 1;
  IF NOT FOUND OR v_round.status <> 'choosing' OR v_round.drawer_id IS DISTINCT FROM v_participant.id THEN
    RAISE EXCEPTION 'You are not choosing a word';
  END IF;
  RETURN QUERY SELECT w.id, w.word FROM public.pictionary_words w
   WHERE w.offered_round_id = v_round.id ORDER BY w.word;
END;
$$;

-- The Drawer picks one of the offered Words; the timer starts.
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

-- The current Word, for the Drawer (by join token) or, with a NULL token, the
-- session's owner. Only once it has been picked.
CREATE OR REPLACE FUNCTION public.get_pictionary_word(p_session_id uuid, p_join_token text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
DECLARE
  v_round public.pictionary_rounds%ROWTYPE;
  v_participant public.participants%ROWTYPE;
  v_word text;
BEGIN
  SELECT * INTO v_round FROM public.pictionary_rounds
   WHERE session_id = p_session_id ORDER BY round_number DESC LIMIT 1;

  IF p_join_token IS NULL THEN
    IF NOT public.is_organizer() OR NOT EXISTS (
      SELECT 1 FROM public.sessions s WHERE s.id = p_session_id AND s.owner_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'Not authorized';
    END IF;
  ELSE
    v_participant := public.pictionary_participant(p_join_token);
    IF v_participant.session_id <> p_session_id OR v_round.drawer_id IS DISTINCT FROM v_participant.id THEN
      RAISE EXCEPTION 'You are not the drawer';
    END IF;
  END IF;

  SELECT w.word INTO v_word FROM public.pictionary_words w WHERE w.used_round_id = v_round.id;
  IF v_word IS NULL THEN
    RAISE EXCEPTION 'No word has been picked yet';
  END IF;
  RETURN v_word;
END;
$$;

REVOKE ALL ON FUNCTION public.get_pictionary_choices(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_pictionary_choices(text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.choose_pictionary_word(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.choose_pictionary_word(text, uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_pictionary_word(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_pictionary_word(uuid, text) TO anon, authenticated;
