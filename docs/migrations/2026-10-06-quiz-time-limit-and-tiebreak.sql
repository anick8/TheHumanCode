-- ============================================================================
-- 22. Quiz Time limit
-- ============================================================================

-- Every Quiz question has a Time limit: how long, from when the host first
-- opens it, it accepts a Lock. Default 20s, organizer-editable within 5-120s.
-- Polls, Comments and Treasure Hunt rows carry the default and ignore it.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS time_limit_seconds integer NOT NULL DEFAULT 20;
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_time_limit_range;
ALTER TABLE questions ADD CONSTRAINT questions_time_limit_range
  CHECK (time_limit_seconds BETWEEN 5 AND 120);

-- The Time limit freezes with points once a question has been answered, so
-- the window can't be rewritten under a running quiz.
CREATE OR REPLACE FUNCTION public.prevent_points_change_after_votes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.points IS DISTINCT FROM OLD.points
     AND EXISTS (SELECT 1 FROM public.votes v WHERE v.question_id = NEW.id)
  THEN
    RAISE EXCEPTION 'Question points cannot change after voting has started';
  END IF;
  IF NEW.time_limit_seconds IS DISTINCT FROM OLD.time_limit_seconds
     AND EXISTS (SELECT 1 FROM public.votes v WHERE v.question_id = NEW.id)
  THEN
    RAISE EXCEPTION 'Question Time limit cannot change after voting has started';
  END IF;
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 23. Quiz question clock and Lock deadline
-- ============================================================================

-- The moment the host FIRST opened a question. Stamped once by the trigger
-- below and never moved, so restarting to the lobby and reopening a question
-- can't hand anyone extra time. NULL for questions opened before this shipped,
-- which therefore have no deadline.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS opened_at timestamptz;

-- The presenter advances a quiz by updating current_question_index straight
-- from the browser, so the stamp has to be a trigger. It matches the question
-- the same way reveal_quiz_question() and the Lock RPC do (order_index).
CREATE OR REPLACE FUNCTION public.stamp_question_opened_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.questions q
     SET opened_at = now()
   WHERE q.session_id = NEW.id
     AND q.order_index = NEW.current_question_index
     AND q.opened_at IS NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_question_opened_at() FROM public;

DROP TRIGGER IF EXISTS stamp_question_opened_at ON sessions;
CREATE TRIGGER stamp_question_opened_at AFTER UPDATE OF current_question_index ON sessions
  FOR EACH ROW
  WHEN (NEW.is_scored
        AND NEW.current_question_index IS NOT NULL
        AND NEW.current_question_index >= 0
        AND NEW.current_question_index IS DISTINCT FROM OLD.current_question_index)
  EXECUTE FUNCTION public.stamp_question_opened_at();

-- submit_identified_vote: as section 20, plus the deadline. A Lock arriving
-- after opened_at + the question's Time limit + 1s grace is refused with
-- time_up = true and stores nothing. A repeat Lock still returns the stored
-- row, even after the deadline.
CREATE OR REPLACE FUNCTION public.submit_identified_vote(
  p_join_token text,
  p_question_id uuid,
  p_option_id uuid
)
RETURNS TABLE (
  recorded_option_id uuid,
  recorded boolean,
  is_correct boolean,
  awarded_points integer,
  total_score integer,
  answered_count integer,
  finished_at timestamptz,
  time_up boolean,
  closed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- Covers network latency between a phone's last tap and the server.
  c_grace CONSTANT interval := interval '1 second';
  v_participant public.participants%ROWTYPE;
  v_session public.sessions%ROWTYPE;
  v_question public.questions%ROWTYPE;
  v_existing public.votes%ROWTYPE;
  v_score integer;
  v_answered integer;
  v_finished timestamptz;
BEGIN
  SELECT * INTO v_participant FROM public.participants WHERE join_token = p_join_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown participant';
  END IF;

  SELECT * INTO v_session FROM public.sessions WHERE id = v_participant.session_id;
  IF NOT FOUND OR v_session.is_active = false THEN
    RAISE EXCEPTION 'This session is not active';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.options WHERE id = p_option_id AND question_id = p_question_id
  ) THEN
    RAISE EXCEPTION 'That option does not belong to the question';
  END IF;

  IF v_session.is_scored THEN
    IF v_session.scored_closed THEN
      RETURN QUERY SELECT NULL::uuid, false, NULL::boolean, 0, v_participant.score,
        v_participant.answered_count, v_participant.finished_at, false, true;
      RETURN;
    END IF;

    SELECT * INTO v_question FROM public.questions WHERE id = p_question_id;
    IF v_session.current_question_index IS NULL
       OR v_question.order_index IS DISTINCT FROM v_session.current_question_index
       OR v_session.results_revealed THEN
      RAISE EXCEPTION 'This question is not open for answers';
    END IF;
  END IF;

  -- Locked before: return the stored row and never lock twice.
  SELECT * INTO v_existing FROM public.votes v
   WHERE v.question_id = p_question_id AND v.participant_id = v_participant.id;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.option_id, false, v_existing.is_correct,
      v_existing.awarded_points, v_participant.score, v_participant.answered_count,
      v_participant.finished_at, false, v_session.scored_closed;
    RETURN;
  END IF;

  -- Past the Time limit: refuse. Questions with no open time have no deadline.
  IF v_session.is_scored
     AND v_question.opened_at IS NOT NULL
     AND now() > v_question.opened_at + make_interval(secs => v_question.time_limit_seconds) + c_grace
  THEN
    RETURN QUERY SELECT NULL::uuid, false, NULL::boolean, 0, v_participant.score,
      v_participant.answered_count, v_participant.finished_at, true, false;
    RETURN;
  END IF;

  INSERT INTO public.votes (option_id, question_id, voter_token, participant_id, is_correct, awarded_points)
  VALUES (p_option_id, p_question_id, v_participant.id::text, v_participant.id, NULL, 0);

  UPDATE public.participants p
     SET answered_count = p.answered_count + 1,
         finished_at = CASE
           WHEN p.finished_at IS NOT NULL THEN p.finished_at
           WHEN p.answered_count + 1 >= (
             SELECT count(*) FROM public.questions q WHERE q.session_id = v_participant.session_id
           ) THEN now()
           ELSE NULL
         END
   WHERE p.id = v_participant.id
  RETURNING p.score, p.answered_count, p.finished_at INTO v_score, v_answered, v_finished;

  RETURN QUERY SELECT p_option_id, true, NULL::boolean, 0, v_score, v_answered, v_finished, false, false;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_identified_vote(text, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_identified_vote(text, uuid, uuid) TO anon, authenticated;

-- ============================================================================
-- 24. Quiz Response-time Tiebreak
-- ============================================================================

-- Score stays flat points. Speed only breaks ties: Participants on the same
-- Score rank by lowest cumulative Response time (Lock minus the question's
-- first open, capped at its Time limit; a missed question counts the full
-- limit). Accrued once per question, at Reveal.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS revealed_at timestamptz;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS total_response_ms bigint NOT NULL DEFAULT 0;

-- A late joiner starts as if they missed every question already revealed.
-- Done as a trigger so join_session's rejoin/upsert logic stays untouched.
CREATE OR REPLACE FUNCTION public.seed_participant_response_ms()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = NEW.session_id AND s.is_scored) THEN
    SELECT coalesce(sum(q.time_limit_seconds * 1000), 0) INTO NEW.total_response_ms
      FROM public.questions q
     WHERE q.session_id = NEW.session_id
       AND q.revealed_at IS NOT NULL
       AND q.opened_at IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_participant_response_ms() FROM public;

DROP TRIGGER IF EXISTS seed_participant_response_ms ON participants;
CREATE TRIGGER seed_participant_response_ms BEFORE INSERT ON participants
  FOR EACH ROW EXECUTE FUNCTION public.seed_participant_response_ms();

-- reveal_quiz_question: as section 20 (judges every locked answer, awards
-- points once each), plus the Response-time accrual. The accrual is guarded by
-- revealed_at IS NULL so a repeat Reveal, or a restart and reopen followed by
-- another Reveal, never adds time twice. A question with no open time (opened
-- before this shipped) adds nothing for anyone.
CREATE OR REPLACE FUNCTION public.reveal_quiz_question(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_question public.questions%ROWTYPE;
BEGIN
  SELECT * INTO v_session FROM public.sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_session.owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT v_session.is_scored THEN
    RAISE EXCEPTION 'This session is not scored';
  END IF;
  IF v_session.current_question_index IS NULL OR v_session.current_question_index < 0 THEN
    RAISE EXCEPTION 'No question is currently open';
  END IF;

  SELECT * INTO v_question FROM public.questions
  WHERE session_id = p_session_id AND order_index = v_session.current_question_index;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No question at this position';
  END IF;

  WITH judged AS (
    UPDATE public.votes v
    SET is_correct = (k.option_id IS NOT NULL AND k.option_id = v.option_id),
        awarded_points = CASE WHEN k.option_id IS NOT NULL AND k.option_id = v.option_id
                               THEN coalesce(q.points, 0) ELSE 0 END
    FROM public.questions q
    LEFT JOIN public.question_keys k ON k.question_id = q.id
    WHERE v.question_id = v_question.id
      AND q.id = v_question.id
      AND v.is_correct IS NULL
    RETURNING v.participant_id, v.awarded_points
  )
  UPDATE public.participants p
  SET score = p.score + judged.awarded_points,
      finished_at = CASE
        WHEN p.finished_at IS NOT NULL THEN p.finished_at
        WHEN p.answered_count >= (SELECT count(*) FROM public.questions WHERE session_id = p_session_id)
        THEN now() ELSE p.finished_at END
  FROM judged
  WHERE p.id = judged.participant_id;

  IF v_question.revealed_at IS NULL THEN
    IF v_question.opened_at IS NOT NULL THEN
      UPDATE public.participants p
         SET total_response_ms = p.total_response_ms + coalesce(
               (SELECT least(
                         greatest(0, round(extract(epoch FROM v.created_at - v_question.opened_at) * 1000)),
                         v_question.time_limit_seconds * 1000
                       )::bigint
                  FROM public.votes v
                 WHERE v.question_id = v_question.id AND v.participant_id = p.id),
               v_question.time_limit_seconds * 1000)
       WHERE p.session_id = p_session_id;
    END IF;
    UPDATE public.questions SET revealed_at = now() WHERE id = v_question.id;
  END IF;

  UPDATE public.sessions SET results_revealed = true, show_leaderboard = false WHERE id = p_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reveal_quiz_question(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reveal_quiz_question(uuid) TO authenticated;

-- get_leaderboard: ranked by Score, then lowest cumulative Response time,
-- compared to the millisecond - exactly equal values share a rank. A Legacy
-- (unscored) quiz keeps ordering ties by when each finished. Now also returns
-- total_response_ms so a view can explain a tie.
DROP FUNCTION IF EXISTS public.get_leaderboard(uuid);
CREATE FUNCTION public.get_leaderboard(p_session_id uuid)
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
  SELECT sub.id, sub.display_name, sub.score, sub.answered_count, sub.finished_at, sub.rnk, sub.total_response_ms
  FROM (
    SELECT p.id,
           coalesce(p.name, p.external_id, 'Player') AS display_name,
           p.score,
           p.answered_count,
           p.finished_at,
           p.total_response_ms,
           rank() OVER (
             ORDER BY p.score DESC,
                      p.total_response_ms ASC,
                      CASE WHEN s.is_scored THEN NULL ELSE p.finished_at END ASC NULLS LAST
           ) AS rnk
    FROM public.participants p
    JOIN public.sessions s ON s.id = p.session_id
    WHERE p.session_id = p_session_id
  ) sub
  WHERE EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id = p_session_id AND s.is_active = true AND s.is_scored = true
  )
  ORDER BY sub.rnk;
$$;

REVOKE ALL ON FUNCTION public.get_leaderboard(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_leaderboard(uuid) TO anon, authenticated;

-- get_participant_standing: the participant's own rank follows the same rule.
CREATE OR REPLACE FUNCTION public.get_participant_standing(p_join_token text)
RETURNS TABLE (total_score integer, participant_rank bigint, total_participants bigint, answered_count integer, finished_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.score, r.rnk, r.total, p.answered_count, p.finished_at
  FROM public.participants p
  JOIN (
    SELECT p2.id,
           rank() OVER (
             ORDER BY p2.score DESC,
                      p2.total_response_ms ASC,
                      CASE WHEN s.is_scored THEN NULL ELSE p2.finished_at END ASC NULLS LAST
           ) AS rnk,
           count(*) OVER () AS total
    FROM public.participants p2
    JOIN public.sessions s ON s.id = p2.session_id
    WHERE p2.session_id = (SELECT session_id FROM public.participants WHERE join_token = p_join_token)
  ) r ON r.id = p.id
  WHERE p.join_token = p_join_token;
$$;

REVOKE ALL ON FUNCTION public.get_participant_standing(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_participant_standing(text) TO anon, authenticated;
