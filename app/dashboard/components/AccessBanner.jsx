'use client'

import { useAccess } from '@/app/components/AccessProvider'

// Quiet, tonal notice: card ground, hairline border, no orange (the page's one
// signal is Present). Renders nothing when there is nothing to say.
export default function AccessBanner() {
  const { access } = useAccess()
  if (!access.banner) return null

  return (
    <div
      role="status"
      data-access-banner={access.banner.kind}
      className="mb-5 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
    >
      <span className="font-semibold text-foreground">
        {access.banner.kind === 'expiring' || access.banner.kind === 'upcoming'
          ? 'Heads up. '
          : 'Read-only. '}
      </span>
      {access.banner.message}
    </div>
  )
}
