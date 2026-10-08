'use client'

/*
  THESIS: The projector is a TV studio floor: the room sees only a lit wheel, the join plate and the Pick; the host drives everything from one console bar. Refuses the old layout of a wheel beside admin cards.
  OWN-WORLD: Dark stage. The wheel is an object: dark-metal rim, marquee bulbs, pegs on wedge borders, a kicking flapper, a hub cap. Wedges are six tones of the session's primary colour with a fixed sheen. The Pick lands on a full-bleed primary band in the display face.
  STORY: The room watches a fair spin, hears each peg tick, and sees one name owned the whole screen. The host spins, then removes or keeps.
  FIRST VIEWPORT: Header as before. Wheel fills the stage height, left. Join plate (QR, URL, live count) right. Console pinned to the bottom edge, Spin at its left.
  FORM: Broadcast console, chosen from three dealt layouts (seed 0a88cee8).
  FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
*/

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, memo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { createClient } from '@/lib/supabase/client'
import { finalRotation, entryAtPointer, LABEL_HIDE_ABOVE } from '@/lib/wheel'
import { WHEEL_LABEL_MAX } from '@/lib/wheelEntries'
import { wheelPalette, toneIndex } from '@/lib/wheelPalette'
import { resolveTheme } from '@/lib/theme'
import { unlockAudio, tick as playTick, fanfare, getMuted, setMuted } from '@/lib/wheelSound'

const SPIN_MS = 5000
const SPIN_REDUCED_MS = 1500
const WIND_BACK_MS = 250
const WIND_BACK_DEG = 8
const POLL_MS = 3000 // same cadence as the rest of the presenter's polling
const BULBS = 24
const QR_HIDDEN_KEY = 'wheel-qr-hidden'
const WHEEL_R = 92
const easeOut = (t) => 1 - Math.pow(1 - t, 4)

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

function Confetti({ palette }) {
  const pieces = useMemo(() => {
    const colours = [...palette.tones.map((t) => t.fill), palette.bulb, '#ffffff']
    return Array.from({ length: 90 }, (_, i) => ({
      dx: (Math.random() - 0.5) * 1500,
      up: -(140 + Math.random() * 260),
      rot: (Math.random() - 0.5) * 1080,
      delay: Math.random() * 0.25,
      dur: 2.2 + Math.random() * 1.4,
      colour: colours[i % colours.length],
      w: 7 + Math.random() * 7,
    }))
  }, [palette])
  // Original behaviour kept: confetti also rains down the whole screen from the top.
  const rain = useMemo(() => {
    const colours = [...palette.tones.map((t) => t.fill), palette.bulb, '#ffffff']
    return Array.from({ length: 90 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      dur: 2.2 + Math.random() * 1.8,
      drift: (Math.random() - 0.5) * 240,
      rot: Math.random() * 720,
      colour: colours[i % colours.length],
      w: 6 + Math.random() * 6,
    }))
  }, [palette])
  return (
    <div aria-hidden data-testid="confetti" className="pointer-events-none">
      <div className="fixed inset-0 z-50 overflow-hidden">
        {rain.map((p, i) => (
          <span
            key={i}
            style={{
              position: 'absolute',
              top: 0,
              left: `${p.left}%`,
              width: p.w,
              height: p.w * 0.45,
              background: p.colour,
              '--dx': `${p.drift}px`,
              '--rot': `${p.rot}deg`,
              animation: `wheel-rain ${p.dur}s ${p.delay}s ease-in forwards`,
            }}
          />
        ))}
      </div>
      <div className="absolute left-1/2 top-1/2 z-10 h-0 w-0">
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            '--dx': `${p.dx}px`,
            animation: `wheel-burst-x ${p.dur}s ${p.delay}s linear forwards`,
          }}
        >
          <span
            style={{
              display: 'block',
              width: p.w,
              height: p.w * 0.45,
              background: p.colour,
              '--up': `${p.up}px`,
              '--rot': `${p.rot}deg`,
              animation: `wheel-burst-y ${p.dur}s ${p.delay}s linear forwards`,
            }}
          />
        </span>
      ))}
      </div>
    </div>
  )
}

const iconProps = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
const IconList = () => (
  <svg {...iconProps}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
)
const IconClock = () => (
  <svg {...iconProps}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
)
const IconClose = () => (
  <svg {...iconProps}><path d="M6 6l12 12M18 6L6 18" /></svg>
)
const IconQr = ({ off }) => (
  <svg {...iconProps}>
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM20 14v.01M14 20v.01M20 20v.01" />
    {off && <path d="M3 21L21 3" />}
  </svg>
)
const IconSound = ({ off }) => (
  <svg {...iconProps}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" />
    {off ? <path d="M17 9l5 6M22 9l-5 6" /> : <path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12" />}
  </svg>
)

// Stage + host console for a Wheel of Fortune session on the presenter screen.
// phase: 'idle' (wheel follows the Entries) -> 'spinning' (Entry list frozen,
// rotation animating) -> 'landed' (Pick shown, awaiting Remove/Keep) -> 'idle'.
export default function WheelPresenter({ sessionId, session, isOwner, voteUrl, onError }) {
  const supabase = useMemo(() => createClient(), [])
  const theme = session?.theme
  const palette = useMemo(() => wheelPalette(theme), [theme])
  const logoUrl = useMemo(() => resolveTheme(theme).logoUrl, [theme])

  const [allEntries, setAllEntries] = useState([])
  const [spins, setSpins] = useState([])
  const [phase, setPhase] = useState('idle')
  const [pick, setPick] = useState(null) // { spinId, entryId, label }
  const [rotation, setRotation] = useState(0)
  const [confettiKey, setConfettiKey] = useState(0)
  const [single, setSingle] = useState('')
  const [bulk, setBulk] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [frozenEntries, setFrozenEntries] = useState(null) // wheel's Entries while a Spin is unresolved
  const [drawer, setDrawer] = useState(null) // null | 'entries' | 'history'
  const [muted, setMutedState] = useState(false)
  const [showQr, setShowQr] = useState(true) // host can hide the join QR once the room has joined
  const [joinFlash, setJoinFlash] = useState(null) // { key, label }
  const [lastPickLabel, setLastPickLabel] = useState('')

  const phaseRef = useRef('idle')
  const rotationRef = useRef(0)
  const rafRef = useRef(null)
  const wheelRef = useRef(null)
  const rigRef = useRef(null)
  const flapRef = useRef(null)
  const seenRef = useRef(null) // ids of Entries already seen, to announce new joiners
  const flashTimer = useRef(null)
  const setPhaseBoth = (p) => {
    phaseRef.current = p
    setPhase(p)
  }

  useEffect(() => setMutedState(getMuted()), [])
  useEffect(() => {
    try {
      setShowQr(localStorage.getItem(QR_HIDDEN_KEY) !== '1')
    } catch {}
  }, [])

  // The wheel's rotation is written straight to the DOM every frame: re-rendering
  // hundreds of wedges at 60fps would stutter, and nothing else reads it mid-spin.
  const applyRotation = useCallback((r) => {
    const el = wheelRef.current
    if (!el) return
    el.style.transform = `rotate(${r}deg)`
    el.setAttribute('data-rotation', String(r))
  }, [])
  useLayoutEffect(() => applyRotation(rotation), [rotation, applyRotation])

  const fetchAll = useCallback(async () => {
    const [{ data: entryRows }, { data: spinRows }] = await Promise.all([
      supabase.from('wheel_entries').select('id, label, kind, removed_at, created_at').eq('session_id', sessionId).order('created_at').order('id'),
      supabase.from('wheel_spins').select('id, entry_id, label, removed, created_at, resolved_at').eq('session_id', sessionId).order('created_at', { ascending: false }),
    ])
    return { entryRows: entryRows || [], spinRows: spinRows || [] }
  }, [supabase, sessionId])

  // Announce Participants who joined since the last look (not the first load).
  const noteJoiners = useCallback((entryRows) => {
    const seen = seenRef.current
    seenRef.current = new Set(entryRows.map((e) => e.id))
    if (!seen) return
    const fresh = entryRows.filter((e) => e.kind === 'joined' && !seen.has(e.id))
    if (!fresh.length) return
    const label = fresh.length === 1 ? fresh[0].label : `${fresh[fresh.length - 1].label} and ${fresh.length - 1} more`
    setJoinFlash({ key: Date.now(), label })
    clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setJoinFlash(null), 4500)
  }, [])
  useEffect(() => () => clearTimeout(flashTimer.current), [])

  // Poll for joiners / edits, but never redraw while a Spin is in flight or
  // its Pick is still awaiting Remove/Keep: the wheel only changes between Spins.
  const refresh = useCallback(
    async (force = false) => {
      const { entryRows, spinRows } = await fetchAll()
      if (force || phaseRef.current === 'idle') {
        noteJoiners(entryRows)
        setAllEntries(entryRows)
        setSpins(spinRows)
      }
      return { entryRows, spinRows }
    },
    [fetchAll, noteJoiners]
  )

  useEffect(() => {
    if (!isOwner) return
    // On load, restore a Pick that was never resolved (e.g. after a reload): only
    // the latest Spin can be pending, and only while its Entry is still active.
    let cancelled = false
    ;(async () => {
      const { entryRows, spinRows } = await refresh(true)
      if (cancelled || phaseRef.current !== 'idle') return
      const latest = spinRows[0]
      const active = entryRows.filter((e) => !e.removed_at)
      if (!latest || latest.resolved_at || !latest.entry_id) return
      const at = finalRotation({ entries: active, entryId: latest.entry_id, turns: 0 })
      if (at == null) return
      rotationRef.current = at
      setRotation(at)
      setFrozenEntries(active)
      setPick({ spinId: latest.id, entryId: latest.entry_id, label: latest.label })
      setPhaseBoth('landed')
    })()
    const t = setInterval(() => refresh(), POLL_MS)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [isOwner, refresh])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])
  useEffect(() => {
    if (pick?.label) setLastPickLabel(pick.label)
  }, [pick])

  const activeEntries = useMemo(() => allEntries.filter((e) => !e.removed_at), [allEntries])
  const wheelEntries = frozenEntries ?? activeEntries
  const waiting = activeEntries.length < 2
  // Spin is only possible from 'idle': a landed Pick must be resolved (Remove/Keep) first.
  const canSpin = isOwner && !waiting && phase === 'idle' && !busy

  const kickFlapper = useCallback(() => {
    const el = flapRef.current
    if (el) el.setAttribute('data-tick', el.getAttribute('data-tick') === 'a' ? 'b' : 'a')
  }, [])

  const spin = useCallback(async () => {
    if (phaseRef.current !== 'idle' || busy) return
    if (activeEntries.length < 2) return
    unlockAudio() // runs from the click/keypress, so the browser lets audio start
    setPhaseBoth('spinning') // freeze before awaiting so a second press is ignored
    setPick(null)
    setDrawer(null)
    // Snapshot the active Entries BEFORE the Spin so a joiner arriving afterwards
    // cannot change the wheel the Pick lands on.
    const snapshot = await fetchAll()
    const { data, error } = await supabase.rpc('spin_wheel', { p_session_id: sessionId })
    const row = Array.isArray(data) ? data[0] : data
    if (error || !row) {
      onError?.(error?.message || 'Could not spin the wheel.')
      setFrozenEntries(null)
      setPhaseBoth('idle')
      refresh(true)
      return
    }
    // The server picks among Entries active at spin time, so the Pick should be in
    // the snapshot. If not (the snapshot was stale: a joiner or restore slipped in
    // between the read and the RPC), add the Pick's Entry so the wheel still lands on it.
    let frozen = snapshot.entryRows.filter((e) => !e.removed_at)
    if (!frozen.some((e) => e.id === row.entry_id)) {
      frozen = [...frozen, { id: row.entry_id, label: row.label, kind: 'manual' }]
    }
    noteJoiners(snapshot.entryRows)
    setAllEntries(snapshot.entryRows)
    setSpins(snapshot.spinRows)
    setFrozenEntries(frozen)
    setPick({ spinId: row.spin_id, entryId: row.entry_id, label: row.label })

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const total = reduced ? SPIN_REDUCED_MS : SPIN_MS
    const windBack = reduced ? 0 : WIND_BACK_MS
    const back = reduced ? 0 : WIND_BACK_DEG

    const start = rotationRef.current % 360
    const target = finalRotation({
      entries: frozen,
      entryId: row.entry_id,
      currentRotation: start,
      turns: 5 + Math.floor(Math.random() * 3),
      jitter: (Math.random() - 0.5) * 0.8,
    })
    const from = start - back
    let lastId = entryAtPointer(frozen, start)?.id
    let prevR = start
    let prevT = performance.now()
    const t0 = prevT
    const frame = (now) => {
      const el = now - t0
      let r
      if (el < windBack) {
        const k = el / windBack
        r = start - back * Math.sin((k * Math.PI) / 2)
      } else {
        const t = Math.min(1, (el - windBack) / (total - windBack))
        r = from + (target - from) * easeOut(t)
      }
      rotationRef.current = r
      applyRotation(r)
      const dt = Math.max(1, now - prevT)
      rigRef.current?.style.setProperty('--wheel-v', String(Math.min(1, (Math.abs(r - prevR) / dt) * 1000 / 1200)))
      prevR = r
      prevT = now
      const at = entryAtPointer(frozen, r)?.id
      if (at !== lastId) {
        lastId = at
        kickFlapper()
        playTick()
      }
      if (el < total) rafRef.current = requestAnimationFrame(frame)
      else {
        rotationRef.current = target
        applyRotation(target)
        rigRef.current?.style.setProperty('--wheel-v', '0')
        setRotation(target)
        if (!reduced) setConfettiKey((k) => k + 1)
        fanfare()
        setPhaseBoth('landed')
      }
    }
    rafRef.current = requestAnimationFrame(frame)
  }, [activeEntries.length, applyRotation, busy, fetchAll, kickFlapper, noteJoiners, onError, refresh, sessionId, supabase])

  const resolve = useCallback(
    async (remove) => {
      if (!pick) return
      setBusy(true)
      const { error } = await supabase.rpc('resolve_wheel_pick', { p_spin_id: pick.spinId, p_remove: remove })
      if (error) onError?.(error.message)
      setBusy(false)
      setPick(null)
      setFrozenEntries(null)
      setPhaseBoth('idle')
      refresh(true)
    },
    [pick, supabase, onError, refresh]
  )

  // Space spins, R / K resolve a landed Pick, Esc closes a drawer. All ignored
  // while typing in a field; spin() and the buttons' disabled state guard the rest.
  const actions = useRef({})
  actions.current = { spin, resolve, phase, busy }
  useEffect(() => {
    if (!isOwner) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setDrawer(null)
        return
      }
      const t = e.target
      if (t instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName) || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const a = actions.current
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault()
        if (!e.repeat) a.spin()
      } else if ((e.key === 'r' || e.key === 'R' || e.key === 'k' || e.key === 'K') && a.phase === 'landed' && !a.busy && !e.repeat) {
        a.resolve(e.key.toLowerCase() === 'r')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOwner])

  const rpc = async (name, args) => {
    const { error } = await supabase.rpc(name, args)
    if (error) onError?.(error.message)
    await refresh(true)
  }
  const addSingle = async (e) => {
    e.preventDefault()
    if (!single.trim()) return
    const v = single
    setSingle('')
    await rpc('add_wheel_entries', { p_session_id: sessionId, p_labels: [v] })
  }
  const addBulk = async () => {
    const labels = bulk.split(/\r?\n/)
    if (!labels.some((l) => l.trim())) return
    setBulk('')
    await rpc('add_wheel_entries', { p_session_id: sessionId, p_labels: labels })
  }

  const doReset = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('reset_wheel', { p_session_id: sessionId })
    if (error) onError?.(error.message)
    setBusy(false)
    setConfirmReset(false)
    await refresh(true)
  }

  const toggleQr = () => {
    const next = !showQr
    setShowQr(next)
    try {
      localStorage.setItem(QR_HIDDEN_KEY, next ? '0' : '1')
    } catch {}
  }

  const toggleMute = () => {
    const next = !muted
    setMutedState(next)
    setMuted(next)
  }

  const editsLocked = phase !== 'idle'
  const landed = phase === 'landed' && pick
  const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
  const btn = `rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${focus}`
  const consoleBtn = `inline-flex items-center gap-2 whitespace-nowrap rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors ${focus}`
  const bandBottom = isOwner ? '6.5rem' : '2.5rem'
  const joinedCount = activeEntries.length
  const nameSize = `clamp(1.75rem, calc(96cqi / ${Math.max(8, lastPickLabel.length)}), 4.5rem)`

  const drawerShell = (open) =>
    `absolute inset-y-0 right-0 z-30 flex w-[min(26rem,100%)] flex-col border-l border-border bg-card shadow-2xl transition-[transform,visibility] duration-300 ease-out ${open ? 'visible translate-x-0' : 'invisible translate-x-full'}`

  return (
    <div className="wheel-stage relative flex w-full flex-1 flex-col overflow-hidden lg:min-h-0" data-phase={phase}>
      {/* Stage */}
      <div className="relative grid flex-1 gap-6 px-6 pt-5 pb-3 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="relative mx-auto aspect-square w-full max-w-[34rem] min-h-0 lg:aspect-auto lg:max-w-none" style={{ containerType: 'size' }}>
          <div ref={rigRef} className="wheel-rig absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ width: 'min(100cqw, 100cqh)', aspectRatio: '1' }}>
            <svg viewBox="-112 -112 224 224" className="h-full w-full" role="img" aria-label="Wheel of Fortune">
              <defs>
                <radialGradient id="wheel-shade" cx="0" cy="0" r={WHEEL_R} gradientUnits="userSpaceOnUse">
                  <stop offset="0.55" stopColor="#000" stopOpacity="0" />
                  <stop offset="1" stopColor="#000" stopOpacity="0.38" />
                </radialGradient>
                <linearGradient id="wheel-glint" x1="-60" y1="-80" x2="60" y2="80" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#fff" stopOpacity="0.2" />
                  <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
                </linearGradient>
                <clipPath id="wheel-hub-clip"><circle r="12" /></clipPath>
              </defs>

              {/* rim */}
              <circle r="109" fill={palette.rim} stroke={palette.rimEdge} strokeWidth="1.2" />
              <circle r="93.5" fill="none" stroke={palette.rimEdge} strokeWidth="1" />
              {Array.from({ length: BULBS }, (_, i) => {
                const [x, y] = polar((360 / BULBS) * i, 101)
                return <circle key={i} className="wheel-bulb" style={{ '--i': i }} cx={x} cy={y} r="2.5" fill={palette.bulb} />
              })}

              {/* the turning wheel */}
              <g ref={wheelRef} data-testid="wheel" data-entry-count={wheelEntries.length}>
                <g className="wheel-wedges" data-waiting={waiting && phase === 'idle' ? 'true' : 'false'} data-has-pick={landed ? 'true' : 'false'}>
                  <Wedges entries={wheelEntries} palette={palette} pickedId={landed ? pick.entryId : null} />
                </g>
              </g>

              {/* light stays put while the wheel turns */}
              <circle r={WHEEL_R} fill="url(#wheel-shade)" pointerEvents="none" />
              <circle r={WHEEL_R} fill="url(#wheel-glint)" pointerEvents="none" />

              {/* hub */}
              <circle r="15" fill={palette.rim} stroke={palette.rimEdge} strokeWidth="1.2" />
              <circle r="12" fill={palette.primary} />
              {logoUrl && <image href={logoUrl} x="-12" y="-12" width="24" height="24" preserveAspectRatio="xMidYMid slice" clipPath="url(#wheel-hub-clip)" />}

              {/* flapper at 12 o'clock */}
              <g transform="translate(0 -104)">
                <g ref={flapRef} className="wheel-flapper">
                  <path d="M-7 -6 L7 -6 L7 4 L0 24 L-7 4 Z" fill="#f8fafc" stroke={palette.rim} strokeWidth="1.2" strokeLinejoin="round" />
                  <circle cx="0" cy="0" r="2.2" fill={palette.primary} />
                </g>
              </g>
            </svg>
            {waiting && phase === 'idle' && (
              <p className="absolute left-1/2 top-[64%] -translate-x-1/2 rounded-full bg-background/85 px-5 py-2 font-display text-sm font-bold uppercase tracking-wider text-foreground">
                Waiting for entries
              </p>
            )}
          </div>
        </div>

        {/* Join plate */}
        <aside className="flex flex-col items-center justify-start gap-4 pt-2 text-center lg:pt-4">
          {showQr && (
            <>
              <div className="rounded-2xl bg-white p-3.5 shadow-xl transition-all duration-500">
                <QRCodeSVG value={voteUrl} size={waiting ? 248 : landed ? 150 : 184} level="M" bgColor="#ffffff" fgColor="#000000" />
              </div>
              <div className="min-w-0 max-w-full">
                <p className="font-display text-xl font-bold text-foreground">Scan to join the wheel</p>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{voteUrl.replace(/^https?:\/\//, '')}</p>
              </div>
            </>
          )}
          {isOwner && (
            <div className="min-h-[6.5rem]">
              <p className="flex items-baseline justify-center gap-2">
                <span key={joinedCount} data-testid="entry-count" className="wheel-bump inline-block font-display text-6xl font-bold tabular-nums text-foreground">
                  {joinedCount}
                </span>
                <span className="text-sm text-muted-foreground">on the wheel</span>
              </p>
              <p aria-live="polite" className="mt-2 min-h-6 text-sm font-medium text-accent">
                {joinFlash && <span key={joinFlash.key} className="animate-fade-in inline-block">{joinFlash.label} joined</span>}
              </p>
            </div>
          )}
        </aside>

        {/* Drawers (stay mounted so their contents are always in the DOM) */}
        {isOwner && (
          <>
            <section aria-label="Entries" inert={drawer !== 'entries'} className={drawerShell(drawer === 'entries')}>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="font-display text-lg font-bold text-foreground">Entries <span className="text-muted-foreground">· {joinedCount}</span></h2>
                <button onClick={() => setDrawer(null)} aria-label="Close entries" className={`rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground ${focus}`}><IconClose /></button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col p-4">
                <form onSubmit={addSingle} className="flex gap-2">
                  <input
                    value={single}
                    onChange={(e) => setSingle(e.target.value)}
                    maxLength={WHEEL_LABEL_MAX}
                    placeholder="Add an entry"
                    disabled={editsLocked}
                    className={`min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground ${focus}`}
                  />
                  <button type="submit" disabled={editsLocked || !single.trim()} className={btn}>Add</button>
                </form>
                <textarea
                  value={bulk}
                  onChange={(e) => setBulk(e.target.value)}
                  rows={3}
                  placeholder="Paste a list, one per line"
                  disabled={editsLocked}
                  className={`mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground ${focus}`}
                />
                <button onClick={addBulk} disabled={editsLocked || !bulk.trim()} className={`${btn} mt-2 self-start`}>Add all</button>
                {editsLocked && <p className="mt-2 text-xs text-muted-foreground">Entries are frozen until this Spin is resolved.</p>}

                <ul data-testid="entries-list" className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
                  {allEntries.map((e) => (
                    <li key={e.id} data-removed={e.removed_at ? 'true' : 'false'} className={`flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-1.5 text-sm ${e.removed_at ? 'opacity-50' : ''}`}>
                      <span className={`min-w-0 truncate ${e.removed_at ? 'line-through' : 'text-foreground'}`}>
                        {e.label}
                        {e.kind === 'joined' && <span className="ml-2 text-xs text-muted-foreground">joined</span>}
                      </span>
                      {e.removed_at ? (
                        <button disabled={editsLocked} onClick={() => rpc('restore_wheel_entry', { p_entry_id: e.id })} className={`text-xs font-medium text-accent hover:underline disabled:opacity-40 ${focus}`}>Restore</button>
                      ) : (
                        <button disabled={editsLocked} onClick={() => rpc('remove_wheel_entry', { p_entry_id: e.id })} className={`text-xs font-medium text-destructive hover:underline disabled:opacity-40 ${focus}`}>Remove</button>
                      )}
                    </li>
                  ))}
                  {allEntries.length === 0 && <li className="text-sm text-muted-foreground">Nobody yet. Scan the QR code or add names above.</li>}
                </ul>
              </div>
            </section>

            <section aria-label="History" inert={drawer !== 'history'} className={drawerShell(drawer === 'history')}>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="font-display text-lg font-bold text-foreground">Picked so far <span className="text-muted-foreground">· {spins.length}</span></h2>
                <button onClick={() => setDrawer(null)} aria-label="Close history" className={`rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground ${focus}`}><IconClose /></button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col p-4">
                <ol data-testid="picked-list" className="min-h-0 flex-1 space-y-1 overflow-y-auto">
                  {spins.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-1.5 text-sm text-foreground">
                      <span className="min-w-0 truncate">{s.label}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {s.removed ? ' · removed' : ''}
                      </span>
                    </li>
                  ))}
                  {spins.length === 0 && <li className="text-sm text-muted-foreground">No spins yet.</li>}
                </ol>
                <div className="mt-3 border-t border-border pt-3">
                  {confirmReset ? (
                    <div role="alertdialog" aria-label="Reset wheel" data-testid="reset-confirm" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                      <p className="text-foreground">Clear the Spin history and put every removed Entry back on the wheel? Joined Participants stay.</p>
                      <div className="mt-2 flex gap-2">
                        <button onClick={doReset} disabled={phase !== 'idle' || busy} className={`rounded-lg bg-destructive px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 ${focus}`}>Yes, reset</button>
                        <button onClick={() => setConfirmReset(false)} disabled={busy} className={btn}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmReset(true)} disabled={phase !== 'idle' || busy} className={`text-sm font-medium text-destructive hover:underline disabled:opacity-40 disabled:cursor-not-allowed ${focus}`}>
                      Reset wheel
                    </button>
                  )}
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      {/* Pick band: owns the screen when a Spin lands */}
      <div className="pointer-events-none absolute inset-x-0 z-20" style={{ bottom: bandBottom, height: 'clamp(5rem, 14vh, 8.5rem)' }}>
        <div
          data-open={landed ? 'true' : 'false'}
          aria-live="polite"
          className="wheel-band flex h-full items-center justify-center border-y border-t-primary border-b-border bg-card/90 px-8 text-center shadow-[0_-12px_32px_rgb(0_0_0/0.35)]"
          style={{ containerType: 'inline-size' }}
        >
          {landed ? (
            <p data-testid="pick-name" className="font-display font-bold leading-tight text-foreground break-words" style={{ fontSize: nameSize }}>
              {pick.label}
            </p>
          ) : (
            <p aria-hidden className="font-display font-bold leading-tight text-foreground break-words" style={{ fontSize: nameSize }}>
              {lastPickLabel}
            </p>
          )}
        </div>
        {confettiKey > 0 && <Confetti key={confettiKey} palette={palette} />}
      </div>

      {/* Host console: owner only, pinned to the bottom edge */}
      {isOwner && (
        <footer className="relative z-40 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-card px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={spin}
              disabled={!canSpin}
              className={`inline-flex items-center gap-3 rounded-full bg-gradient-to-r from-primary to-accent px-10 py-3 font-display text-xl font-bold text-white shadow-lg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 ${focus}`}
            >
              Spin
              <kbd className="hidden rounded border border-white/40 px-1.5 py-0.5 font-sans text-xs font-semibold sm:inline">Space</kbd>
            </button>
            {landed && (
              <div className="animate-slide-up flex items-center gap-2">
                <button onClick={() => resolve(true)} disabled={busy} className={`${consoleBtn} border-transparent bg-primary text-white hover:opacity-90 disabled:opacity-50`}>
                  Remove from wheel <kbd className="rounded border border-white/40 px-1.5 text-xs">R</kbd>
                </button>
                <button onClick={() => resolve(false)} disabled={busy} className={`${consoleBtn} border-border text-foreground hover:bg-muted disabled:opacity-50`}>
                  Keep on wheel <kbd className="rounded border border-border px-1.5 text-xs text-muted-foreground">K</kbd>
                </button>
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 text-sm text-muted-foreground" aria-live="polite">
            {phase === 'landed' ? (
              <p data-testid="spin-hint">Choose Remove or Keep to spin again</p>
            ) : phase === 'spinning' ? (
              <p>Spinning…</p>
            ) : waiting ? (
              <p data-testid="spin-hint">Add at least 2 entries</p>
            ) : (
              <p>Press Space to spin</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setDrawer(drawer === 'entries' ? null : 'entries')}
              aria-expanded={drawer === 'entries'}
              className={`${consoleBtn} ${drawer === 'entries' ? 'border-primary bg-muted text-foreground' : 'border-border text-foreground hover:bg-muted'}`}
            >
              <IconList /> Entries · {joinedCount}
            </button>
            <button
              onClick={() => setDrawer(drawer === 'history' ? null : 'history')}
              aria-expanded={drawer === 'history'}
              className={`${consoleBtn} ${drawer === 'history' ? 'border-primary bg-muted text-foreground' : 'border-border text-foreground hover:bg-muted'}`}
            >
              <IconClock /> History · {spins.length}
            </button>
            <button
              onClick={toggleQr}
              aria-pressed={!showQr}
              aria-label={showQr ? 'Hide QR code' : 'Show QR code'}
              title={showQr ? 'Hide QR code' : 'Show QR code'}
              className={`${consoleBtn} border-border text-foreground hover:bg-muted`}
            >
              <IconQr off={!showQr} />
            </button>
            <button
              onClick={toggleMute}
              aria-pressed={muted}
              aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
              title={muted ? 'Sound off' : 'Sound on'}
              className={`${consoleBtn} border-border text-foreground hover:bg-muted`}
            >
              <IconSound off={muted} />
            </button>
          </div>
        </footer>
      )}
    </div>
  )
}
