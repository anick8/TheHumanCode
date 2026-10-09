// Every docs/migrations/*.sql must also appear in database-setup.sql, since a
// fresh install runs only the latter. Comments and whitespace are ignored.
//   node db-tests/check-migrations.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const normalize = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()

const setup = normalize(readFileSync(join(root, 'database-setup.sql'), 'utf8'))
const migrationsDir = join(root, 'docs', 'migrations')
const missing = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .filter((file) => !setup.includes(normalize(readFileSync(join(migrationsDir, file), 'utf8'))))

if (missing.length) {
  console.error('Not found in database-setup.sql (append the migration there):')
  for (const file of missing) console.error(`  docs/migrations/${file}`)
  process.exit(1)
}
console.log('database-setup.sql contains every migration')
