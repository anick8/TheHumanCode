#!/usr/bin/env bash
# Runs every db-tests/scenarios/*.sql against a Postgres that already has
# database-setup.sql applied. Each scenario rolls itself back and fails by
# raising an exception.
#   DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres ./db-tests/run.sh [pattern]
set -u
cd "$(dirname "$0")"
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
fail=0
for f in scenarios/*${1:-}*.sql; do
  if out=$(psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$f" 2>&1); then
    echo "PASS  $f"
  else
    echo "FAIL  $f"; echo "$out" | sed 's/^/      /'; fail=1
  fi
done
exit $fail
