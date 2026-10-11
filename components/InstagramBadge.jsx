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

// Instagram's own colours, one step darker than the logo's so every module
// keeps at least 4:1 against the white plate and phone cameras can still read
// the code. Brand-fixed on purpose: a branded session recolours its own
// palette, never another company's mark.
const IG_INK = 'linear-gradient(45deg, #d9531e 0%, #d6249f 38%, #8a3ab9 70%, #4f5bd5 100%)'

// The organizer's Instagram for the projector: one white plate holding a QR
// whose modules carry the Instagram gradient, and the handle beneath it. The
// plate is the object being watched, so it alone gets the offset shadow.
export default function InstagramBadge({ handle, className = '' }) {
  if (!handle) return null
  return (
    <figure className={`flex w-fit max-w-[14rem] flex-col items-center gap-2.5 [@media(max-height:800px)]:gap-2 ${className}`}>
      <div className="rounded-2xl bg-white p-3.5 shadow-[0_20px_28px_-12px_rgb(0_0_0/0.6)] [@media(max-height:800px)]:rounded-xl [@media(max-height:800px)]:p-2.5">
        {/* white svg ground + black modules, lightened over the gradient: the
            ground stays white, the modules take the gradient */}
        <div className="isolate leading-none" style={{ background: IG_INK }}>
          <QRCodeSVG
            value={instagramUrl(handle)}
            size={104}
            level="M"
            bgColor="#ffffff"
            fgColor="#000000"
            className="block h-[104px] w-[104px] mix-blend-lighten [@media(max-height:800px)]:h-[72px] [@media(max-height:800px)]:w-[72px]"
            role="img"
            aria-label={`QR code for Instagram @${handle}`}
          />
        </div>
      </div>
      <figcaption className="flex max-w-full items-center gap-1.5 text-foreground">
        <InstagramGlyph className="h-4 w-4 shrink-0" />
        <span className="truncate font-display text-sm font-bold">@{handle}</span>
      </figcaption>
    </figure>
  )
}
