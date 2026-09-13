'use client'

import { themeToStyle, googleFontsUrl } from '@/lib/theme'

// Wraps a session-facing page (vote, present, results) in that session's
// branding by overriding the @theme CSS variables for everything inside it.
export default function SessionTheme({ theme, className = '', children }) {
  const fontsUrl = googleFontsUrl(theme)
  return (
    <div style={themeToStyle(theme)} className={`bg-background text-foreground font-sans ${className}`}>
      {/* React 19 hoists precedence stylesheets into <head> and dedupes them. */}
      {fontsUrl && <link rel="stylesheet" href={fontsUrl} precedence="default" />}
      {children}
    </div>
  )
}
