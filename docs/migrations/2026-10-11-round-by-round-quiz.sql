-- ============================================================================
-- 29. Round-by-round quiz format
-- ============================================================================

-- A Quiz has one of two formats. Classic keeps the cumulative Leaderboard.
-- Round-by-round ranks each question on its own (only Participants who got it
-- right, fastest first) and never adds anything up. Everything else about a
-- Quiz - join, Lock, Reveal, Time limit - is shared.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS quiz_format text NOT NULL DEFAULT 'classic';
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_quiz_format_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_quiz_format_check
  CHECK (quiz_format IN ('classic', 'round_by_round'));
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_round_by_round_requires_quiz;
ALTER TABLE sessions ADD CONSTRAINT sessions_round_by_round_requires_quiz
  CHECK (quiz_format = 'classic' OR (session_type = 'quiz' AND is_scored));

-- Session type lock: as section 25, plus the format freezes with the first
-- Answer, like the type and the Time limit.
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
  RETURN NEW;
END;
$$;

-- round_board_rows: every correct Answer to a revealed question of a
-- Round-by-round quiz, ranked within its question by Response time (Lock minus
-- first open, capped at the Time limit; exactly equal times share a rank).
-- Internal: no grant, reached only through the SECURITY DEFINER readers below.
CREATE OR REPLACE FUNCTION public.round_board_rows(p_session_id uuid)
RETURNS TABLE (
  question_id uuid,
  participant_id uuid,
  display_name text,
  response_ms bigint,
  rank bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.question_id, t.participant_id, t.display_name, t.response_ms,
         rank() OVER (PARTITION BY t.question_id ORDER BY t.response_ms)
  FROM (
    SELECT q.id AS question_id,
           p.id AS participant_id,
           coalesce(p.name, p.external_id, 'Player') AS display_name,
           least(
             greatest(0, round(extract(epoch FROM v.created_at - q.opened_at) * 1000)),
             q.time_limit_seconds * 1000
           )::bigint AS response_ms
    FROM public.votes v
    JOIN public.questions q ON q.id = v.question_id
    JOIN public.participants p ON p.id = v.participant_id
    JOIN public.sessions s ON s.id = q.session_id
    WHERE q.session_id = p_session_id
      AND q.revealed_at IS NOT NULL
      AND q.opened_at IS NOT NULL
      AND v.is_correct = true
      AND s.is_active = true
      AND s.is_scored = true
      AND s.quiz_format = 'round_by_round'
  ) t;
$$;

REVOKE ALL ON FUNCTION public.round_board_rows(uuid) FROM public;

-- get_question_leaderboard: the board for one revealed question. Empty before
-- Reveal, for a Classic quiz, and when nobody got it right.
CREATE OR REPLACE FUNCTION public.get_question_leaderboard(p_session_id uuid, p_question_id uuid)
RETURNS TABLE (
  participant_id uuid,
  display_name text,
  response_ms bigint,
  rank bigint,
  correct_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT b.participant_id, b.display_name, b.response_ms, b.rank, count(*) OVER ()
  FROM public.round_board_rows(p_session_id) b
  WHERE b.question_id = p_question_id
  ORDER BY b.rank, b.display_name;
$$;

REVOKE ALL ON FUNCTION public.get_question_leaderboard(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_question_leaderboard(uuid, uuid) TO anon, authenticated;

-- get_round_recap: one row per revealed question, in order, with its fastest
-- correct Participant(s). A question nobody got right has empty winner arrays.
-- Winners are only the rank-1 rows; there is deliberately no running tally.
CREATE OR REPLACE FUNCTION public.get_round_recap(p_session_id uuid)
RETURNS TABLE (
  question_id uuid,
  order_index integer,
  question_text text,
  winner_ids uuid[],
  winner_names text[],
  winner_ms bigint,
  correct_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT q.id,
         q.order_index,
         q.text,
         coalesce(array_agg(b.participant_id ORDER BY b.display_name) FILTER (WHERE b.rank = 1), '{}'),
         coalesce(array_agg(b.display_name ORDER BY b.display_name) FILTER (WHERE b.rank = 1), '{}'),
         min(b.response_ms),
         count(b.participant_id)
  FROM public.questions q
  JOIN public.sessions s ON s.id = q.session_id
  LEFT JOIN public.round_board_rows(p_session_id) b ON b.question_id = q.id
  WHERE q.session_id = p_session_id
    AND q.revealed_at IS NOT NULL
    AND s.is_active = true
    AND s.is_scored = true
    AND s.quiz_format = 'round_by_round'
  GROUP BY q.id, q.order_index, q.text
  ORDER BY q.order_index;
$$;

REVOKE ALL ON FUNCTION public.get_round_recap(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_round_recap(uuid) TO anon, authenticated;
