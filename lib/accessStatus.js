// Turns the organizer_access_status() row into what the UI needs. The database
// decides the state (an in-grace owner already reads as 'active'); this only
// words it. Pure so it can be checked with `node --test`.

import { DAY_MS } from './grantDates.js'

const BANNER_DAYS = 3

/** 'Nov 14, 2026'-style day for an ISO instant, viewer-local unless a timeZone is given. */
export function formatDay(iso, { locale, timeZone } = {}) {
  const opts = { year: 'numeric', month: 'short', day: 'numeric' }
  if (timeZone) opts.timeZone = timeZone
  return new Intl.DateTimeFormat(locale, opts).format(new Date(iso))
}

/**
 * The state string from an organizer_access_status() response, which PostgREST
 * returns as an array of rows or a single row. null when there is none.
 */
export function accessStateOf(data) {
  return (Array.isArray(data) ? data[0]?.state : data?.state) ?? null
}

/**
 * @param row  one row of organizer_access_status(), or null while unknown
 * @param opts { now, locale, timeZone } - viewer-local by default
 * @returns { state, readOnly, daysLeft, untilLabel, banner: {kind, message}|null }
 */
export function describeAccess(row, { now = new Date(), locale, timeZone } = {}) {
  const fmt = { locale, timeZone }
  const state = row?.state ?? 'none'
  const out = { state, readOnly: false, daysLeft: null, untilLabel: null, banner: null }

  if (state === 'admin') return out

  if (state === 'active') {
    if (!row.expires_at) return out
    const msLeft = new Date(row.expires_at).getTime() - now.getTime()
    out.daysLeft = Math.max(0, Math.ceil(msLeft / DAY_MS))
    out.untilLabel = `Access until ${formatDay(row.expires_at, fmt)}`
    if (out.daysLeft <= BANNER_DAYS) {
      const message =
        out.daysLeft === 0
          ? 'Your access period has ended. You have a few hours left to wrap up, then editing and presenting lock. Contact us to renew.'
          : `Your access ends in ${out.daysLeft} ${out.daysLeft === 1 ? 'day' : 'days'}. Contact us to renew.`
      out.banner = { kind: 'expiring', message }
    }
    return out
  }

  out.readOnly = true
  if (state === 'expired') {
    out.banner = {
      kind: 'expired',
      message: 'Access expired, contact us to renew. Your sessions and results are still here to view.',
    }
  } else if (state === 'revoked') {
    out.banner = {
      kind: 'revoked',
      message:
        'Your access has been withdrawn. Contact us if you think this is a mistake. Your sessions and results are still here to view.',
    }
  } else if (state === 'upcoming') {
    out.banner = {
      kind: 'upcoming',
      message: row.starts_at
        ? `Your access starts on ${formatDay(row.starts_at, fmt)}. Editing and presenting unlock then.`
        : 'Your access has not started yet. Editing and presenting unlock when it does.',
    }
  }
  return out
}
