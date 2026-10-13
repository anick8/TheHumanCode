-- Ticket: Account page analytics. One read-only RPC gives the signed-in
-- organizer their totals, weekly activity and busiest sessions.
-- Totals, a 12-week activity series and the busiest sessions for the signed-in
-- organizer's own sessions, for the Account page. "Responses" is votes plus
-- comments. "People" is identified participants plus distinct anonymous voter
-- tokens. Weeks start on Monday in India time, the same day reference as Grants,
-- and weeks with no activity are present with a zero. Read-only, so a lapsed
-- account can still see its numbers.
CREATE OR REPLACE FUNCTION public.account_stats()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  WITH mine AS (
    SELECT s.id, s.title, s.slug, s.session_type
    FROM public.sessions s
    WHERE s.owner_id = auth.uid()
  ),
  qs AS (
    SELECT q.id, q.session_id, q.opened_at
    FROM public.questions q
    JOIN mine ON mine.id = q.session_id
  ),
  v AS (
    SELECT qs.session_id, vt.voter_token, vt.participant_id, vt.created_at
    FROM public.votes vt
    JOIN qs ON qs.id = vt.question_id
  ),
  c AS (
    SELECT qs.session_id, cm.created_at
    FROM public.comments cm
    JOIN qs ON qs.id = cm.question_id
  ),
  p AS (
    SELECT pt.session_id
    FROM public.participants pt
    JOIN mine ON mine.id = pt.session_id
  ),
  w AS (
    SELECT ws.session_id, ws.created_at
    FROM public.wheel_spins ws
    JOIN mine ON mine.id = ws.session_id
  ),
  anon AS (
    SELECT DISTINCT session_id, voter_token FROM v WHERE participant_id IS NULL
  ),
  activity AS (
    SELECT session_id, created_at AS happened_at FROM v
    UNION ALL SELECT session_id, created_at FROM c
    UNION ALL SELECT session_id, created_at FROM w
    UNION ALL SELECT session_id, opened_at FROM qs WHERE opened_at IS NOT NULL
  ),
  per AS (
    SELECT m.id, m.title, m.slug, m.session_type,
      (SELECT count(*) FROM v WHERE v.session_id = m.id)
        + (SELECT count(*) FROM c WHERE c.session_id = m.id) AS responses,
      (SELECT count(*) FROM p WHERE p.session_id = m.id)
        + (SELECT count(*) FROM anon WHERE anon.session_id = m.id) AS people,
      (SELECT max(a.happened_at) FROM activity a WHERE a.session_id = m.id) AS last_activity_at
    FROM mine m
  ),
  weeks AS (
    SELECT (date_trunc('week', now() AT TIME ZONE 'Asia/Kolkata') - n * interval '7 days')::date AS week_start
    FROM generate_series(11, 0, -1) n
  ),
  responses AS (
    SELECT created_at FROM v
    UNION ALL SELECT created_at FROM c
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'sessions', (SELECT count(*) FROM mine),
      'by_type', coalesce(
        (SELECT jsonb_object_agg(t.session_type, t.n)
         FROM (SELECT session_type, count(*) AS n FROM mine GROUP BY session_type) t),
        '{}'::jsonb),
      'questions', (SELECT count(*) FROM qs),
      'votes', (SELECT count(*) FROM v),
      'comments', (SELECT count(*) FROM c),
      'responses', (SELECT count(*) FROM responses),
      'participants', (SELECT count(*) FROM p),
      'anonymous_voters', (SELECT count(*) FROM anon),
      'people', (SELECT count(*) FROM p) + (SELECT count(*) FROM anon),
      'wheel_spins', (SELECT count(*) FROM w),
      'sessions_run', (SELECT count(DISTINCT session_id) FROM activity),
      'last_activity_at', (SELECT max(happened_at) FROM activity)
    ),
    'weekly', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'week_start', wk.week_start,
          'responses', (
            SELECT count(*) FROM responses r
            WHERE date_trunc('week', r.created_at AT TIME ZONE 'Asia/Kolkata')::date = wk.week_start
          )
        )
        ORDER BY wk.week_start
      )
      FROM weeks wk
    ),
    'top_sessions', coalesce(
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.responses DESC, t.last_activity_at DESC NULLS LAST)
       FROM (
         SELECT id, title, slug, session_type, responses, people, last_activity_at
         FROM per
         WHERE responses > 0
         ORDER BY responses DESC, last_activity_at DESC NULLS LAST
         LIMIT 5
       ) t),
      '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.account_stats() FROM public;
REVOKE EXECUTE ON FUNCTION public.account_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.account_stats() TO authenticated;
