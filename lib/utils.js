import { customAlphabet } from 'nanoid'

// Create a URL-safe slug generator (8 chars)
const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 8)

export function generateSlug() {
  return nanoid()
}

export function generateVoterToken() {
  return 'v_' + nanoid(16)
}

// Bearer secret for an identified participant. Stored in localStorage and sent
// with join/vote/restore RPCs; never exposed to other attendees.
export function generateJoinToken() {
  return 'p_' + nanoid(24)
}

// Public origin for voter-facing links (QR codes, share URLs).
//
// Resolution order, all inlined at build time so there is no hydration mismatch:
//   1. NEXT_PUBLIC_APP_URL          — explicit override (custom domain, local dev)
//   2. NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL — Vercel's stable production
//      domain. Deliberately NOT NEXT_PUBLIC_VERCEL_URL, which is unique per
//      deployment: a QR code printed from one deploy would die on the next.
//   3. localhost                    — plain local dev with no env file
export function getAppUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  }
  if (process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL}`
  }
  return 'http://localhost:3000'
}

export function formatDateTime(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(date))
}

export function formatDate(date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date))
}

export function formatTime(date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(date))
}