// Pure status -> screen/redirect mapping for the public clue page (/h/[token])
// when the hunt is a game. See docs/adr/0002 and the hunt-game spec.

export const POLL_MS = 4000

export const huntPlayerKey = (sessionId) => `hunt_player:${sessionId}`

const SCREENS = {
  pending: {
    title: 'Waiting for the organizer to let you in',
    body: 'Keep this page open. The clue appears as soon as you are approved and the hunt is running.',
    poll: true,
  },
  not_started: {
    title: "The hunt hasn't started yet",
    body: 'This clue will show up as soon as the organizer starts the hunt.',
    poll: true,
  },
  over: {
    title: 'The hunt is over',
    body: 'See how you finished on your hunt page.',
    poll: false,
    joinLink: true,
  },
  removed: {
    title: 'You were removed from this hunt',
    body: 'Ask the organizer if you think this is a mistake.',
    poll: false,
  },
}

export function gateScreen(status) {
  return SCREENS[status] || null
}

export function joinRequiredAction({ storedToken, sessionSlug, currentPath }) {
  if (storedToken) return { action: 'refetch', token: storedToken }
  if (!sessionSlug) return { action: 'missing' }
  return { action: 'redirect', href: `/hunt/${sessionSlug}?next=${encodeURIComponent(currentPath)}` }
}
