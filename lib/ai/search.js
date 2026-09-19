// The only place in the codebase that names a web-search vendor. Swapping to
// Brave or Exa is a rewrite of `search()` alone, as long as it keeps returning
// { title, url, snippet }. See docs/ai-assistant.md for the procedure.
//
// A provider-native search tool (Anthropic ships one) would avoid this file
// entirely, but provider-native tools have no cross-provider equivalent, which
// would defeat the point of the seam in lib/ai/provider.js.

const TAVILY_ENDPOINT = 'https://api.tavily.com/search'

export const SEARCH_RESULT_LIMIT = 5

// Search results are attacker-influenceable (anyone can publish a page and try
// to rank for a query). Snippets are truncated and page bodies are never
// fetched, so the untrusted text entering the model stays small and bounded.
export const MAX_SNIPPET_CHARS = 500

export function isSearchConfigured() {
  return Boolean(process.env.TAVILY_API_KEY)
}

export async function search(query, { limit = SEARCH_RESULT_LIMIT } = {}) {
  if (!process.env.TAVILY_API_KEY) {
    throw new Error('TAVILY_API_KEY is not set, so web search is unavailable.')
  }

  const response = await fetch(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      max_results: Math.min(limit, SEARCH_RESULT_LIMIT),
      search_depth: 'basic',
    }),
  })

  if (!response.ok) {
    throw new Error(`Web search failed (${response.status}).`)
  }

  const data = await response.json()

  return (data.results ?? []).slice(0, limit).map((result) => ({
    title: String(result.title ?? '').slice(0, 200),
    url: String(result.url ?? ''),
    snippet: String(result.content ?? '').slice(0, MAX_SNIPPET_CHARS),
  }))
}
