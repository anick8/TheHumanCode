-- ============================================================================
-- Pictionary: Guess judging, host-picked winner, scoring, leaderboard, results
-- ============================================================================

-- Guesses are stored as comments linked to the Round (comments.round_id). The
-- server judges each one with a fuzzy match against the hidden Word; the first
-- match wins the Round. The Organizer can also pick (and later change) the
-- winner by hand. Points always come from the winning Guess's submit time.

-- ---- matching (internal) -------------------------------------------------------
-- Lowercase, strip punctuation, optionally drop a leading a/an/the, remove
-- spaces, drop a trailing es/s.
CREATE OR REPLACE FUNCTION public.pictionary_norm(p_text text, p_drop_article boolean)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_s text := btrim(regexp_replace(lower(coalesce(p_text, '')), '[^[:alnum:][:space:]]', '', 'g'));
BEGIN
  IF p_drop_article THEN
    v_s := regexp_replace(v_s, '^(a|an|the)\s+', '');
  END IF;
  v_s := regexp_replace(v_s, '\s+', '', 'g');
  IF v_s ~ '.es$' THEN
    v_s := left(v_s, -2);
  ELSIF v_s ~ '.s$' THEN
    v_s := left(v_s, -1);
  END IF;
  RETURN v_s;
END;
$$;

-- Does the Guess match the Word? Equal, or within the typo allowance (0 for up
-- to 4 letters, 1 for 5-8, 2 for 9+). A Guess of up to 5 words also matches on
-- any single word or any adjacent pair.
CREATE OR REPLACE FUNCTION public.pictionary_matches(p_guess text, p_word text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_word text := public.pictionary_norm(p_word, true);
  v_allow integer;
  v_words text[] := regexp_split_to_array(
    btrim(regexp_replace(lower(coalesce(p_guess, '')), '[^[:alnum:][:space:]]', '', 'g')), '\s+');
  v_cands text[] := ARRAY[public.pictionary_norm(p_guess, true)];
  v_c text;
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
    -- the length check also keeps levenshtein under its 255-character limit
    IF v_c <> '' AND abs(char_length(v_c) - char_length(v_word)) <= v_allow
       AND extensions.levenshtein(v_c, v_word) <= v_allow THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;

-- Makes a Guess the Round's winner (first win or Change winner) and scores it:
-- guesser max(300, 1000 x time left / Round time) at the Guess's submit time,
-- Drawer a flat 500. Points live on the Round, so a change simply replaces them.
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
           1000 * greatest(0, extract(epoch FROM r.ends_at - c.created_at)) / s.pictionary_round_seconds)::integer)),
         drawer_points = 500,
         end_reason = 'guessed'
    FROM public.comments c, public.sessions s
   WHERE r.id = p_round_id AND c.id = p_comment_id AND s.id = r.session_id
  RETURNING r.* INTO v_round;
  RETURN v_round;
END;
$$;

REVOKE ALL ON FUNCTION public.pictionary_norm(text, boolean) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.pictionary_matches(text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.pictionary_award(uuid, uuid) FROM public, anon, authenticated;

-- ---- submit a Guess (join token) -------------------------------------------------
-- Only a joined Participant who is not the Drawer, inside the Drawing window,
-- one Guess per 2 seconds. The Round row is locked, so the first match wins and
-- a Guess arriving after it finds the Round closed and is refused. Returns the
-- stored Guess and whether it won.
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
  SELECT * INTO v_round FROM public.pictionary_rounds
   WHERE session_id = v_participant.session_id ORDER BY round_number DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_round.status <> 'drawing' OR now() >= v_round.ends_at THEN
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
                AND c.created_at > now() - interval '2 seconds') THEN
    RAISE EXCEPTION 'Please wait a moment before guessing again';
  END IF;

  INSERT INTO public.comments (round_id, participant_id, body)
  VALUES (v_round.id, v_participant.id, left(v_body, 500))
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

-- ---- host pick / Change winner (organizer) ---------------------------------------
-- Makes any Guess of the newest Round the winner: ends a Round still drawing,
-- awards a timed-out or skipped one, or moves the win from the old winner.
-- Allowed until the next Round starts.
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
  IF v_round.status = 'drawing' THEN
    PERFORM public.end_pictionary_round(v_round.id, 'guessed');
  END IF;
  RETURN public.pictionary_award(v_round.id, p_comment_id);
END;
$$;

REVOKE ALL ON FUNCTION public.pick_pictionary_winner(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.pick_pictionary_winner(uuid, uuid) TO authenticated;

-- ---- reads ------------------------------------------------------------------------
-- The Guess feed of a Round (default: the newest), oldest first. comments has
-- no policy for Round Guesses, so everyone reads the feed through this.
CREATE OR REPLACE FUNCTION public.get_pictionary_guesses(p_session_id uuid, p_round_id uuid DEFAULT NULL)
RETURNS TABLE (
  comment_id uuid,
  round_id uuid,
  participant_id uuid,
  author_name text,
  body text,
  created_at timestamptz,
  is_winner boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.id, c.round_id, c.participant_id, coalesce(p.name, p.external_id, 'Player'),
         c.body, c.created_at, (r.winner_comment_id = c.id)
    FROM public.pictionary_rounds r
    JOIN public.sessions s ON s.id = r.session_id
    JOIN public.comments c ON c.round_id = r.id
    JOIN public.participants p ON p.id = c.participant_id
   WHERE r.session_id = p_session_id
     AND (s.is_active = true OR s.owner_id = auth.uid())
     AND r.id = coalesce(p_round_id, (SELECT r2.id FROM public.pictionary_rounds r2
                                       WHERE r2.session_id = p_session_id
                                       ORDER BY r2.round_number DESC LIMIT 1))
   ORDER BY c.created_at, c.id;
$$;

-- Ranked totals in the columns the Leaderboard component reads. A
-- Participant's Score is the winner_points of Rounds they won plus the
-- drawer_points of Rounds they drew. Equal Scores share a rank.
CREATE OR REPLACE FUNCTION public.get_pictionary_leaderboard(p_session_id uuid)
RETURNS TABLE (
  participant_id uuid,
  display_name text,
  score integer,
  answered_count integer,
  finished_at timestamptz,
  rank bigint,
  total_response_ms bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT sub.id, sub.display_name, sub.score, 0, NULL::timestamptz,
         rank() OVER (ORDER BY sub.score DESC), 0::bigint
    FROM (
      SELECT p.id, coalesce(p.name, p.external_id, 'Player') AS display_name,
             (coalesce((SELECT sum(r.winner_points) FROM public.pictionary_rounds r WHERE r.winner_participant_id = p.id), 0)
            + coalesce((SELECT sum(r.drawer_points) FROM public.pictionary_rounds r WHERE r.drawer_id = p.id), 0))::integer AS score
        FROM public.participants p
        JOIN public.sessions s ON s.id = p.session_id
       WHERE p.session_id = p_session_id AND s.session_type = 'pictionary'
         AND (s.is_active = true OR s.owner_id = auth.uid())
    ) sub
   ORDER BY 6, 2;
$$;

-- One row per revealed Round: the Word, Drawer, winner (NULL = nobody), points
-- and seconds from the start of drawing to the winning Guess.
CREATE OR REPLACE FUNCTION public.get_pictionary_results(p_session_id uuid)
RETURNS TABLE (
  round_number integer,
  word text,
  drawer_id uuid,
  drawer_name text,
  winner_participant_id uuid,
  winner_name text,
  winner_points integer,
  drawer_points integer,
  seconds_to_guess numeric,
  end_reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT r.round_number, r.word, r.drawer_id, coalesce(d.name, d.external_id, 'Player'),
         r.winner_participant_id, CASE WHEN w.id IS NULL THEN NULL ELSE coalesce(w.name, w.external_id, 'Player') END,
         r.winner_points, r.drawer_points,
         round(extract(epoch FROM c.created_at - r.started_at)::numeric, 1),
         r.end_reason
    FROM public.pictionary_rounds r
    JOIN public.sessions s ON s.id = r.session_id
    LEFT JOIN public.participants d ON d.id = r.drawer_id
    LEFT JOIN public.participants w ON w.id = r.winner_participant_id
    LEFT JOIN public.comments c ON c.id = r.winner_comment_id
   WHERE r.session_id = p_session_id AND r.status = 'revealed'
     AND (s.is_active = true OR s.owner_id = auth.uid())
   ORDER BY r.round_number;
$$;

REVOKE ALL ON FUNCTION public.submit_pictionary_guess(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_pictionary_guess(text, text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_pictionary_guesses(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_pictionary_guesses(uuid, uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_pictionary_leaderboard(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_pictionary_leaderboard(uuid) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.get_pictionary_results(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_pictionary_results(uuid) TO anon, authenticated;
