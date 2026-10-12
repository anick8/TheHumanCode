-- ============================================================================
-- 30. Rentals: Super admin and time-boxed organizer access (Grants)
-- ============================================================================

-- Super admin is separate from Organizer: its own table of emails with no
-- policies (invisible and unwritable from the browser), answered by a
-- SECURITY DEFINER predicate. Managed from the backend (psql), never the app.
CREATE TABLE IF NOT EXISTS super_admins (
  email text PRIMARY KEY CHECK (email = lower(email)),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies.

INSERT INTO super_admins (email) VALUES ('anick8ak@gmail.com')
ON CONFLICT (email) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.super_admins s
    JOIN auth.users u ON lower(u.email) = s.email
    WHERE u.id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon, authenticated;

-- A Grant is a row of the organizer allowlist. starts_at defaults to now() and
-- existing rows keep the migration time, so they are already started. A null
-- expires_at never expires, a null revoked_at is not revoked, a null
-- ai_allowance is unlimited. Renewal edits the dates in place.
ALTER TABLE allowed_emails ADD COLUMN IF NOT EXISTS starts_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE allowed_emails ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE allowed_emails ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE allowed_emails ADD COLUMN IF NOT EXISTS ai_allowance integer
  CHECK (ai_allowance IS NULL OR ai_allowance >= 0);

-- How long an Organizer keeps working after a Grant ends, so a live event that
-- runs late is not cut off. Expiry only: revocation never gets a grace.
CREATE OR REPLACE FUNCTION public.organizer_grace()
RETURNS interval
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$ SELECT interval '6 hours' $$;

-- The access state of an account: admin, active, upcoming, expired, revoked
-- or none. 'active' includes the grace window. Not callable by clients (it
-- takes any user id); the predicates and RPCs below are the interface.
CREATE OR REPLACE FUNCTION public.organizer_state_for(p_user uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT CASE
    WHEN p_user IS NULL THEN 'none'
    WHEN EXISTS (
      SELECT 1 FROM public.super_admins s
      JOIN auth.users u ON lower(u.email) = s.email
      WHERE u.id = p_user
    ) THEN 'admin'
    ELSE coalesce((
      SELECT CASE
        WHEN a.revoked_at IS NOT NULL THEN 'revoked'
        WHEN a.starts_at > now() THEN 'upcoming'
        WHEN a.expires_at IS NULL OR now() < a.expires_at + public.organizer_grace() THEN 'active'
        ELSE 'expired'
      END
      FROM public.allowed_emails a
      JOIN auth.users u ON lower(u.email) = a.email
      WHERE u.id = p_user
    ), 'none')
  END;
$$;

REVOKE ALL ON FUNCTION public.organizer_state_for(uuid) FROM public, anon, authenticated;

-- AI calls a user has made inside their Grant window: from the Grant start to
-- its end, open-ended without one. All calls for an account with no Grant.
-- Moving the dates moves the window, which restarts the count.
CREATE OR REPLACE FUNCTION public.ai_calls_in_window(p_user uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT count(*)::integer
  FROM public.ai_usage au
  LEFT JOIN auth.users u ON u.id = au.user_id
  LEFT JOIN public.allowed_emails a ON a.email = lower(u.email)
  WHERE au.user_id = p_user
    AND (a.email IS NULL OR (
      au.created_at >= a.starts_at
      AND (a.expires_at IS NULL OR au.created_at <= a.expires_at)
    ));
$$;

REVOKE ALL ON FUNCTION public.ai_calls_in_window(uuid) FROM public, anon, authenticated;

-- Organizer predicate: a Super admin, or a Grant that is not revoked, has
-- started, and has no end or an end within the grace. Every Organizer
-- capability already routes through this one function.
CREATE OR REPLACE FUNCTION public.is_organizer()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT public.organizer_state_for(auth.uid()) IN ('admin', 'active');
$$;

REVOKE ALL ON FUNCTION public.is_organizer() FROM public;
GRANT EXECUTE ON FUNCTION public.is_organizer() TO anon, authenticated;

-- What the dashboard, middleware and /pending read, so the UI never derives
-- access from raw dates. One row for the caller: state, Grant start and end,
-- AI calls used in the Grant window and the AI allowance (null = unlimited).
CREATE OR REPLACE FUNCTION public.organizer_access_status()
RETURNS TABLE (state text, starts_at timestamptz, expires_at timestamptz, ai_used integer, ai_allowance integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT
    public.organizer_state_for(auth.uid()),
    a.starts_at,
    a.expires_at,
    CASE WHEN auth.uid() IS NULL THEN 0 ELSE public.ai_calls_in_window(auth.uid()) END,
    CASE WHEN public.organizer_state_for(auth.uid()) = 'admin' THEN NULL ELSE a.ai_allowance END
  FROM (SELECT 1) one
  LEFT JOIN auth.users u ON u.id = auth.uid()
  LEFT JOIN public.allowed_emails a ON a.email = lower(u.email);
$$;

REVOKE ALL ON FUNCTION public.organizer_access_status() FROM public;
GRANT EXECUTE ON FUNCTION public.organizer_access_status() TO anon, authenticated;

-- Grants and Leads are Super admin only. Policies are the real gate; the
-- /admin route guard is UX. There is no service-role key in this project.
DROP POLICY IF EXISTS "Super admins manage Grants" ON allowed_emails;
CREATE POLICY "Super admins manage Grants" ON allowed_emails FOR ALL
  TO authenticated USING ((select public.is_super_admin()))
  WITH CHECK ((select public.is_super_admin()));

DROP POLICY IF EXISTS "Super admins read Leads" ON leads;
CREATE POLICY "Super admins read Leads" ON leads FOR SELECT
  TO authenticated USING ((select public.is_super_admin()));

-- Grant list for /admin, joined with account data. Refuses non-Super-admins.
CREATE OR REPLACE FUNCTION public.admin_list_grants()
RETURNS TABLE (
  email text, note text, created_at timestamptz,
  starts_at timestamptz, expires_at timestamptz, revoked_at timestamptz,
  ai_allowance integer, status text,
  session_count integer, ai_used integer, last_sign_in_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
#variable_conflict use_column
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.email, a.note, a.created_at,
         a.starts_at, a.expires_at, a.revoked_at,
         a.ai_allowance,
         CASE
           WHEN a.revoked_at IS NOT NULL THEN 'revoked'
           WHEN a.starts_at > now() THEN 'upcoming'
           WHEN a.expires_at IS NULL OR now() < a.expires_at + public.organizer_grace() THEN 'active'
           ELSE 'expired'
         END,
         coalesce((SELECT count(*)::integer FROM public.sessions s WHERE s.owner_id = u.id), 0),
         CASE WHEN u.id IS NULL THEN 0 ELSE public.ai_calls_in_window(u.id) END,
         u.last_sign_in_at
  FROM public.allowed_emails a
  LEFT JOIN auth.users u ON lower(u.email) = a.email
  ORDER BY a.created_at DESC, a.email;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_grants() FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_grants() TO authenticated;
