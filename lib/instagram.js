// An organizer's Instagram handle, kept on their account (auth user_metadata)
// and shown as a QR badge on presenter screens.

const HANDLE = /^[A-Za-z0-9._]{1,30}$/

// Accepts "@name", "name", "instagram.com/name" or a full profile URL (with or
// without a trailing slash or query string). Returns the bare handle, or null
// when the input is blank or is not a valid handle.
export function parseInstagramHandle(input) {
  if (typeof input !== 'string') return null
  let value = input.trim()
  if (!value) return null

  const url = value.match(/^(?:https?:\/\/)?(?:www\.|m\.)?instagram\.com\/([^/?#\s]+)/i)
  if (url) value = url[1]
  value = value.replace(/^@/, '')

  return HANDLE.test(value) ? value : null
}

export function instagramUrl(handle) {
  return `https://instagram.com/${handle}`
}
