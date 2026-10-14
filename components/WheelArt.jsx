'use client'

import { useId, memo } from 'react'
import { LABEL_HIDE_ABOVE } from '@/lib/wheel'
import { toneIndex } from '@/lib/wheelPalette'

// The wheel's drawing: rim, bulbs, wedges and pegs, shade and glint, hub with
// the clipped logo, and the flapper. Presentational only (no data loading), so
// the live presenter and the Design preview render the identical wheel. The
// presenter hands in its refs to spin the wedges and kick the flapper.
export const BULBS = 24
export const WHEEL_R = 92

function polar(angleDeg, r) {
  const a = ((angleDeg - 90) * Math.PI) / 180
  return [r * Math.cos(a), r * Math.sin(a)]
}

const Wedges = memo(function Wedges({ entries, palette, pickedId }) {
  const n = entries.length
  if (n === 0) return <circle r={WHEEL_R} fill={palette.rim} />
  if (n === 1) return <circle r={WHEEL_R} fill={palette.tones[0].fill} />
  const seg = 360 / n
  const showLabels = n <= LABEL_HIDE_ABOVE
  const showPegs = n <= LABEL_HIDE_ABOVE
  const fontSize = Math.max(3.5, Math.min(9, 90 / n + 2))
  const maxChars = n <= 8 ? 18 : 14
  return (
    <>
      {entries.map((e, i) => {
        const [x1, y1] = polar(i * seg, WHEEL_R)
        const [x2, y2] = polar((i + 1) * seg, WHEEL_R)
        const large = seg > 180 ? 1 : 0
        const mid = (i + 0.5) * seg
        const tone = palette.tones[toneIndex(i, n)]
        return (
          <g key={e.id} data-entry-id={e.id} data-picked={e.id === pickedId ? 'true' : 'false'} className="wheel-wedge">
            <path
              d={`M0 0 L${x1.toFixed(3)} ${y1.toFixed(3)} A${WHEEL_R} ${WHEEL_R} 0 ${large} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`}
              fill={tone.fill}
              stroke={palette.rim}
              strokeWidth={n > 150 ? 0 : 0.35}
            />
            {showLabels && (
              <text
                className="wheel-labels"
                transform={`rotate(${mid - 90}) translate(${WHEEL_R - 7} 0)`}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={fontSize}
                fontWeight="700"
                fill={tone.ink}
              >
                {e.label.length > maxChars ? `${e.label.slice(0, maxChars - 1)}…` : e.label}
              </text>
            )}
          </g>
        )
      })}
      {showPegs &&
        entries.map((e, i) => {
          const [x, y] = polar(i * seg, WHEEL_R - 1.6)
          return <circle key={`peg-${e.id}`} cx={x} cy={y} r="1.5" fill={palette.bulb} />
        })}
    </>
  )
})

const WheelArt = memo(function WheelArt({
  entries,
  palette,
  logoUrl = null,
  pickedId = null,
  waiting = false,
  hasPick = false,
  wheelRef = null,
  flapRef = null,
  className = 'h-full w-full',
  label = 'Wheel of Fortune',
}) {
  // Several wheels can share a page (the gallery), so ids must be unique.
  const uid = useId().replace(/:/g, '')
  const shadeId = `wheel-shade-${uid}`
  const glintId = `wheel-glint-${uid}`
  const clipId = `wheel-hub-clip-${uid}`
  return (
            <svg viewBox="-112 -112 224 224" className={className} role="img" aria-label={label}>
              <defs>
                <radialGradient id={shadeId} cx="0" cy="0" r={WHEEL_R} gradientUnits="userSpaceOnUse">
                  <stop offset="0.55" stopColor="#000" stopOpacity="0" />
                  <stop offset="1" stopColor="#000" stopOpacity="0.38" />
                </radialGradient>
                <linearGradient id={glintId} x1="-60" y1="-80" x2="60" y2="80" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#fff" stopOpacity="0.2" />
                  <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
                </linearGradient>
                <clipPath id={clipId}><circle r="12" /></clipPath>
              </defs>

              {/* rim */}
              <circle r="109" fill={palette.rim} stroke={palette.rimEdge} strokeWidth="1.2" />
              <circle r="93.5" fill="none" stroke={palette.rimEdge} strokeWidth="1" />
              {Array.from({ length: BULBS }, (_, i) => {
                const [x, y] = polar((360 / BULBS) * i, 101)
                return <circle key={i} className="wheel-bulb" style={{ '--i': i }} cx={x} cy={y} r="2.5" fill={palette.bulb} />
              })}

              {/* the turning wheel */}
              <g ref={wheelRef} data-testid="wheel" data-entry-count={entries.length}>
                <g className="wheel-wedges" data-waiting={waiting ? 'true' : 'false'} data-has-pick={hasPick ? 'true' : 'false'}>
                  <Wedges entries={entries} palette={palette} pickedId={pickedId} />
                </g>
              </g>

              {/* light stays put while the wheel turns */}
              <circle r={WHEEL_R} fill={`url(#${shadeId})`} pointerEvents="none" />
              <circle r={WHEEL_R} fill={`url(#${glintId})`} pointerEvents="none" />

              {/* hub */}
              <circle r="15" fill={palette.rim} stroke={palette.rimEdge} strokeWidth="1.2" />
              <circle r="12" fill={palette.primary} />
              {logoUrl && <image href={logoUrl} x="-12" y="-12" width="24" height="24" preserveAspectRatio="xMidYMid slice" clipPath={`url(#${clipId})`} />}

              {/* flapper at 12 o'clock */}
              <g transform="translate(0 -104)">
                <g ref={flapRef} className="wheel-flapper">
                  <path d="M-7 -6 L7 -6 L7 4 L0 24 L-7 4 Z" fill="#f8fafc" stroke={palette.rim} strokeWidth="1.2" strokeLinejoin="round" />
                  <circle cx="0" cy="0" r="2.2" fill={palette.primary} />
                </g>
              </g>
            </svg>
  )
})

export default WheelArt
