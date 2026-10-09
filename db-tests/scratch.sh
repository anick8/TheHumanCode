#!/usr/bin/env bash
# Builds a throwaway database from database-setup.sql, runs db-tests/run.sh
# against it, then drops it. Use this instead of run.sh when your local
# Postgres may hold an older schema (run.sh assumes the current one).
#   PG_URL=postgresql://postgres:postgres@127.0.0.1:54322 ./db-tests/scratch.sh [pattern]
# PG_URL is the server (no database name). Keep the scratch DB with KEEP=1.
set -euo pipefail
cd "$(dirname "$0")/.."
PG_URL="${PG_URL:-postgresql://postgres:postgres@127.0.0.1:54322}"
NAME="scratch_$$"

psql "$PG_URL/postgres" -X -q -c "CREATE DATABASE $NAME"
cleanup() { [ "${KEEP:-}" = 1 ] || psql "$PG_URL/postgres" -X -q -c "DROP DATABASE IF EXISTS $NAME"; }
trap cleanup EXIT

# Supabase provides these; a plain Postgres (CI) does not.
psql "$PG_URL/postgres" -X -q <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
SQL

# Stand-ins for Supabase's auth and extensions schemas, and the default grants
# its roles get.
psql "$PG_URL/$NAME" -X -q -v ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE
  AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
GRANT USAGE ON SCHEMA auth, extensions, public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;
SQL

# The setup file also configures Storage, which the stand-in lacks; those
# statements fail harmlessly, so only errors outside Storage are fatal.
errors=$(psql "$PG_URL/$NAME" -X -q -f database-setup.sql 2>&1 >/dev/null | grep -i "error" | grep -iv "storage" || true)
if [ -n "$errors" ]; then echo "database-setup.sql failed:"; echo "$errors"; exit 1; fi

DB_URL="$PG_URL/$NAME" ./db-tests/run.sh "${1:-}"
