// Starts the local Supabase stack (own project id and ports, see
// e2e/supabase/config.toml), loads database-setup.sql into it, and writes
// e2e/.env.e2e for the app and the tests. Idempotent: reuses a running stack and
// skips the schema load when database-setup.sql has not changed. Every CLI call
// is scoped with --workdir e2e, so another project's local stack is never touched.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const workdir = join(root, 'e2e')
const envFile = join(workdir, '.env.e2e')
const supabase = process.env.SUPABASE_BIN || 'supabase'

function sb(args, opts = {}) {
  return execFileSync(supabase, [...args, '--workdir', workdir], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    ...opts,
  })
}

function status() {
  try {
    const out = sb(['status', '-o', 'env'])
    return Object.fromEntries(
      out
        .split('\n')
        .map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/))
        .filter(Boolean)
        .map((m) => [m[1], m[2]])
    )
  } catch {
    return null
  }
}

let env = status()
if (!env?.API_URL) {
  console.log('[e2e] starting local Supabase stack...')
  sb(['start'], { stdio: 'inherit' })
  env = status()
}
if (!env?.DB_URL) throw new Error('[e2e] could not read local Supabase status')

const setupSql = readFileSync(join(root, 'database-setup.sql'), 'utf8')
const hash = createHash('sha256').update(setupSql).digest('hex')

async function loadSchema() {
  const client = new pg.Client({ connectionString: env.DB_URL })
  await client.connect()
  try {
    await client.query('create table if not exists public.e2e_schema_marker (hash text)')
    const { rows } = await client.query('select hash from public.e2e_schema_marker limit 1')
    if (rows[0]?.hash === hash) return false
    if (rows.length) return 'stale'
    await client.query(setupSql)
    await client.query('insert into public.e2e_schema_marker values ($1)', [hash])
    return true
  } finally {
    await client.end()
  }
}

let loaded = await loadSchema()
if (loaded === 'stale') {
  console.log('[e2e] database-setup.sql changed, resetting the e2e database...')
  sb(['db', 'reset'], { stdio: 'inherit' })
  loaded = await loadSchema()
}
console.log(`[e2e] schema ${loaded ? 'loaded' : 'up to date'}`)

writeFileSync(
  envFile,
  [
    `NEXT_PUBLIC_SUPABASE_URL=${env.API_URL}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${env.ANON_KEY}`,
    `E2E_DB_URL=${env.DB_URL}`,
    '',
  ].join('\n')
)
