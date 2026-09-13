// A session's uploaded logo, or nothing when the session has none.
export default function SessionLogo({ theme, className = 'h-10' }) {
  if (!theme?.logoUrl) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element -- arbitrary user-uploaded storage URL
    <img src={theme.logoUrl} alt="Logo" className={`w-auto max-w-[240px] object-contain ${className}`} />
  )
}
