'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { drawingChannelName } from '@/lib/drawingChannel'
import { toNormalised, applySegment, undoStroke } from '@/lib/drawing'

const COLORS = ['#111827', '#dc2626', '#ea580c', '#16a34a', '#2563eb', '#9333ea']
const SIZES = { thin: 0.008, thick: 0.022 } // fraction of canvas width
const BG = '#ffffff'

/**
 * Square drawing canvas with live stroke sync over a Supabase broadcast channel (nothing persisted).
 *
 * Props:
 *  - sessionId (string, required): channel is `drawing:<sessionId>`
 *  - mode: 'draw' (the Drawer: tools + sends strokes, answers sync requests) or 'view' (read-only:
 *    projector, guessers; asks for a sync on mount)
 *  - onStrokesChange(strokes): optional, called whenever the local stroke list changes
 *  - className: optional wrapper class
 * Host "Clear canvas": call sendCanvasClear(sessionId) from '@/lib/drawingChannel'.
 * Remount with a new `key` (e.g. the round id) to start a fresh drawing.
 */
export default function DrawingCanvas({ sessionId, mode = 'view', onStrokesChange, className = '' }) {
  const canvasRef = useRef(null)
  const chRef = useRef(null)
  const strokesRef = useRef([])
  const drawing = useRef(null) // { id, pending: [] }
  const flushTimer = useRef(null)
  const [strokes, setStrokesState] = useState([])
  const [color, setColor] = useState(COLORS[0])
  const [size, setSize] = useState('thin')
  const [eraser, setEraser] = useState(false)
  const canDraw = mode === 'draw'

  const setStrokes = useCallback((next) => {
    strokesRef.current = next
    setStrokesState(next)
    onStrokesChange?.(next)
  }, [onStrokesChange])

  const send = useCallback((event, payload = {}) => {
    chRef.current?.send({ type: 'broadcast', event, payload })
  }, [])

  // Channel lifecycle.
  useEffect(() => {
    const supabase = createClient()
    const ch = supabase.channel(drawingChannelName(sessionId))
    chRef.current = ch
    ch.on('broadcast', { event: 'clear' }, () => setStrokes([]))
    if (canDraw) {
      ch.on('broadcast', { event: 'sync-request' }, () => send('sync', { strokes: strokesRef.current }))
    } else {
      ch.on('broadcast', { event: 'seg' }, ({ payload }) => setStrokes(applySegment(strokesRef.current, payload)))
      ch.on('broadcast', { event: 'undo' }, () => setStrokes(undoStroke(strokesRef.current)))
      ch.on('broadcast', { event: 'sync' }, ({ payload }) => setStrokes(payload.strokes ?? []))
    }
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED' && !canDraw) send('sync-request')
    })
    return () => {
      clearTimeout(flushTimer.current)
      supabase.removeChannel(ch)
      chRef.current = null
    }
  }, [sessionId, canDraw, send, setStrokes])

  // Repaint whenever strokes or the element size change.
  const paint = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const px = Math.round(c.clientWidth * (window.devicePixelRatio || 1))
    if (c.width !== px) { c.width = px; c.height = px }
    const g = c.getContext('2d')
    g.fillStyle = BG
    g.fillRect(0, 0, px, px)
    g.lineCap = g.lineJoin = 'round'
    for (const s of strokes) {
      g.strokeStyle = g.fillStyle = s.color
      g.lineWidth = s.size * px
      const [p0, ...rest] = s.points
      if (!p0) continue
      if (!rest.length) {
        g.beginPath(); g.arc(p0.x * px, p0.y * px, g.lineWidth / 2, 0, Math.PI * 2); g.fill()
        continue
      }
      g.beginPath(); g.moveTo(p0.x * px, p0.y * px)
      rest.forEach((p) => g.lineTo(p.x * px, p.y * px))
      g.stroke()
    }
  }, [strokes])

  useEffect(() => {
    paint()
    const c = canvasRef.current
    const ro = new ResizeObserver(paint)
    ro.observe(c)
    return () => ro.disconnect()
  }, [paint])

  function flush() {
    const d = drawing.current
    if (!d || !d.pending.length) return
    send('seg', { id: d.id, color: d.color, size: d.size, points: d.pending })
    d.pending = []
  }

  function addPoint(e) {
    const p = toNormalised(e.clientX, e.clientY, canvasRef.current.getBoundingClientRect())
    const d = drawing.current
    d.pending.push(p)
    setStrokes(applySegment(strokesRef.current, { id: d.id, color: d.color, size: d.size, points: [p] }))
  }

  function onDown(e) {
    if (!canDraw) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      color: eraser ? BG : color,
      size: SIZES[size] * (eraser ? 2.5 : 1),
      pending: [],
    }
    addPoint(e)
    flushTimer.current = setInterval(flush, 40)
  }
  function onMove(e) {
    if (drawing.current) addPoint(e)
  }
  function onUp() {
    if (!drawing.current) return
    clearInterval(flushTimer.current)
    flush()
    drawing.current = null
  }

  function undo() {
    setStrokes(undoStroke(strokesRef.current))
    send('undo')
  }
  function clear() {
    setStrokes([])
    send('clear')
  }

  const btn = (active) => `rounded-lg border px-3 py-1.5 text-sm ${active ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white'}`

  return (
    <div className={className}>
      <canvas
        ref={canvasRef}
        className="block aspect-square w-full rounded-xl border border-gray-300 bg-white"
        style={{ touchAction: 'none' }} // no page scroll while drawing on touch screens
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      {canDraw && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              onClick={() => { setColor(c); setEraser(false) }}
              className={`h-8 w-8 rounded-full border-2 ${!eraser && color === c ? 'border-gray-900' : 'border-transparent'}`}
              style={{ background: c }}
            />
          ))}
          <button type="button" className={btn(eraser)} onClick={() => setEraser(true)}>Eraser</button>
          <button type="button" className={btn(size === 'thin')} onClick={() => setSize('thin')}>Thin</button>
          <button type="button" className={btn(size === 'thick')} onClick={() => setSize('thick')}>Thick</button>
          <button type="button" className={btn(false)} onClick={undo} disabled={!strokes.length}>Undo</button>
          <button type="button" className={btn(false)} onClick={clear} disabled={!strokes.length}>Clear</button>
        </div>
      )}
    </div>
  )
}
