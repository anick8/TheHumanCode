'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { createClient } from '@/lib/supabase/client'
import { finalRotation, LABEL_HIDE_ABOVE } from '@/lib/wheel'

const SPIN_MS = 5000
const POLL_MS = 3000 // same cadence as the rest of the presenter's polling
const easeOut = (t) => 1 - Math.pow(1 - t, 4)

const colourOf = (i) => `hsl(${Math.round((i * 137.508) % 360)} 70% 52%)`

function polar(angleDeg, r) {
  const a = ((angleDeg - 90) * Math.PI) / 180
  return [r * Math.cos(a), r * Math.sin(a)]
}

function Wedges({ entries }) {
  const n = entries.length
  if (n === 0) return <circle r="98" fill="#334155" />
  if (n === 1) return <circle r="98" fill={colourOf(0)} />
  const seg = 360 / n
  const showLabels = n <= LABEL_HIDE_ABOVE
  const fontSize = Math.max(3.5, Math.min(8, 90 / n + 2))
  return (
    <>
      {entries.map((e, i) => {
        const [x1, y1] = polar(i * seg, 98)
        const [x2, y2] = polar((i + 1) * seg, 98)
        const large = seg > 180 ? 1 : 0
        const mid = (i + 0.5) * seg
        return (
          <g key={e.id} data-entry-id={e.id}>
            <path
              d={`M0 0 L${x1.toFixed(3)} ${y1.toFixed(3)} A98 98 0 ${large} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`}
              fill={colourOf(i)}
              stroke="#0f172a"
              strokeWidth={n > 150 ? 0 : 0.4}
            />
            {showLabels && (
              <text
                transform={`rotate(${mid - 90}) translate(92 0)`}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={fontSize}
                fontWeight="700"
                fill="#fff"
                style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,.45)', strokeWidth: 0.6 }}
              >
                {e.label.length > 14 ? `${e.label.slice(0, 13)}…` : e.label}
              </text>
            )}
          </g>
        )
      })}
    </>
  )
}

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 90 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        dur: 2.2 + Math.random() * 1.8,
        drift: (Math.random() - 0.5) * 240,
        rot: Math.random() * 720,
        colour: colourOf(i * 7),
        w: 6 + Math.random() * 6,
      })),
    []
  )
  return (
    <div aria-hidden data-testid="confetti" className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      <style>{`@keyframes wheel-confetti{0%{transform:translate3d(0,-10vh,0) rotate(0);opacity:1}100%{transform:translate3d(var(--dx),110vh,0) rotate(var(--rot));opacity:.9}}`}</style>
      {pieces.map((p, i) => (
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
            animation: `wheel-confetti ${p.dur}s ${p.delay}s ease-in forwards`,
          }}
        />
      ))}
    </div>
  )
}

// Stage + side panel for a Wheel of Fortune session on the presenter screen.
// phase: 'idle' (wheel follows the Entries) -> 'spinning' (Entry list frozen,
// rotation animating) -> 'landed' (Pick shown, awaiting Remove/Keep) -> 'idle'.
export default function WheelPresenter({ sessionId, session, isOwner, voteUrl, onError }) {
  const supabase = useMemo(() => createClient(), [])
  const [allEntries, setAllEntries] = useState([])
  const [spins, setSpins] = useState([])
  const [phase, setPhase] = useState('idle')
  const [pick, setPick] = useState(null) // { spinId, entryId, label }
  const [rotation, setRotation] = useState(0)
  const [confettiKey, setConfettiKey] = useState(0)
  const [single, setSingle] = useState('')
  const [bulk, setBulk] = useState('')
  const [busy, setBusy] = useState(false)
  const [frozenEntries, setFrozenEntries] = useState(null) // wheel's Entries while a Spin is unresolved

  const phaseRef = useRef('idle')
  const rotationRef = useRef(0)
  const rafRef = useRef(null)
  const setPhaseBoth = (p) => {
    phaseRef.current = p
    setPhase(p)
  }

  const fetchAll = useCallback(async () => {
    const [{ data: entryRows }, { data: spinRows }] = await Promise.all([
      supabase.from('wheel_entries').select('id, label, kind, removed_at, created_at').eq('session_id', sessionId).order('created_at').order('id'),
      supabase.from('wheel_spins').select('id, entry_id, label, removed, created_at').eq('session_id', sessionId).order('created_at', { ascending: false }),
    ])
    return { entryRows: entryRows || [], spinRows: spinRows || [] }
  }, [supabase, sessionId])

  // Poll for joiners / edits, but never redraw while a Spin is in flight or
  // its Pick is still awaiting Remove/Keep: the wheel only changes between Spins.
  const refresh = useCallback(
    async (force = false) => {
      const { entryRows, spinRows } = await fetchAll()
      if (force || phaseRef.current === 'idle') {
        setAllEntries(entryRows)
        setSpins(spinRows)
      }
      return { entryRows, spinRows }
    },
    [fetchAll]
  )

  useEffect(() => {
    if (!isOwner) return
    refresh(true)
    const t = setInterval(() => refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [isOwner, refresh])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  const activeEntries = useMemo(() => allEntries.filter((e) => !e.removed_at), [allEntries])
  const wheelEntries = frozenEntries ?? activeEntries
  const canSpin = isOwner && activeEntries.length >= 2 && phase !== 'spinning' && !busy

  const spin = useCallback(async () => {
    if (phaseRef.current === 'spinning' || busy) return
    if (activeEntries.length < 2) return
    setPhaseBoth('spinning') // freeze before awaiting so a second press is ignored
    setPick(null)
    const { data, error } = await supabase.rpc('spin_wheel', { p_session_id: sessionId })
    const row = Array.isArray(data) ? data[0] : data
    if (error || !row) {
      onError?.(error?.message || 'Could not spin the wheel.')
      setFrozenEntries(null)
      setPhaseBoth('idle')
      refresh(true)
      return
    }
    // Entries at the moment of the Spin (server read after the Spin; joiners can
    // only add segments, the Pick is always among them).
    const { entryRows, spinRows } = await fetchAll()
    let frozen = entryRows.filter((e) => !e.removed_at)
    if (!frozen.some((e) => e.id === row.entry_id)) {
      const pickEntry = entryRows.find((e) => e.id === row.entry_id)
      frozen = [...frozen, pickEntry || { id: row.entry_id, label: row.label, kind: 'manual' }]
    }
    setAllEntries(entryRows)
    setSpins(spinRows)
    setFrozenEntries(frozen)
    setPick({ spinId: row.spin_id, entryId: row.entry_id, label: row.label })

    const start = rotationRef.current % 360
    const target = finalRotation({
      entries: frozen,
      entryId: row.entry_id,
      currentRotation: start,
      turns: 5 + Math.floor(Math.random() * 3),
      jitter: (Math.random() - 0.5) * 0.8,
    })
    const t0 = performance.now()
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / SPIN_MS)
      const r = start + (target - start) * easeOut(t)
      rotationRef.current = r
      setRotation(r)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
      else {
        rotationRef.current = target
        setRotation(target)
        setConfettiKey((k) => k + 1)
        setPhaseBoth('landed')
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [activeEntries.length, busy, fetchAll, onError, refresh, sessionId, supabase])

  // Space spins; ignored mid-spin (spin() guards) and while typing in a field.
  const spinRef = useRef(spin)
  spinRef.current = spin
  useEffect(() => {
    if (!isOwner) return
    const onKey = (e) => {
      if (e.code !== 'Space' && e.key !== ' ') return
      const t = e.target
      if (t instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(t.tagName) || t.isContentEditable)) return
      e.preventDefault()
      if (!e.repeat) spinRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOwner])

  const resolve = async (remove) => {
    if (!pick) return
    setBusy(true)
    const { error } = await supabase.rpc('resolve_wheel_pick', { p_spin_id: pick.spinId, p_remove: remove })
    if (error) onError?.(error.message)
    setBusy(false)
    setPick(null)
    setFrozenEntries(null)
    setPhaseBoth('idle')
    refresh(true)
  }

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

  const editsLocked = phase !== 'idle'
  const btn = 'rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className="grid w-full max-w-7xl gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" data-phase={phase}>
      {confettiKey > 0 && <Confetti key={confettiKey} />}

      <section className="flex flex-col items-center">
        <div className="relative w-full max-w-[min(34rem,52vh)]">
          {/* pointer at 12 o'clock */}
          <svg viewBox="-6 -6 12 12" className="absolute left-1/2 top-0 z-10 h-10 w-10 -translate-x-1/2 -translate-y-1/3 drop-shadow">
            <path d="M-5 -5 L5 -5 L0 5 Z" fill="#f8fafc" stroke="#0f172a" strokeWidth="0.8" />
          </svg>
          <svg viewBox="-100 -100 200 200" className="w-full rounded-full shadow-2xl" role="img" aria-label="Wheel of Fortune">
            <g
              data-testid="wheel"
              data-rotation={rotation}
              data-entry-count={wheelEntries.length}
              style={{ transform: `rotate(${rotation}deg)` }}
            >
              <Wedges entries={wheelEntries} />
            </g>
            <circle r="7" fill="#f8fafc" stroke="#0f172a" strokeWidth="1" />
          </svg>
        </div>

        <div className="mt-6 min-h-[7rem] text-center" aria-live="polite">
          {phase === 'landed' && pick ? (
            <>
              <p className="text-sm font-semibold uppercase tracking-widest text-accent">Picked</p>
              <p data-testid="pick-name" className="font-display text-5xl font-bold text-foreground md:text-7xl break-words">
                {pick.label}
              </p>
              <div className="mt-4 flex justify-center gap-3">
                <button onClick={() => resolve(true)} disabled={busy} className="rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 font-semibold text-white hover:opacity-90 disabled:opacity-50">
                  Remove from wheel
                </button>
                <button onClick={() => resolve(false)} disabled={busy} className="rounded-lg border border-border px-6 py-3 font-semibold text-foreground hover:bg-muted disabled:opacity-50">
                  Keep on wheel
                </button>
              </div>
            </>
          ) : phase === 'spinning' ? (
            <p className="font-display text-3xl font-bold text-muted-foreground">Spinning…</p>
          ) : null}
        </div>

        {isOwner && (
          <div className="mt-2 flex flex-col items-center gap-2">
            <button
              onClick={spin}
              disabled={!canSpin}
              className="rounded-full bg-gradient-to-r from-primary to-accent px-14 py-5 font-display text-2xl font-bold text-white shadow-lg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Spin
            </button>
            {activeEntries.length < 2 ? (
              <p data-testid="spin-hint" className="text-sm text-muted-foreground">Add at least 2 entries</p>
            ) : (
              <p className="text-sm text-muted-foreground">or press Space</p>
            )}
          </div>
        )}
      </section>

      <aside className="space-y-6">
        <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4">
          <div className="shrink-0 rounded-lg bg-white p-2">
            <QRCodeSVG value={voteUrl} size={88} level="M" bgColor="#ffffff" fgColor="#000000" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Scan to join the wheel</p>
            <p className="break-all font-mono text-xs text-muted-foreground">{voteUrl}</p>
          </div>
        </div>

        {isOwner && (
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-lg font-bold text-foreground">Entries</h2>
              <span data-testid="entry-count" className="text-sm text-muted-foreground">{activeEntries.length} on the wheel</span>
            </div>
            <form onSubmit={addSingle} className="mt-3 flex gap-2">
              <input
                value={single}
                onChange={(e) => setSingle(e.target.value)}
                maxLength={24}
                placeholder="Add an entry"
                disabled={editsLocked}
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
              <button type="submit" disabled={editsLocked || !single.trim()} className={btn}>Add</button>
            </form>
            <textarea
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              rows={3}
              placeholder="Paste a list, one per line"
              disabled={editsLocked}
              className="mt-2 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
            />
            <button onClick={addBulk} disabled={editsLocked || !bulk.trim()} className={`${btn} mt-2`}>Add all</button>
            {editsLocked && <p className="mt-2 text-xs text-muted-foreground">Entries are frozen until this Spin is resolved.</p>}

            <ul data-testid="entries-list" className="mt-3 max-h-64 space-y-1 overflow-y-auto">
              {allEntries.map((e) => (
                <li key={e.id} data-removed={e.removed_at ? 'true' : 'false'} className={`flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-1.5 text-sm ${e.removed_at ? 'opacity-50' : ''}`}>
                  <span className={`min-w-0 truncate ${e.removed_at ? 'line-through' : 'text-foreground'}`}>
                    {e.label}
                    {e.kind === 'joined' && <span className="ml-2 text-xs text-muted-foreground">joined</span>}
                  </span>
                  {e.removed_at ? (
                    <button disabled={editsLocked} onClick={() => rpc('restore_wheel_entry', { p_entry_id: e.id })} className="text-xs font-medium text-accent hover:underline disabled:opacity-40">Restore</button>
                  ) : (
                    <button disabled={editsLocked} onClick={() => rpc('remove_wheel_entry', { p_entry_id: e.id })} className="text-xs font-medium text-destructive hover:underline disabled:opacity-40">Remove</button>
                  )}
                </li>
              ))}
              {allEntries.length === 0 && <li className="text-sm text-muted-foreground">Nobody yet. Scan the QR code or add names above.</li>}
            </ul>
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="font-display text-lg font-bold text-foreground">Picked so far</h2>
          <ol data-testid="picked-list" className="mt-3 max-h-56 space-y-1 overflow-y-auto">
            {spins.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-1.5 text-sm text-foreground">
                <span className="min-w-0 truncate">{s.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {s.removed ? ' · removed' : ''}
                </span>
              </li>
            ))}
            {spins.length === 0 && <li className="text-sm text-muted-foreground">No spins yet.</li>}
          </ol>
        </div>
      </aside>
    </div>
  )
}
