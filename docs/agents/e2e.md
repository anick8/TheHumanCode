# Verifying changes

## Database

- `npm run test:db` builds a throwaway Postgres database from `database-setup.sql` and runs every `db-tests/scenarios/*.sql` against it. Use it rather than `db-tests/run.sh`, which assumes the target already has the current schema (the local Supabase on port 54322 often does not).
- `npm run check:migrations` fails when a `docs/migrations/*.sql` file is missing from `database-setup.sql`. A feature's SQL goes in both: the migration file and the end of `database-setup.sql`.
- CI runs both (`.github/workflows/db-tests.yml`).

## UI against hosted Supabase

`.env.local` points the app at the hosted project, and the Supabase MCP is the same project (compare `get_project_url` with `NEXT_PUBLIC_SUPABASE_URL`). Apply a new migration there with `apply_migration` after the user approves.

1. Seed test sessions with `execute_sql`, owned by the signed-in organizer. Give them slugs starting `e2e-` so cleanup is one query. Find the organizer by matching the dashboard's session titles to `select owner_id, string_agg(title, ' | ') from sessions group by owner_id`.
2. The playwright session `host` stays signed in as that organizer; open an audience phone with `playwright-cli -s=phone open <url> --mobile`.
3. Drive the host side with `playwright-cli -s=host run-code "async page => {...}"`: one call can click, wait and return the page state, which costs less than separate click and snapshot calls. Read pages with `eval` or `find` instead of full snapshots.
4. Pass `--filename=.playwright-cli/<name>` to `snapshot`; a bare filename lands in the repo root.
5. Clean up with the dashboard Delete, then check `select count(*) from sessions where slug like 'e2e-%'` is 0.
