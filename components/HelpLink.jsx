// A small "?" that opens the matching Help Center article in a new tab.
// Slugs are checked by `npm run check:help`.
export default function HelpLink({ slug, label = 'Help for this page', className = '' }) {
  return (
    <a
      href={`/help/${slug}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} (opens in a new tab)`}
      title={label}
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground ${className}`}
    >
      ?
    </a>
  )
}
