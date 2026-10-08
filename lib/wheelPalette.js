// Wheel wedge colours derived from the session theme, so a branded session's
// wheel looks like that event. Six tones of the primary colour, cycled so no
// two neighbouring wedges (including across the wrap) share a tone.

import { resolveTheme } from './theme.js'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim())
  const n = parseInt(m ? m[1] : 'd05011', 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l * 100]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [(h * 60 + 360) % 360, s * 100, l * 100]
}

function hslToRgb(h, s, l) {
  const S = s / 100
  const L = l / 100
  const k = (n) => (n + h / 30) % 12
  const a = S * Math.min(L, 1 - L)
  const f = (n) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255))
}

const toHex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`

export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const INK_LIGHT = '#ffffff'
const INK_DARK = '#101315'
const inkFor = (fill) => (contrast(fill, INK_LIGHT) >= contrast(fill, INK_DARK) ? INK_LIGHT : INK_DARK)

// hue shift, lightness shift, saturation multiplier
const TONES = [
  [0, 0, 1],
  [16, -15, 0.9],
  [-14, 13, 0.95],
  [28, 4, 0.75],
  [-26, -7, 0.85],
  [8, 26, 0.55],
]
export const TONE_COUNT = TONES.length

export function wheelPalette(theme) {
  const t = resolveTheme(theme)
  const [h, s, l] = hexToHsl(t.primary)
  const base = clamp(l, 36, 58)
  const tones = TONES.map(([dh, dl, ds]) => {
    const hue = (h + dh + 360) % 360
    const sat = clamp(s * ds, 30, 95)
    let lit = clamp(base + dl, 12, 88)
    let fill = toHex(hslToRgb(hue, sat, lit))
    let ink = inkFor(fill)
    // Fills near the white/dark crossover can't reach 4.5:1 with either ink:
    // push their lightness away from it until one does.
    for (let guard = 0; contrast(fill, ink) < 4.5 && guard < 30; guard++) {
      lit += ink === INK_LIGHT ? -2 : 2
      fill = toHex(hslToRgb(hue, sat, lit))
      ink = inkFor(fill)
    }
    return { fill, ink }
  })
  return {
    tones,
    rim: toHex(hslToRgb(h, clamp(s * 0.25, 6, 22), 11)),
    rimEdge: toHex(hslToRgb(h, clamp(s * 0.3, 8, 26), 24)),
    bulb: toHex(hslToRgb((h + 36) % 360, 95, 72)),
    primary: t.primary,
  }
}

// Tone for wedge i of n. Adjacent wedges, and the last/first pair across the
// wrap, never share a tone.
export function toneIndex(i, n, k = TONE_COUNT) {
  const base = i % k
  if (n < 2 || i !== n - 1 || n % k !== 1) return base
  const first = 0
  const prev = (n - 2) % k
  for (let c = 0; c < k; c++) if (c !== first && c !== prev) return c
  return base
}
