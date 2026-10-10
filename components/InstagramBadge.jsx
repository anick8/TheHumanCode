import { QRCodeSVG } from 'qrcode.react'
import { instagramUrl } from '@/lib/instagram'

export function InstagramGlyph({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

// The organizer's Instagram, as a scannable plate for the projector. Every
// colour resolves through the theme tokens, so a branded session recolours it.
export default function InstagramBadge({ handle, className = '' }) {
  if (!handle) return null
  return (
    <div className={`flex items-center gap-4 rounded-2xl border border-border bg-card p-3 pr-5 shadow-xl [@media(max-height:800px)]:gap-3 [@media(max-height:800px)]:p-2 [@media(max-height:800px)]:pr-4 ${className}`}>
      <div className="shrink-0 rounded-xl bg-white p-2">
        <QRCodeSVG
          value={instagramUrl(handle)}
          size={96}
          level="M"
          bgColor="#ffffff"
          fgColor="#000000"
          className="h-24 w-24 [@media(max-height:800px)]:h-16 [@media(max-height:800px)]:w-16"
          role="img"
          aria-label={`QR code for Instagram @${handle}`}
        />
      </div>
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-foreground">
          <InstagramGlyph className="h-5 w-5 shrink-0" />
          <span className="max-w-[11rem] truncate font-display text-base font-bold">@{handle}</span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">Scan to follow</p>
      </div>
    </div>
  )
}
