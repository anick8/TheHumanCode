<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Help Center content

User-facing documentation lives in `content/help/*.mdx` and is indexed by `lib/helpNav.js`. A change to user-facing behaviour (labels, shortcuts, limits, session settings, access rules) updates the matching article in the same PR. `npm run check:help` verifies every article has a manifest entry and every `/help/<slug>` link in the source resolves.
