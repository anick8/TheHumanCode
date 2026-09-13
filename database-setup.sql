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
  WITH CHECK (bucket_id = 'session-logos' AND (storage.foldername(name))[1] = (select auth.uid())::text);
DROP POLICY IF EXISTS "session_logos_owner_update" ON storage.objects;
CREATE POLICY "session_logos_owner_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'session-logos' AND (storage.foldername(name))[1] = (select auth.uid())::text);
DROP POLICY IF EXISTS "session_logos_owner_delete" ON storage.objects;
CREATE POLICY "session_logos_owner_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'session-logos' AND (storage.foldername(name))[1] = (select auth.uid())::text);

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
  FOR ALL USING (auth.uid() = owner_id);

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
