// Wheel of Fortune sound, synthesised with Web Audio (no asset files).
// The AudioContext is created lazily from a user gesture (the Spin press).

const KEY = 'wheel-sound-muted'
const TICK_GAP_S = 0.035

let ctx = null
let lastTick = 0

export function getMuted() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setMuted(muted) {
  try {
    localStorage.setItem(KEY, muted ? '1' : '0')
  } catch {}
}

// Call from a click/keydown handler so the browser allows audio to start.
export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return
      ctx = new AC()
    }
    if (ctx.state === 'suspended') ctx.resume()
  } catch {}
}

export function tick() {
  if (!ctx || getMuted()) return
  const now = ctx.currentTime
  if (now - lastTick < TICK_GAP_S) return
  lastTick = now
  const osc = ctx.createOscillator()
  const filter = ctx.createBiquadFilter()
  const gain = ctx.createGain()
  osc.type = 'square'
  osc.frequency.setValueAtTime(1500, now)
  osc.frequency.exponentialRampToValueAtTime(700, now + 0.03)
  filter.type = 'lowpass'
  filter.frequency.value = 2600
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.09, now + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04)
  osc.connect(filter).connect(gain).connect(ctx.destination)
  osc.start(now)
  osc.stop(now + 0.05)
}

export function fanfare() {
  if (!ctx || getMuted()) return
  const start = ctx.currentTime + 0.02
  ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    const t = start + i * 0.11
    const last = i === 3
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = f
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (last ? 1.1 : 0.22))
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + (last ? 1.15 : 0.25))
  })
}
