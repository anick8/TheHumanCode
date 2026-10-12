// Turns the organizer_access_status() row into what the UI needs. The database
// decides the state (an in-grace owner already reads as 'active'); this only
// words it. Pure so it can be checked with `node --test`.

const DAY_MS = 24 * 60 * 60 * 1000
const BANNER_DAYS = 3

function formatDay(iso, { locale, timeZone }) {
  const opts = { year: 'numeric', month: 'short', day: 'numeric' }
  if (timeZone) opts.timeZone = timeZone
  return new Intl.DateTimeFormat(locale, opts).format(new Date(iso))
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
          ? 'Your access period has ended. Contact us to renew.'
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
