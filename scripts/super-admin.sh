#!/usr/bin/env bash
# Manage Rentals Super admins (rows of the super_admins table) via psql.
#   scripts/super-admin.sh add <email>
#   scripts/super-admin.sh remove <email>
#   scripts/super-admin.sh list
# Reads SUPABASE_DB_URL from the environment, or else from .env.local.
set -euo pipefail
cd "$(dirname "$0")/.."

die() { echo "error: $*" >&2; exit 1; }
usage() { echo "usage: $0 add <email> | remove <email> | list" >&2; exit 2; }

[ $# -ge 1 ] || usage
cmd="$1"

# Validate input before touching the database.
normalize_email() {
  [ $# -eq 2 ] || usage
  email=$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  case "$email" in
    *@*) ;;
    *) die "'$2' is not a valid email (missing @)" ;;
  esac
  case "$email" in
    @* | *@ | *[[:space:]]*) die "'$2' is not a valid email" ;;
  esac
}
case "$cmd" in
  add | remove) normalize_email "$@" ;;
  list) ;;
  *) usage ;;
esac

if [ -z "${SUPABASE_DB_URL:-}" ] && [ -f .env.local ]; then
  line=$(grep -E '^[[:space:]]*(export[[:space:]]+)?SUPABASE_DB_URL=' .env.local | tail -n 1 || true)
  val="${line#*=}"
  val="${val%$'\r'}"
  val="${val#\"}"; val="${val%\"}"; val="${val#\'}"; val="${val%\'}"
  SUPABASE_DB_URL="$val"
fi
[ -n "${SUPABASE_DB_URL:-}" ] || die "SUPABASE_DB_URL is not set. Add it to .env.local (or export it).
Find it in the Supabase dashboard: Project Settings > Database > Connection string
(use the URI form and fill in your database password)."

command -v psql >/dev/null || die "psql is not installed"

# SQL is read on stdin so :'var' substitution applies (it does not under -c).
run() { psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }

case "$cmd" in
  add)
    inserted=$(run -At -v email="$email" <<'SQL'
INSERT INTO super_admins (email) VALUES (:'email')
ON CONFLICT (email) DO NOTHING
RETURNING email;
SQL
)
    if [ -n "$inserted" ]; then echo "added $email"; else echo "$email is already a Super admin (no change)"; fi
    ;;
  remove)
    # Atomic: the DELETE only fires while another Super admin would remain.
    deleted=$(run -At -v email="$email" <<'SQL'
DELETE FROM super_admins
WHERE email = :'email' AND (SELECT count(*) FROM super_admins) > 1
RETURNING email;
SQL
)
    if [ -n "$deleted" ]; then echo "removed $email"; exit 0; fi
    exists=$(run -At -v email="$email" <<'SQL'
SELECT 1 FROM super_admins WHERE email = :'email';
SQL
)
    if [ -n "$exists" ]; then
      die "refusing to remove $email: it is the last Super admin. Add another one first."
    fi
    echo "$email is not a Super admin (no change)"
    ;;
  list)
    run <<'SQL'
SELECT email, created_at FROM super_admins ORDER BY created_at, email;
SQL
    ;;
esac
