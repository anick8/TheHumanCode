import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Reads e2e/.env.e2e, written by e2e/bootstrap.mjs.
export function loadE2eEnv() {
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.e2e')
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i), l.slice(i + 1)]
      })
  )
}
