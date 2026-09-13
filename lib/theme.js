// Per-session branding, stored in sessions.theme (jsonb). Every Tailwind
// utility resolves through the CSS variables declared in globals.css @theme,
// so a session is themed by overriding those variables on a wrapper element
// (see components/SessionTheme.jsx) - no per-component changes needed.

export const DEFAULT_THEME = {
  primary: '#d05011',
  background: '#101315',
  foreground: '#f5f5f5',
  card: '#14191f',
  headingFont: 'Orbitron',
  bodyFont: 'Montserrat',
  logoUrl: null,
}

// Montserrat and Orbitron are self-hosted by next/font in app/layout.js; the
// rest load from Google Fonts on demand when a session selects them.
export const FONT_OPTIONS = [
  'Montserrat',
  'Orbitron',
  'Inter',
  'Poppins',
  'Space Grotesk',
  'Lato',
  'Playfair Display',
  'Merriweather',
  'Roboto Slab',
  'Bebas Neue',
]

const SELF_HOSTED = {
  Montserrat: 'var(--font-montserrat)',
  Orbitron: 'var(--font-orbitron)',
}

export const COLOR_PRESETS = [
  { name: 'Charcoal Orange', primary: '#d05011', background: '#101315', foreground: '#f5f5f5', card: '#14191f' },
  { name: 'Midnight Blue', primary: '#3b82f6', background: '#0b1120', foreground: '#e5edff', card: '#111a2e' },
  { name: 'Forest', primary: '#16a34a', background: '#0c1410', foreground: '#ecfdf3', card: '#12201a' },
  { name: 'Royal Purple', primary: '#8b5cf6', background: '#120f1f', foreground: '#f3efff', card: '#1a1530' },
  { name: 'Clean Light', primary: '#2563eb', background: '#f8fafc', foreground: '#0f172a', card: '#ffffff' },
  { name: 'Warm Paper', primary: '#c2410c', background: '#faf6ef', foreground: '#292524', card: '#ffffff' },
]

export function resolveTheme(theme) {
  const merged = { ...DEFAULT_THEME }
  for (const [key, value] of Object.entries(theme || {})) {
    if (value !== undefined && value !== null && value !== '') merged[key] = value
  }
  return merged
}

function fontStack(name, fallback) {
  return `${SELF_HOSTED[name] || `'${name}'`}, ${fallback}`
}

const mix = (a, pct, b) => `color-mix(in srgb, ${a} ${pct}%, ${b})`

// Returns the CSS custom properties to put on a wrapper's style attribute.
// An empty/default theme returns {} so unbranded sessions render exactly as
// the global stylesheet defines them.
export function themeToStyle(theme) {
  if (!theme || Object.keys(theme).every((k) => k === 'logoUrl' || !theme[k])) return {}
  const t = resolveTheme(theme)
  return {
    '--color-primary': t.primary,
    '--color-ring': t.primary,
    '--color-accent': mix(t.primary, 85, t.foreground),
    '--color-secondary': mix(t.primary, 85, '#000'),
    '--color-background': t.background,
    '--color-foreground': t.foreground,
    '--color-card': t.card,
    '--color-card-foreground': t.foreground,
    '--color-popover': t.card,
    '--color-popover-foreground': t.foreground,
    '--color-muted': mix(t.foreground, 8, t.background),
    '--color-muted-foreground': mix(t.foreground, 68, t.background),
    '--color-border': mix(t.foreground, 16, t.background),
    '--color-input': mix(t.foreground, 8, t.background),
    '--font-sans': fontStack(t.bodyFont, 'ui-sans-serif, system-ui, sans-serif'),
    '--font-display': fontStack(t.headingFont, 'sans-serif'),
  }
}

// Google Fonts stylesheet URL for the non-self-hosted fonts a theme uses.
export function googleFontsUrl(theme) {
  const t = resolveTheme(theme)
  const families = [...new Set([t.headingFont, t.bodyFont])].filter(
    (f) => f && !SELF_HOSTED[f] && FONT_OPTIONS.includes(f)
  )
  if (families.length === 0) return null
  const query = families.map((f) => `family=${f.replace(/ /g, '+')}:wght@400;500;600;700`).join('&')
  return `https://fonts.googleapis.com/css2?${query}&display=swap`
}

function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return null
  const n = parseInt(m[1], 16)
  const channel = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

// WCAG contrast ratio between two hex colors (null if either is invalid).
export function contrastRatio(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  if (la === null || lb === null) return null
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

export const isHexColor = (value) => /^#[0-9a-f]{6}$/i.test(value || '')
