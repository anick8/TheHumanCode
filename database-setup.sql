-- LivePolls - Supabase Database Schema
-- Run this in the Supabase SQL Editor
--
-- This script is idempotent: it is safe to run repeatedly. Tables and indexes
-- are created only if absent, policies/triggers/views are dropped and recreated,
-- and the sample data is inserted with ON CONFLICT DO NOTHING.
--
-- NOTE: CREATE TABLE IF NOT EXISTS does NOT migrate an existing table. If you
-- change a column definition below, drop the affected table first (or write a
-- proper ALTER TABLE migration) - re-running this script alone will not apply it.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 0. ORGANIZER ALLOWLIST & LEAD CAPTURE
-- ============================================================================
-- Only emails in allowed_emails may hold organizer capabilities (own
-- sessions, spend AI credits, upload to storage, read attributed comments).
-- Anyone else who signs up gets a plain authenticated account that owns
-- nothing, and is recorded in `leads`. Enforced in RLS, not just app
-- redirects, since the browser talks to Supabase's REST API directly with
-- the user's JWT - a middleware-only gate would be bypassable.

CREATE TABLE IF NOT EXISTS allowed_emails (
  email text PRIMARY KEY CHECK (email = lower(email)),
  note text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE allowed_emails ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: invisible and unwritable from anon/authenticated.
-- Managed from the Supabase SQL editor / table editor (service role, bypasses RLS).

CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: only readable via the Supabase dashboard.

-- is_organizer(): true when the signed-in user's email is on the allowlist.
-- SECURITY DEFINER because a policy subquery runs as the invoker, who cannot
-- read allowed_emails (no policies) or auth.users (not selectable directly).
CREATE OR REPLACE FUNCTION public.is_organizer()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.allowed_emails a
    JOIN auth.users u ON lower(u.email) = a.email
    WHERE u.id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_organizer() FROM public;
GRANT EXECUTE ON FUNCTION public.is_organizer() TO anon, authenticated;

-- capture_lead(): fires after every new auth.users row. Records non-
-- allowlisted signups as leads. Runs in the database so it can't be skipped
-- by calling Supabase's auth API directly instead of going through the app.
CREATE OR REPLACE FUNCTION public.capture_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.allowed_emails WHERE email = lower(NEW.email)
  ) THEN
    INSERT INTO public.leads (email, user_id) VALUES (lower(NEW.email), NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_capture_lead ON auth.users;
CREATE TRIGGER on_auth_user_created_capture_lead
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.capture_lead();

-- Seed the allowlist. Add further organizers from the Supabase SQL editor:
--   INSERT INTO allowed_emails (email, note) VALUES ('friend@example.com', 'friend') ON CONFLICT DO NOTHING;
INSERT INTO allowed_emails (email, note) VALUES
  ('anick8ak@gmail.com', 'owner')
ON CONFLICT (email) DO NOTHING;

-- Backfill: capture existing non-allowlisted accounts as leads too, since the
-- trigger above only fires on new signups from this point forward.
INSERT INTO leads (email, user_id)
SELECT lower(u.email), u.id
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM allowed_emails a WHERE a.email = lower(u.email))
  AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.user_id = u.id);

-- 1. SESSIONS table (one per poll session)
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Untitled Session',
  slug text UNIQUE NOT NULL,
  is_active boolean DEFAULT true,
  results_mode text DEFAULT 'live' CHECK (results_mode IN ('live', 'after_all')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Presenter position for host-driven sessions (/present/[sessionId]). Added
-- with ALTER rather than in CREATE TABLE so existing installs pick it up too.
--   NULL = not presenting (attendees self-pace), -1 = lobby,
--   0..n-1 = question at that order position, n = finished
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS current_question_index integer
  CHECK (current_question_index IS NULL OR current_question_index >= -1);

-- Host option: reveal each question's results before moving on. With it on,
-- the presenter's Next first sets results_revealed (results shown on every
-- device, voting closed for that question), then advances and resets it.
-- show_results_between is superseded by results_mode ('live' = reveal after
-- each question) and is no longer read by the app.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS show_results_between boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS results_revealed boolean NOT NULL DEFAULT false;

-- Per-session branding from the Design editor (lib/theme.js):
-- { primary, background, foreground, card, headingFont, bodyFont, logoUrl }.
-- Only keys that differ from the default are stored; '{}' = default look.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS theme jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Logo uploads: public-read bucket; owners write only under <their uid>/.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('session-logos', 'session-logos', true, 2097152,
        ARRAY['image/png','image/jpeg','image/svg+xml','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "session_logos_owner_insert" ON storage.objects;
CREATE POLICY "session_logos_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK ((select public.is_organizer()) AND bucket_id = 'session-logos' AND (storage.foldername(name))[1] = (select auth.uid())::text);
DROP POLICY IF EXISTS "session_logos_owner_update" ON storage.objects;
CREATE POLICY "session_logos_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING ((select public.is_organizer()) AND bucket_id = 'session-logos' AND (storage.foldername(name))[1] = (select auth.uid())::text);
DROP POLICY IF EXISTS "session_logos_owner_delete" ON storage.objects;
CREATE POLICY "session_logos_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING ((select public.is_organizer()) AND bucket_id = 'session-logos' AND (storage.foldername(name))[1] = (select auth.uid())::text);

-- 2. QUESTIONS table (questions within a session)
CREATE TABLE IF NOT EXISTS questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES sessions(id) ON DELETE CASCADE,
  text text NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT fk_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- 3. OPTIONS table (answer choices for questions)
CREATE TABLE IF NOT EXISTS options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid REFERENCES questions(id) ON DELETE CASCADE,
  text text NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT fk_question FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

-- 4. VOTES table (votes from anonymous attendees)
CREATE TABLE IF NOT EXISTS votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  option_id uuid REFERENCES options(id) ON DELETE CASCADE,
  question_id uuid REFERENCES questions(id) ON DELETE CASCADE,
  voter_token text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(question_id, voter_token), -- Prevent double-voting per question
  CONSTRAINT fk_option FOREIGN KEY (option_id) REFERENCES options(id) ON DELETE CASCADE,
  CONSTRAINT fk_question FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

-- 5. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner_id);
CREATE INDEX IF NOT EXISTS idx_sessions_slug ON sessions(slug);
CREATE INDEX IF NOT EXISTS idx_questions_session ON questions(session_id);
CREATE INDEX IF NOT EXISTS idx_options_question ON options(question_id);
CREATE INDEX IF NOT EXISTS idx_votes_option ON votes(option_id);
CREATE INDEX IF NOT EXISTS idx_votes_question ON votes(question_id);
CREATE INDEX IF NOT EXISTS idx_votes_voter_token ON votes(voter_token);

-- 6. Enable Row Level Security (RLS)
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE options ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

-- 7. POLICIES
-- Dropped first so edits to a policy body take effect on re-run.

-- Sessions policies
DROP POLICY IF EXISTS "Users can manage their own sessions" ON sessions;
CREATE POLICY "Users can manage their own sessions" ON sessions
  FOR ALL USING ((select public.is_organizer()) AND auth.uid() = owner_id)
  WITH CHECK ((select public.is_organizer()) AND auth.uid() = owner_id);

DROP POLICY IF EXISTS "Anyone can view active sessions by slug" ON sessions;
CREATE POLICY "Anyone can view active sessions by slug" ON sessions
  FOR SELECT USING (is_active = true);

-- Questions policies
DROP POLICY IF EXISTS "Users can manage questions in their sessions" ON questions;
CREATE POLICY "Users can manage questions in their sessions" ON questions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = questions.session_id
      AND sessions.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Anyone can view questions for active sessions" ON questions;
CREATE POLICY "Anyone can view questions for active sessions" ON questions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = questions.session_id
      AND sessions.is_active = true
    )
  );

-- Options policies
DROP POLICY IF EXISTS "Users can manage options in their sessions" ON options;
CREATE POLICY "Users can manage options in their sessions" ON options
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM questions
      JOIN sessions ON sessions.id = questions.session_id
      WHERE questions.id = options.question_id
      AND sessions.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Anyone can view options for active sessions" ON options;
CREATE POLICY "Anyone can view options for active sessions" ON options
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM questions
      JOIN sessions ON sessions.id = questions.session_id
      WHERE questions.id = options.question_id
      AND sessions.is_active = true
    )
  );

-- Votes policies
DROP POLICY IF EXISTS "Anyone can vote" ON votes;
CREATE POLICY "Anyone can vote" ON votes
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view votes in their sessions" ON votes;
CREATE POLICY "Users can view votes in their sessions" ON votes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM options
      JOIN questions ON questions.id = options.question_id
      JOIN sessions ON sessions.id = questions.session_id
      WHERE options.id = votes.option_id
      AND sessions.owner_id = auth.uid()
    )
  );

-- 8. Enable realtime for votes table
-- ALTER PUBLICATION ... ADD TABLE errors if the table is already a member,
-- so add it only when absent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'votes'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE votes;
  END IF;
END $$;

-- Attendee devices subscribe to UPDATEs on their session row so the
-- presenter's Next reaches every phone. Realtime respects RLS, and the
-- "Anyone can view active sessions by slug" policy already makes the row
-- readable by anon, so this adds no new exposure.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'sessions'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
  END IF;
END $$;

-- 9. Create trigger for updated_at timestamp
-- search_path is pinned so the function cannot be hijacked by a caller placing
-- a malicious object earlier in the resolution path.
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_sessions_updated_at ON sessions;
CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 10. Create view for vote counts (for easy querying)
-- Dropped rather than replaced: CREATE OR REPLACE VIEW fails if the column
-- list changes, which defeats re-running after a schema edit.
DROP VIEW IF EXISTS vote_counts;
CREATE VIEW vote_counts AS
SELECT
  q.session_id,
  q.id as question_id,
  o.id as option_id,
  o.text as option_text,
  COUNT(v.id) as vote_count,
  q.text as question_text
FROM questions q
JOIN options o ON o.question_id = q.id
LEFT JOIN votes v ON v.option_id = o.id
GROUP BY q.session_id, q.id, o.id, o.text, q.text
ORDER BY q.order_index, o.order_index;

-- Views default to the CREATOR's permissions, which bypasses RLS entirely and
-- exposes every session (including is_active = false) to anyone holding the
-- public anon key. security_invoker makes the QUERYING user's RLS apply.
ALTER VIEW vote_counts SET (security_invoker = on);

-- 11. Create view for session statistics
DROP VIEW IF EXISTS session_stats;
CREATE VIEW session_stats AS
SELECT
  s.id as session_id,
  s.title,
  s.slug,
  s.results_mode,
  s.is_active,
  s.created_at,
  COUNT(DISTINCT q.id) as question_count,
  COUNT(DISTINCT o.id) as option_count,
  COUNT(DISTINCT v.voter_token) as voter_count,
  COUNT(v.id) as total_votes
FROM sessions s
LEFT JOIN questions q ON q.session_id = s.id
LEFT JOIN options o ON o.question_id = q.id
LEFT JOIN votes v ON v.option_id = o.id
GROUP BY s.id, s.title, s.slug, s.results_mode, s.is_active, s.created_at;

ALTER VIEW session_stats SET (security_invoker = on);

-- 12. Insert sample data (optional - for testing)
-- Untargeted ON CONFLICT DO NOTHING so a re-run is skipped on ANY unique
-- violation (primary key or the sessions.slug unique constraint).
INSERT INTO sessions (id, title, slug, results_mode, is_active) VALUES
('00000000-0000-0000-0000-000000000001', 'Conference Feedback', 'conf2024', 'live', true),
('00000000-0000-0000-0000-000000000002', 'Team Workshop Poll', 'team-q2', 'after_all', true)
ON CONFLICT DO NOTHING;

INSERT INTO questions (id, session_id, text, order_index) VALUES
('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'How would you rate today''s keynote?', 1),
('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'What topics interest you for next year?', 2),
('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'Which project should we prioritize?', 1)
ON CONFLICT DO NOTHING;

INSERT INTO options (id, question_id, text, order_index) VALUES
('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Excellent', 1),
('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Good', 2),
('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Average', 3),
('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Needs Improvement', 4),
('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'AI & Machine Learning', 1),
('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000002', 'Web3 & Blockchain', 2),
('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000002', 'Cloud Infrastructure', 3),
('20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000002', 'Mobile Development', 4),
('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000003', 'Customer Portal Redesign', 1),
('20000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000003', 'Mobile App Performance', 2),
('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000003', 'Analytics Dashboard', 3)
ON CONFLICT DO NOTHING;

-- Note: Votes are created dynamically by users, so no sample votes needed

-- 13. Public vote counts for attendees
-- The votes table is deliberately not readable by attendees: it holds
-- voter_token, and exposing rows would let anyone correlate an individual
-- voter's choices across questions. This SECURITY DEFINER function returns only
-- aggregate counts, and only for sessions that are currently active.
CREATE OR REPLACE FUNCTION public.get_vote_counts(p_session_id uuid)
RETURNS TABLE (opt_id uuid, q_id uuid, vote_total bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT o.id, q.id, count(v.id)
  FROM public.questions q
  JOIN public.options o ON o.question_id = q.id
  LEFT JOIN public.votes v ON v.option_id = o.id
  WHERE q.session_id = p_session_id
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = p_session_id AND s.is_active = true
    )
  GROUP BY o.id, q.id;
$$;

REVOKE ALL ON FUNCTION public.get_vote_counts(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_vote_counts(uuid) TO anon, authenticated;

-- 14. Create a function to generate random slugs
-- Note: unused by the app, which generates slugs client-side with nanoid
-- (lib/utils.js:6). Kept for SQL-side session creation.
-- Table references are schema-qualified because search_path is empty.
CREATE OR REPLACE FUNCTION public.generate_random_slug(length integer DEFAULT 8)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  chars text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  result text := '';
  i integer := 0;
BEGIN
  FOR i IN 1..length LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  END LOOP;

  -- Check if slug exists, regenerate if needed
  WHILE EXISTS (SELECT 1 FROM public.sessions WHERE slug = result) LOOP
    result := public.generate_random_slug(length);
  END LOOP;

  RETURN result;
END;
$$;

-- 15. Identified (non-anonymous) participation
-- A session is either 'anonymous' (device token only, the original behavior)
-- or 'identified': each attendee joins with a name and/or ID before voting,
-- and every answer is attributed to that participant. Identity is
-- self-declared - there is no attendee auth - so an external_id is a dedupe
-- key, not proof of identity. Participant rows stay owner-readable; attendees
-- only ever see aggregates.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS participation_mode text NOT NULL DEFAULT 'anonymous'
  CHECK (participation_mode IN ('anonymous', 'identified'));
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS identity_requires_name boolean NOT NULL DEFAULT true;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS identity_requires_id boolean NOT NULL DEFAULT false;

-- An identified session must collect at least one identifier.
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_identity_requirements;
ALTER TABLE sessions ADD CONSTRAINT sessions_identity_requirements
  CHECK (participation_mode <> 'identified' OR identity_requires_name OR identity_requires_id);

CREATE TABLE IF NOT EXISTS participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name text,
  external_id text,
  join_token text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_participants_session ON participants(session_id);
-- Dedupe by external ID when supplied; name-only joins are not deduped.
CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_session_external
  ON participants(session_id, external_id) WHERE external_id IS NOT NULL;

ALTER TABLE votes ADD COLUMN IF NOT EXISTS participant_id uuid REFERENCES participants(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_question_participant
  ON votes(question_id, participant_id) WHERE participant_id IS NOT NULL;

ALTER TABLE participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view participants in their sessions" ON participants;
CREATE POLICY "Users can view participants in their sessions" ON participants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = participants.session_id
      AND sessions.owner_id = auth.uid()
    )
  );

-- Identified votes are written only through submit_identified_vote() below
-- (SECURITY DEFINER, which validates the join token and the option's
-- ownership). Anonymous devices keep inserting directly, but may not attach a
-- participant - that closes off writing identified rows around the RPC.
DROP POLICY IF EXISTS "Anyone can vote" ON votes;
DROP POLICY IF EXISTS "Anyone can vote anonymously" ON votes;
CREATE POLICY "Anyone can vote anonymously" ON votes FOR INSERT TO anon, authenticated
  WITH CHECK (
    participant_id IS NULL
    AND EXISTS (
      SELECT 1 FROM questions q
      JOIN sessions s ON s.id = q.session_id
      WHERE q.id = votes.question_id AND s.is_active = true
    )
  );

-- Lock the session type once voting has started: existing rows may be
-- anonymous (no identity), and switching mid-flight would silently strand them.
CREATE OR REPLACE FUNCTION public.prevent_identity_change_after_votes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (NEW.participation_mode IS DISTINCT FROM OLD.participation_mode
      OR NEW.identity_requires_name IS DISTINCT FROM OLD.identity_requires_name
      OR NEW.identity_requires_id IS DISTINCT FROM OLD.identity_requires_id)
     AND EXISTS (
       SELECT 1 FROM public.votes v
       JOIN public.questions q ON q.id = v.question_id
       WHERE q.session_id = NEW.id
     )
  THEN
    RAISE EXCEPTION 'The session type cannot be changed after voting has started';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_identity_change_after_votes ON sessions;
CREATE TRIGGER prevent_identity_change_after_votes BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION prevent_identity_change_after_votes();

-- join_session: idempotent join for identified sessions. Validates that the
-- session is active and identified, enforces the required fields server-side,
-- and - when an external_id is supplied - resolves a rejoin to the same
-- participant, rotating the join token to the new device.
CREATE OR REPLACE FUNCTION public.join_session(
  p_session_id uuid,
  p_name text,
  p_external_id text,
  p_join_token text
)
RETURNS TABLE (participant_id uuid, participant_name text, participant_external_id text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_external text := nullif(btrim(coalesce(p_external_id, '')), '');
  v_id uuid;
BEGIN
  SELECT * INTO v_session FROM public.sessions
   WHERE id = p_session_id AND is_active = true;

  IF NOT FOUND OR v_session.participation_mode <> 'identified' THEN
    RAISE EXCEPTION 'This session is not accepting identified participants';
  END IF;
  IF v_session.identity_requires_name AND v_name IS NULL THEN
    RAISE EXCEPTION 'A name is required to join';
  END IF;
  IF v_session.identity_requires_id AND v_external IS NULL THEN
    RAISE EXCEPTION 'An ID is required to join';
  END IF;
  IF p_join_token IS NULL OR btrim(p_join_token) = '' THEN
    RAISE EXCEPTION 'A join token is required';
  END IF;

  IF v_external IS NOT NULL THEN
    -- A rejoin with the SAME external_id must also present the SAME
    -- join_token to be treated as the same participant (e.g. a page
    -- reload replaying the token already in localStorage). Without this,
    -- anyone who merely learns another participant's external_id could
    -- call join_session with their own chosen token and silently steal
    -- that participant's identity, since join_token was otherwise
    -- unconditionally overwritten on conflict.
    INSERT INTO public.participants (session_id, name, external_id, join_token)
    VALUES (p_session_id, v_name, v_external, p_join_token)
    ON CONFLICT (session_id, external_id) WHERE external_id IS NOT NULL
    DO UPDATE SET name = EXCLUDED.name
      WHERE public.participants.join_token = EXCLUDED.join_token
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'This ID has already joined this session from a different device';
    END IF;
  ELSE
    INSERT INTO public.participants (session_id, name, external_id, join_token)
    VALUES (p_session_id, v_name, NULL, p_join_token)
    RETURNING id INTO v_id;
  END IF;

  RETURN QUERY
    SELECT p.id, p.name, p.external_id FROM public.participants p WHERE p.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.join_session(uuid, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.join_session(uuid, text, text, text) TO anon, authenticated;

-- submit_identified_vote is defined in full in section 16 (scored quizzes).
-- Dropped here so a re-run replaces the earlier two-column version instead of
-- colliding with the scored signature.
DROP FUNCTION IF EXISTS public.submit_identified_vote(text, uuid, uuid);

-- get_participant_answers: the caller's own answers, keyed by the join token.
-- Lets a participant resume on reload or a new device without exposing anyone
-- else's rows.
CREATE OR REPLACE FUNCTION public.get_participant_answers(p_join_token text)
RETURNS TABLE (answer_question_id uuid, answer_option_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT v.question_id, v.option_id
  FROM public.votes v
  JOIN public.participants p ON p.id = v.participant_id
  WHERE p.join_token = p_join_token;
$$;

REVOKE ALL ON FUNCTION public.get_participant_answers(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_participant_answers(text) TO anon, authenticated;

-- get_participant_count: public aggregate for the presenter lobby, mirroring
-- get_vote_counts - a count, never rows.
CREATE OR REPLACE FUNCTION public.get_participant_count(p_session_id uuid)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT count(*)::bigint
  FROM public.participants p
  WHERE p.session_id = p_session_id
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = p_session_id AND s.is_active = true
    );
$$;

REVOKE ALL ON FUNCTION public.get_participant_count(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_participant_count(uuid) TO anon, authenticated;

-- Owner presenter lobby can subscribe to joins live; realtime respects RLS,
-- so only the owner receives these events.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'participants'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE participants;
  END IF;
END $$;

-- 16. Scored quizzes
-- Opt-in scoring for identified sessions. Each question carries manual points
-- and exactly one correct option. The answer key lives in question_keys, which
-- attendees can never read; submissions are judged server-side inside the
-- SECURITY DEFINER RPC. Timing is per participant: the stopwatch starts at
-- start_scored_session() and finished_at is stamped on the last answer.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_scored boolean NOT NULL DEFAULT false;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS score_time_limit_seconds integer;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS scored_closed boolean NOT NULL DEFAULT false;

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_scored_requires_identified;
ALTER TABLE sessions ADD CONSTRAINT sessions_scored_requires_identified
  CHECK (NOT is_scored OR participation_mode = 'identified');
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_score_time_limit_positive;
ALTER TABLE sessions ADD CONSTRAINT sessions_score_time_limit_positive
  CHECK (score_time_limit_seconds IS NULL OR score_time_limit_seconds > 0);

ALTER TABLE questions ADD COLUMN IF NOT EXISTS points integer NOT NULL DEFAULT 10;
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_points_nonnegative;
ALTER TABLE questions ADD CONSTRAINT questions_points_nonnegative CHECK (points >= 0);

ALTER TABLE participants ADD COLUMN IF NOT EXISTS score integer NOT NULL DEFAULT 0;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS answered_count integer NOT NULL DEFAULT 0;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE participants ADD COLUMN IF NOT EXISTS finished_at timestamptz;

ALTER TABLE votes ADD COLUMN IF NOT EXISTS is_correct boolean;
ALTER TABLE votes ADD COLUMN IF NOT EXISTS awarded_points integer NOT NULL DEFAULT 0;

-- Private answer key. One correct option per question.
CREATE TABLE IF NOT EXISTS question_keys (
  question_id uuid PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES options(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE question_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage question keys in their sessions" ON question_keys;
CREATE POLICY "Users can manage question keys in their sessions" ON question_keys
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM questions q
      JOIN sessions s ON s.id = q.session_id
      WHERE q.id = question_keys.question_id
      AND s.owner_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM questions q
      JOIN sessions s ON s.id = q.session_id
      WHERE q.id = question_keys.question_id
      AND s.owner_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.validate_question_key()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.options o
    WHERE o.id = NEW.option_id AND o.question_id = NEW.question_id
  ) THEN
    RAISE EXCEPTION 'The correct option must belong to its question';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_question_key ON question_keys;
CREATE TRIGGER validate_question_key BEFORE INSERT OR UPDATE ON question_keys
  FOR EACH ROW EXECUTE FUNCTION validate_question_key();

-- Extend the identity lock to cover the scoring configuration.
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
      OR NEW.score_time_limit_seconds IS DISTINCT FROM OLD.score_time_limit_seconds)
     AND EXISTS (
       SELECT 1 FROM public.votes v
       JOIN public.questions q ON q.id = v.question_id
       WHERE q.session_id = NEW.id
     )
  THEN
    RAISE EXCEPTION 'The session type cannot be changed after voting has started';
  END IF;
  RETURN NEW;
END;
$$;

-- Points and answer keys freeze once a question has been answered, so an
-- in-flight scoreboard can't be rewritten.
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_points_change_after_votes ON questions;
CREATE TRIGGER prevent_points_change_after_votes BEFORE UPDATE ON questions
  FOR EACH ROW EXECUTE FUNCTION prevent_points_change_after_votes();

CREATE OR REPLACE FUNCTION public.prevent_key_change_after_votes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_question uuid;
  v_session uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_question := OLD.question_id; ELSE v_question := NEW.question_id; END IF;
  SELECT q.session_id INTO v_session FROM public.questions q WHERE q.id = v_question;

  IF EXISTS (
    SELECT 1 FROM public.votes v
    JOIN public.questions q ON q.id = v.question_id
    WHERE q.session_id = v_session
  ) THEN
    RAISE EXCEPTION 'The answer key cannot change after voting has started';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS prevent_key_change_after_votes ON question_keys;
CREATE TRIGGER prevent_key_change_after_votes BEFORE INSERT OR UPDATE OR DELETE ON question_keys
  FOR EACH ROW EXECUTE FUNCTION prevent_key_change_after_votes();

-- A scored quiz's question set is fixed once answering begins.
CREATE OR REPLACE FUNCTION public.prevent_scored_structure_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_session uuid;
  v_scored boolean;
BEGIN
  IF TG_TABLE_NAME = 'questions' THEN
    IF TG_OP = 'DELETE' THEN v_session := OLD.session_id; ELSE v_session := NEW.session_id; END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      SELECT q.session_id INTO v_session FROM public.questions q WHERE q.id = OLD.question_id;
    ELSE
      SELECT q.session_id INTO v_session FROM public.questions q WHERE q.id = NEW.question_id;
    END IF;
  END IF;

  SELECT s.is_scored INTO v_scored FROM public.sessions s WHERE s.id = v_session;

  IF v_scored AND EXISTS (
    SELECT 1 FROM public.votes v
    JOIN public.questions q ON q.id = v.question_id
    WHERE q.session_id = v_session
  ) THEN
    RAISE EXCEPTION 'Questions and options cannot change after a scored quiz has started';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;

DROP TRIGGER IF EXISTS prevent_scored_structure_change ON questions;
CREATE TRIGGER prevent_scored_structure_change BEFORE INSERT OR DELETE ON questions
  FOR EACH ROW EXECUTE FUNCTION prevent_scored_structure_change();

DROP TRIGGER IF EXISTS prevent_scored_structure_change ON options;
CREATE TRIGGER prevent_scored_structure_change BEFORE INSERT OR DELETE ON options
  FOR EACH ROW EXECUTE FUNCTION prevent_scored_structure_change();

-- start_scored_session: begins (or resumes) a participant's stopwatch. Returns
-- the session's own deadline (null when no limit) plus the quiz shape.
CREATE OR REPLACE FUNCTION public.start_scored_session(p_join_token text)
RETURNS TABLE (started_at timestamptz, deadline timestamptz, question_count integer, total_points integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_participant public.participants%ROWTYPE;
  v_session public.sessions%ROWTYPE;
  v_started timestamptz;
  v_count integer;
  v_total integer;
BEGIN
  SELECT * INTO v_participant FROM public.participants WHERE join_token = p_join_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown participant';
  END IF;

  SELECT * INTO v_session FROM public.sessions WHERE id = v_participant.session_id;
  IF NOT FOUND OR v_session.is_active = false THEN
    RAISE EXCEPTION 'This session is not active';
  END IF;
  IF NOT v_session.is_scored THEN
    RAISE EXCEPTION 'This session is not scored';
  END IF;
  IF v_session.scored_closed THEN
    RAISE EXCEPTION 'This quiz is closed';
  END IF;

  v_started := coalesce(v_participant.started_at, now());
  IF v_participant.started_at IS NULL THEN
    UPDATE public.participants SET started_at = v_started WHERE id = v_participant.id;
  END IF;

  SELECT count(*), coalesce(sum(points), 0) INTO v_count, v_total
  FROM public.questions WHERE session_id = v_session.id;

  RETURN QUERY SELECT
    v_started,
    CASE WHEN v_session.score_time_limit_seconds IS NULL THEN NULL
         ELSE v_started + make_interval(secs => v_session.score_time_limit_seconds) END,
    v_count,
    v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.start_scored_session(text) FROM public;
GRANT EXECUTE ON FUNCTION public.start_scored_session(text) TO anon, authenticated;

-- submit_identified_vote: now judges scored answers. Replaces the earlier
-- two-column version, so drop it first (CREATE OR REPLACE cannot change the
-- OUT column list).
DROP FUNCTION IF EXISTS public.submit_identified_vote(text, uuid, uuid);

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
  v_participant public.participants%ROWTYPE;
  v_session public.sessions%ROWTYPE;
  v_existing public.votes%ROWTYPE;
  v_correct boolean;
  v_points integer := 0;
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

  -- Scored sessions: the host's close and the participant's own deadline are
  -- returned as flags, not raised, so the client can show a result screen.
  IF v_session.is_scored THEN
    IF v_session.scored_closed THEN
      RETURN QUERY SELECT NULL::uuid, false, NULL::boolean, 0, v_participant.score,
        v_participant.answered_count, v_participant.finished_at, false, true;
      RETURN;
    END IF;
    IF v_session.score_time_limit_seconds IS NOT NULL
       AND (v_participant.started_at IS NULL
            OR now() > v_participant.started_at + make_interval(secs => v_session.score_time_limit_seconds)) THEN
      RETURN QUERY SELECT NULL::uuid, false, NULL::boolean, 0, v_participant.score,
        v_participant.answered_count, v_participant.finished_at, true, false;
      RETURN;
    END IF;
  END IF;

  -- Answered before: return the stored row and never score twice.
  SELECT * INTO v_existing FROM public.votes v
   WHERE v.question_id = p_question_id AND v.participant_id = v_participant.id;
  IF FOUND THEN
    RETURN QUERY SELECT v_existing.option_id, false, v_existing.is_correct,
      v_existing.awarded_points, v_participant.score, v_participant.answered_count,
      v_participant.finished_at, false, v_session.scored_closed;
    RETURN;
  END IF;

  IF v_session.is_scored THEN
    SELECT EXISTS (
      SELECT 1 FROM public.question_keys k
      WHERE k.question_id = p_question_id AND k.option_id = p_option_id
    ) INTO v_correct;
    IF v_correct THEN
      SELECT q.points INTO v_points FROM public.questions q WHERE q.id = p_question_id;
      v_points := coalesce(v_points, 0);
    END IF;
  ELSE
    v_correct := NULL;
  END IF;

  INSERT INTO public.votes (option_id, question_id, voter_token, participant_id, is_correct, awarded_points)
  VALUES (p_option_id, p_question_id, v_participant.id::text, v_participant.id, v_correct, v_points);

  UPDATE public.participants p
     SET score = p.score + v_points,
         answered_count = p.answered_count + 1,
         finished_at = CASE
           WHEN p.finished_at IS NOT NULL THEN p.finished_at
           WHEN p.answered_count + 1 >= (
             SELECT count(*) FROM public.questions q WHERE q.session_id = v_participant.session_id
           ) THEN now()
           ELSE NULL
         END
   WHERE p.id = v_participant.id
  RETURNING p.score, p.answered_count, p.finished_at INTO v_score, v_answered, v_finished;

  RETURN QUERY SELECT p_option_id, true, v_correct, v_points, v_score, v_answered, v_finished, false, false;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_identified_vote(text, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_identified_vote(text, uuid, uuid) TO anon, authenticated;

-- get_participant_standing: a participant's own score and rank only.
CREATE OR REPLACE FUNCTION public.get_participant_standing(p_join_token text)
RETURNS TABLE (total_score integer, participant_rank bigint, total_participants bigint, answered_count integer, finished_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT p.score, r.rnk, r.total, p.answered_count, p.finished_at
  FROM public.participants p
  JOIN (
    SELECT id,
           rank() OVER (ORDER BY score DESC, finished_at ASC NULLS LAST) AS rnk,
           count(*) OVER () AS total
    FROM public.participants p2
    WHERE p2.session_id = (SELECT session_id FROM public.participants WHERE join_token = p_join_token)
  ) r ON r.id = p.id
  WHERE p.join_token = p_join_token;
$$;

REVOKE ALL ON FUNCTION public.get_participant_standing(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_participant_standing(text) TO anon, authenticated;

-- get_quiz_review: correct answers, but only once the host has closed the quiz.
CREATE OR REPLACE FUNCTION public.get_quiz_review(p_join_token text)
RETURNS TABLE (
  review_question_id uuid,
  review_question_text text,
  chosen_option_id uuid,
  chosen_option_text text,
  correct_option_id uuid,
  correct_option_text text,
  review_awarded_points integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT q.id, q.text, v.option_id, o.text, k.option_id, co.text, v.awarded_points
  FROM public.participants p
  JOIN public.sessions s ON s.id = p.session_id
  JOIN public.questions q ON q.session_id = s.id
  LEFT JOIN public.votes v ON v.question_id = q.id AND v.participant_id = p.id
  LEFT JOIN public.options o ON o.id = v.option_id
  LEFT JOIN public.question_keys k ON k.question_id = q.id
  LEFT JOIN public.options co ON co.id = k.option_id
  WHERE p.join_token = p_join_token
    AND s.scored_closed = true
  ORDER BY q.order_index;
$$;

REVOKE ALL ON FUNCTION public.get_quiz_review(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_quiz_review(text) TO anon, authenticated;

-- get_leaderboard: the shareable ranked standings for a scored quiz. Unlike
-- get_participant_standing (self only), this returns every participant's
-- display name and score so attendees can see a live competitive board. It is
-- deliberately coarse-grained: only scores, counts and timestamps, never the
-- underlying answers or join tokens, and only for a session that is active
-- and scored.
CREATE OR REPLACE FUNCTION public.get_leaderboard(p_session_id uuid)
RETURNS TABLE (
  participant_id uuid,
  display_name text,
  score integer,
  answered_count integer,
  finished_at timestamptz,
  rank bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT sub.id, sub.display_name, sub.score, sub.answered_count, sub.finished_at, sub.rnk
  FROM (
    SELECT p.id,
           coalesce(p.name, p.external_id, 'Player') AS display_name,
           p.score,
           p.answered_count,
           p.finished_at,
           rank() OVER (ORDER BY p.score DESC, p.finished_at ASC NULLS LAST) AS rnk
    FROM public.participants p
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

-- 17. Session types
-- The organizer-facing "session type" is a thin label over the existing
-- participation_mode/is_scored flags, kept so every RPC, RLS policy and
-- constraint written above keeps working unchanged:
--   poll     -> participation_mode='anonymous', is_scored=false
--   quiz     -> participation_mode='identified', is_scored=true (see section 19
--               for the "every quiz is scored" migration; the CHECK below stays
--               permissive so a legacy unscored quiz that already has votes,
--               frozen by prevent_points_change_after_votes, remains valid)
--   comments -> participation_mode='identified', is_scored=false
--   treasure_hunt -> participation_mode='anonymous', is_scored=false (see
--               section 20 - added later, so its membership check is a
--               separate, named constraint rather than this inline one)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_type text NOT NULL DEFAULT 'poll'
  CHECK (session_type IN ('poll', 'quiz', 'comments'));

-- Backfill existing rows from their current flags before the consistency
-- constraint below would otherwise reject them.
UPDATE sessions SET session_type =
  CASE WHEN participation_mode = 'identified' THEN 'quiz' ELSE 'poll' END
WHERE session_type = 'poll' AND participation_mode = 'identified';

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_type_consistency;
ALTER TABLE sessions ADD CONSTRAINT sessions_type_consistency CHECK (
     (session_type = 'poll'     AND participation_mode = 'anonymous'  AND NOT is_scored)
  OR (session_type = 'quiz'     AND participation_mode = 'identified')
  OR (session_type = 'comments' AND participation_mode = 'identified' AND NOT is_scored)
);

-- An image + prompt for a 'comments' session's question row. Unused by poll
-- and quiz questions.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS image_url text;

-- Image uploads for comments sessions: public-read bucket, owners write only
-- under <their uid>/, same shape as session-logos above.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('session-images', 'session-images', true, 5242880,
        ARRAY['image/png','image/jpeg','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "session_images_owner_insert" ON storage.objects;
CREATE POLICY "session_images_owner_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK ((select public.is_organizer()) AND bucket_id = 'session-images' AND (storage.foldername(name))[1] = (select auth.uid())::text);
DROP POLICY IF EXISTS "session_images_owner_update" ON storage.objects;
CREATE POLICY "session_images_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING ((select public.is_organizer()) AND bucket_id = 'session-images' AND (storage.foldername(name))[1] = (select auth.uid())::text);
DROP POLICY IF EXISTS "session_images_owner_delete" ON storage.objects;
CREATE POLICY "session_images_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING ((select public.is_organizer()) AND bucket_id = 'session-images' AND (storage.foldername(name))[1] = (select auth.uid())::text);

-- Comments: free-text responses to an image+prompt question, from named
-- (identified) participants only. Like votes, this table is never read
-- directly by attendees - it holds participant_id, and a direct SELECT policy
-- would let anyone correlate a named person's comments. All attendee access
-- goes through the two SECURITY DEFINER functions below.
CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comments_question ON comments(question_id, created_at DESC);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage comments in their sessions" ON comments;
CREATE POLICY "Users can manage comments in their sessions" ON comments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM questions q
      JOIN sessions s ON s.id = q.session_id
      WHERE q.id = comments.question_id
      AND s.owner_id = auth.uid()
    )
  );

-- submit_comment: validates the participant's token, that the question
-- belongs to their own session, the body length, and - when the presenter is
-- driving the session - that this question is the one currently on screen.
-- That last check is stricter than the plain "Anyone can vote" insert path:
-- a comment cannot be backdated onto a question the room has moved past.
CREATE OR REPLACE FUNCTION public.submit_comment(
  p_join_token text,
  p_question_id uuid,
  p_body text
)
RETURNS TABLE (comment_id uuid, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_participant public.participants%ROWTYPE;
  v_session public.sessions%ROWTYPE;
  v_question public.questions%ROWTYPE;
  v_body text := btrim(coalesce(p_body, ''));
  v_index integer;
  v_id uuid;
  v_created timestamptz;
BEGIN
  SELECT * INTO v_participant FROM public.participants WHERE join_token = p_join_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown participant';
  END IF;

  SELECT * INTO v_session FROM public.sessions WHERE id = v_participant.session_id;
  IF NOT FOUND OR v_session.is_active = false THEN
    RAISE EXCEPTION 'This session is not active';
  END IF;
  IF v_session.session_type <> 'comments' THEN
    RAISE EXCEPTION 'This session does not accept comments';
  END IF;

  SELECT * INTO v_question FROM public.questions
   WHERE id = p_question_id AND session_id = v_session.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That image does not belong to this session';
  END IF;

  IF char_length(v_body) < 1 OR char_length(v_body) > 500 THEN
    RAISE EXCEPTION 'A comment must be between 1 and 500 characters';
  END IF;

  -- Presenter-driven session: only the question currently on screen accepts
  -- comments. Self-paced sessions (current_question_index IS NULL) accept a
  -- comment on any of the session's own questions.
  --
  -- The position must be computed over ALL of the session's questions before
  -- filtering to p_question_id - filtering first would leave a one-row set,
  -- where row_number() always returns 1 (index 0) regardless of the
  -- question's real order, making every image past the first fail this check.
  IF v_session.current_question_index IS NOT NULL THEN
    SELECT sub.idx INTO v_index FROM (
      SELECT id, (row_number() OVER (ORDER BY order_index) - 1) AS idx
      FROM public.questions WHERE session_id = v_session.id
    ) sub WHERE sub.id = p_question_id;

    IF v_index IS DISTINCT FROM v_session.current_question_index THEN
      RAISE EXCEPTION 'This image is not currently open for comments';
    END IF;
  END IF;

  INSERT INTO public.comments (question_id, participant_id, body)
  VALUES (p_question_id, v_participant.id, v_body)
  RETURNING id, comments.created_at INTO v_id, v_created;

  RETURN QUERY SELECT v_id, v_created;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_comment(text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_comment(text, uuid, text) TO anon, authenticated;

-- get_comments: the session owner's live wall, with each comment attributed
-- to its author's display name. Unlike get_vote_counts (a public aggregate),
-- this returns attributed text, so it is owner-only - the DB, not just the
-- protected /present route, is what actually stops another attendee from
-- calling this RPC directly and dumping everyone's comments.
CREATE OR REPLACE FUNCTION public.get_comments(p_session_id uuid, p_question_id uuid DEFAULT NULL)
RETURNS TABLE (
  comment_id uuid,
  comment_question_id uuid,
  comment_body text,
  author_name text,
  comment_created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT c.id, c.question_id, c.body,
         coalesce(p.name, p.external_id, 'Anonymous'), c.created_at
  FROM public.comments c
  JOIN public.questions q ON q.id = c.question_id
  JOIN public.participants p ON p.id = c.participant_id
  WHERE q.session_id = p_session_id
    AND (p_question_id IS NULL OR c.question_id = p_question_id)
    AND public.is_organizer()
    AND EXISTS (
      SELECT 1 FROM public.sessions s
      WHERE s.id = p_session_id AND s.owner_id = auth.uid()
    )
  ORDER BY c.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_comments(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_comments(uuid, uuid) TO anon, authenticated;

-- get_own_comments: a participant's own comments on one image, keyed by their
-- join token - the attendee-facing counterpart to get_comments, exposing no
-- other participant's name or text.
CREATE OR REPLACE FUNCTION public.get_own_comments(p_join_token text, p_question_id uuid)
RETURNS TABLE (comment_id uuid, comment_body text, comment_created_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT c.id, c.body, c.created_at
  FROM public.comments c
  JOIN public.participants p ON p.id = c.participant_id
  WHERE p.join_token = p_join_token
    AND c.question_id = p_question_id
  ORDER BY c.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.get_own_comments(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_own_comments(text, uuid) TO anon, authenticated;

-- Presenter's comment wall subscribes live; realtime respects RLS, and
-- comments has no attendee SELECT policy, so only the owner receives events.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'comments'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE comments;
  END IF;
END $$;

-- ============================================================================
-- 18. AI assistant usage metering
-- ============================================================================

-- The /api/assistant endpoint spends real money per call, and any signed-up
-- user can reach it, so usage is metered per user. There is no Redis and no
-- service-role key in this project, so the counter lives in Postgres and is
-- read through the caller's own RLS-bound client.
CREATE TABLE IF NOT EXISTS ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_time ON ai_usage(user_id, created_at DESC);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

-- Users may only see and record their own usage. A user cannot read anyone
-- else's counter, and cannot insert a row attributed to another user, so the
-- limit cannot be evaded by writing rows as someone else.
DROP POLICY IF EXISTS "Users can view their own AI usage" ON ai_usage;
CREATE POLICY "Users can view their own AI usage" ON ai_usage FOR SELECT
  TO authenticated USING ((select public.is_organizer()) AND (select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can record their own AI usage" ON ai_usage;
CREATE POLICY "Users can record their own AI usage" ON ai_usage FOR INSERT
  TO authenticated WITH CHECK ((select public.is_organizer()) AND (select auth.uid()) = user_id);

-- ============================================================================
-- 19. Every quiz is scored
-- ============================================================================

-- The "Scored quiz" checkbox is gone from the UI: session_type='quiz' now
-- always implies is_scored=true going forward. A quiz that already has votes
-- is left untouched (its points/answer key are frozen by
-- prevent_points_change_after_votes, so it could not be safely turned into a
-- scored quiz retroactively); the app labels those as legacy unscored quizzes.
UPDATE sessions SET is_scored = true
WHERE session_type = 'quiz'
  AND NOT is_scored
  AND NOT EXISTS (
    SELECT 1 FROM votes v
    JOIN questions q ON q.id = v.question_id
    WHERE q.session_id = sessions.id
  );

-- ============================================================================
-- 20. Host-paced quiz: Lock -> Reveal -> Leaderboard
-- ============================================================================

-- A scored quiz is no longer self-paced. The presenter screen drives it like
-- a poll: current_question_index picks the open question, results_revealed
-- gates the reveal step, and this new flag gates the leaderboard step that
-- follows it. A participant's "Answer submitted" locks a choice with no
-- judging; reveal_quiz_question() below judges every locked answer for the
-- open question at once and adds the points, so nothing about correctness or
-- score ever leaks before the host reveals.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS show_leaderboard boolean NOT NULL DEFAULT false;

-- submit_identified_vote: a scored quiz now only accepts a lock for the
-- question currently open on the presenter screen, before it is revealed,
-- and never judges it - is_correct/awarded_points stay NULL/0 until
-- reveal_quiz_question() runs. A legacy unscored quiz (is_scored=false) is
-- unaffected: it keeps behaving exactly as before this migration.
DROP FUNCTION IF EXISTS public.submit_identified_vote(text, uuid, uuid);

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

-- reveal_quiz_question: the host action that judges every locked (unjudged)
-- answer for the currently open question against question_keys, awards
-- points once each, and flips results_revealed. Owner-only. Idempotent - a
-- second call finds no unjudged votes left and does nothing.
CREATE OR REPLACE FUNCTION public.reveal_quiz_question(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.sessions%ROWTYPE;
  v_question_id uuid;
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

  SELECT id INTO v_question_id FROM public.questions
  WHERE session_id = p_session_id AND order_index = v_session.current_question_index;
  IF v_question_id IS NULL THEN
    RAISE EXCEPTION 'No question at this position';
  END IF;

  WITH judged AS (
    UPDATE public.votes v
    SET is_correct = (k.option_id IS NOT NULL AND k.option_id = v.option_id),
        awarded_points = CASE WHEN k.option_id IS NOT NULL AND k.option_id = v.option_id
                               THEN coalesce(q.points, 0) ELSE 0 END
    FROM public.questions q
    LEFT JOIN public.question_keys k ON k.question_id = q.id
    WHERE v.question_id = v_question_id
      AND q.id = v_question_id
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

  UPDATE public.sessions SET results_revealed = true, show_leaderboard = false WHERE id = p_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reveal_quiz_question(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.reveal_quiz_question(uuid) TO authenticated;

-- get_question_result: a participant's own correct/wrong + points for one
-- question, visible only once that question has been revealed (its position
-- is before the current one, or it is current and results_revealed is set).
-- Before that, returns no rows - there is nothing to leak.
CREATE OR REPLACE FUNCTION public.get_question_result(p_join_token text, p_question_id uuid)
RETURNS TABLE (
  correct_option_id uuid,
  chosen_option_id uuid,
  is_correct boolean,
  awarded_points integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
DECLARE
  v_participant public.participants%ROWTYPE;
  v_session public.sessions%ROWTYPE;
  v_question public.questions%ROWTYPE;
  v_revealed boolean;
BEGIN
  SELECT * INTO v_participant FROM public.participants WHERE join_token = p_join_token;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_session FROM public.sessions WHERE id = v_participant.session_id;
  SELECT * INTO v_question FROM public.questions WHERE id = p_question_id AND session_id = v_session.id;
  IF NOT FOUND THEN RETURN; END IF;

  v_revealed := v_session.current_question_index IS NOT NULL AND (
    v_question.order_index < v_session.current_question_index
    OR (v_question.order_index = v_session.current_question_index AND v_session.results_revealed)
  );
  IF NOT v_revealed THEN RETURN; END IF;

  RETURN QUERY
  SELECT k.option_id, v.option_id, v.is_correct, coalesce(v.awarded_points, 0)
  FROM (SELECT 1 AS x) dummy
  LEFT JOIN public.question_keys k ON k.question_id = p_question_id
  LEFT JOIN public.votes v ON v.question_id = p_question_id AND v.participant_id = v_participant.id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_question_result(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_question_result(text, uuid) TO anon, authenticated;

-- get_vote_counts: for a scored quiz, an option's count only counts votes
-- already judged (is_correct IS NOT NULL) - i.e. only once its question has
-- been revealed - so the split can't hint at the answer beforehand. A poll's
-- counts (is_scored=false) are unaffected.
CREATE OR REPLACE FUNCTION public.get_vote_counts(p_session_id uuid)
RETURNS TABLE (opt_id uuid, q_id uuid, vote_total bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT o.id, q.id, count(v.id) FILTER (WHERE NOT s.is_scored OR v.is_correct IS NOT NULL)
  FROM public.questions q
  JOIN public.sessions s ON s.id = q.session_id
  JOIN public.options o ON o.question_id = q.id
  LEFT JOIN public.votes v ON v.option_id = o.id
  WHERE q.session_id = p_session_id
    AND EXISTS (
      SELECT 1 FROM public.sessions s2
      WHERE s2.id = p_session_id AND s2.is_active = true
    )
  GROUP BY o.id, q.id;
$$;

REVOKE ALL ON FUNCTION public.get_vote_counts(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_vote_counts(uuid) TO anon, authenticated;

-- 20. Treasure Hunt session type
-- The organizer hides QR-coded Clues; whoever scans one reads its message.
-- Clues reuse the `questions` table (text = message, order_index = clue
-- number); no options or scoring apply, and participation is anonymous - like
-- a poll, but its own session_type so every RPC/policy above can tell it
-- apart from a real poll's questions.
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_session_type_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_session_type_check
  CHECK (session_type IN ('poll', 'quiz', 'comments', 'treasure_hunt'));

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_type_consistency;
ALTER TABLE sessions ADD CONSTRAINT sessions_type_consistency CHECK (
     (session_type = 'poll'          AND participation_mode = 'anonymous'  AND NOT is_scored)
  OR (session_type = 'quiz'          AND participation_mode = 'identified')
  OR (session_type = 'comments'      AND participation_mode = 'identified' AND NOT is_scored)
  OR (session_type = 'treasure_hunt' AND participation_mode = 'anonymous'  AND NOT is_scored)
);

-- Each clue gets a random, unguessable, permanent token at creation. Never
-- regenerated on edit, so printed QR codes keep working across text edits.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS clue_token text UNIQUE
  DEFAULT encode(extensions.gen_random_bytes(9), 'hex');

-- Optional organizer-facing caption printed with the clue's QR code. Never
-- returned by get_clue(); falls back to "Clue #N" in the UI when null.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS clue_label text;

-- Attendees never select `questions` directly for a Treasure Hunt (that would
-- expose every clue's message and token to anyone who found one). They only
-- ever reach a clue's message through get_clue(), scoped to its own token.
DROP POLICY IF EXISTS "Anyone can view questions for active sessions" ON questions;
CREATE POLICY "Anyone can view questions for active sessions" ON questions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM sessions
      WHERE sessions.id = questions.session_id
      AND sessions.is_active = true
      AND sessions.session_type <> 'treasure_hunt'
    )
  );

-- Public scan endpoint for /h/<token>. Returns only what that one clue's
-- token unlocks - never the session's other clues - and only while the
-- session is active; the message itself is withheld otherwise.
CREATE OR REPLACE FUNCTION public.get_clue(p_token text)
RETURNS TABLE (
  status text,
  clue_message text,
  clue_number integer,
  session_title text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
DECLARE
  v_question public.questions;
  v_session public.sessions;
BEGIN
  SELECT * INTO v_question FROM public.questions WHERE clue_token = p_token;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'missing'::text, NULL::text, NULL::integer, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_session FROM public.sessions WHERE id = v_question.session_id;
  IF NOT FOUND OR v_session.session_type <> 'treasure_hunt' THEN
    RETURN QUERY SELECT 'missing'::text, NULL::text, NULL::integer, NULL::text;
    RETURN;
  END IF;

  IF NOT v_session.is_active THEN
    RETURN QUERY SELECT 'not_live'::text, NULL::text, v_question.order_index + 1, v_session.title;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'live'::text, v_question.text, v_question.order_index + 1, v_session.title;
END;
$$;

REVOKE ALL ON FUNCTION public.get_clue(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_clue(text) TO anon, authenticated;

-- ============================================================================
-- 21. Rate limiting: anonymous votes and organizer write volume
-- ============================================================================

-- Anonymous votes used to be a raw INSERT allowed by "Anyone can vote"
-- (WITH CHECK (true)) with a client-generated voter_token, so nothing stopped
-- votes into inactive sessions, closed questions, or mismatched options, or a
-- script minting tokens. They now go through submit_anonymous_vote, which
-- validates the vote and caps votes per network per question.
ALTER TABLE votes ADD COLUMN IF NOT EXISTS voter_ip_hash text;
CREATE INDEX IF NOT EXISTS idx_votes_question_ip ON votes(question_id, voter_ip_hash);

CREATE OR REPLACE FUNCTION public.submit_anonymous_vote(
  p_voter_token text,
  p_question_id uuid,
  p_option_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- Per question, per network. Generous on purpose: a whole room on one
  -- conference Wi-Fi shares a single IP. It stops scripted stuffing, not crowds.
  c_ip_cap CONSTANT integer := 300;
  v_session public.sessions%ROWTYPE;
  v_question public.questions%ROWTYPE;
  v_index integer;
  v_ip text;
  v_ip_hash text;
BEGIN
  IF p_voter_token IS NULL OR char_length(p_voter_token) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid voter token';
  END IF;

  SELECT * INTO v_question FROM public.questions WHERE id = p_question_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown question';
  END IF;

  SELECT * INTO v_session FROM public.sessions WHERE id = v_question.session_id;
  IF NOT FOUND OR v_session.is_active = false THEN
    RAISE EXCEPTION 'This session is not active';
  END IF;
  IF v_session.participation_mode <> 'anonymous' THEN
    RAISE EXCEPTION 'This session requires joining first';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.options WHERE id = p_option_id AND question_id = p_question_id
  ) THEN
    RAISE EXCEPTION 'That option does not belong to the question';
  END IF;

  -- Presenter-driven session: only the question on screen accepts votes, and
  -- not once its results are revealed. Self-paced (index IS NULL) accepts any.
  IF v_session.current_question_index IS NOT NULL THEN
    SELECT sub.idx INTO v_index FROM (
      SELECT id, (row_number() OVER (ORDER BY order_index) - 1) AS idx
      FROM public.questions WHERE session_id = v_session.id
    ) sub WHERE sub.id = p_question_id;

    IF v_index IS DISTINCT FROM v_session.current_question_index
       OR v_session.results_revealed THEN
      RAISE EXCEPTION 'This question is not open for votes';
    END IF;
  END IF;

  -- Only a hash of the caller's IP is stored. Absent header (e.g. local dev)
  -- skips the cap rather than failing the vote.
  v_ip := btrim(split_part(
    coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1));
  IF v_ip <> '' THEN
    v_ip_hash := md5(v_ip);
    IF (SELECT count(*) FROM public.votes
         WHERE question_id = p_question_id AND voter_ip_hash = v_ip_hash) >= c_ip_cap THEN
      RAISE EXCEPTION 'Too many votes from this network';
    END IF;
  END IF;

  -- A repeat from the same browser is a no-op, matching the old 23505 handling.
  INSERT INTO public.votes (option_id, question_id, voter_token, voter_ip_hash)
  VALUES (p_option_id, p_question_id, p_voter_token, v_ip_hash)
  ON CONFLICT (question_id, voter_token) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_anonymous_vote(text, uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_anonymous_vote(text, uuid, uuid) TO anon, authenticated;

-- With RLS on and no INSERT policy, raw inserts are denied: the RPC above is
-- the only way in. An earlier section replaced "Anyone can vote" with the "anonymously"
-- variant, so drop both names.
DROP POLICY IF EXISTS "Anyone can vote" ON votes;
DROP POLICY IF EXISTS "Anyone can vote anonymously" ON votes;

-- Organizer write volume. One editor save writes many rows, so a per-request
-- limit doesn't fit; cap the volume at the table instead.
CREATE OR REPLACE FUNCTION public.limit_sessions_per_hour()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (SELECT count(*) FROM public.sessions
       WHERE owner_id = NEW.owner_id
         AND created_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'You have created too many sessions in the last hour. Try again later.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS limit_sessions_per_hour ON sessions;
CREATE TRIGGER limit_sessions_per_hour
  BEFORE INSERT ON sessions
  FOR EACH ROW EXECUTE FUNCTION public.limit_sessions_per_hour();

CREATE OR REPLACE FUNCTION public.limit_questions_per_session()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (SELECT count(*) FROM public.questions WHERE session_id = NEW.session_id) >= 200 THEN
    RAISE EXCEPTION 'A session can have at most 200 questions.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS limit_questions_per_session ON questions;
CREATE TRIGGER limit_questions_per_session
  BEFORE INSERT ON questions
  FOR EACH ROW EXECUTE FUNCTION public.limit_questions_per_session();

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
