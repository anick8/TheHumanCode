// Keeps the Help Center honest:
//  1. every article in lib/helpNav.js has content/help/<slug>.mdx, and vice versa
//  2. every /help/<slug> href in the source points at an existing article
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { HELP_ARTICLES } from '../lib/helpNav.js'

const root = new URL('..', import.meta.url).pathname
const slugs = new Set(HELP_ARTICLES.map((a) => a.slug))
const errors = []

const files = new Set(readdirSync(join(root, 'content/help')).filter((f) => f.endsWith('.mdx')).map((f) => f.slice(0, -4)))
for (const s of slugs) if (!files.has(s)) errors.push(`manifest slug "${s}" has no content/help/${s}.mdx`)
for (const f of files) if (!slugs.has(f)) errors.push(`content/help/${f}.mdx is not in lib/helpNav.js`)

const SKIP = new Set(['node_modules', '.next', '.git', 'graphify-out', 'db-tests', 'docs'])
const EXT = new Set(['.js', '.jsx', '.mjs', '.mdx'])
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (EXT.has(extname(p)) && !p.endsWith('check-help-links.mjs')) scan(p)
  }
}
function scan(path) {
  const text = readFileSync(path, 'utf8')
  for (const m of text.matchAll(/(?<=["'`(])\/help\/([a-z0-9-]+)/g)) {
    if (!slugs.has(m[1])) errors.push(`${path.replace(root, '')}: unknown help slug "${m[1]}"`)
  }
}
walk(root)

if (errors.length) {
  console.error('Help check failed:\n - ' + errors.join('\n - '))
  process.exit(1)
}
console.log(`Help check OK (${slugs.size} articles).`)
