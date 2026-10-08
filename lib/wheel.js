// Pure geometry for the Wheel of Fortune.
//
// Entries are drawn as equal wedges, clockwise from 12 o'clock: entry i covers
// [i*seg, (i+1)*seg) degrees, seg = 360 / entries.length. The pointer sits at
// 12 o'clock. Rotating the wheel clockwise by R degrees moves the wheel point
// at angle a to angle a + R, so the point under the pointer is (-R) mod 360.

export const LABEL_HIDE_ABOVE = 40

const mod360 = (a) => ((a % 360) + 360) % 360

// Total rotation (degrees, clockwise, always >= currentRotation + turns*360)
// that leaves the wedge of `entryId` under the pointer. Matches by id, never
// by label, because several Entries may share a label. `jitter` in (-0.5, 0.5)
// shifts the stop point within the wedge (0 = centre); it is clamped so the
// pointer stays inside the wedge. Returns null if the Entry is not on the wheel.
export function finalRotation({ entries, entryId, currentRotation = 0, turns = 6, jitter = 0 }) {
  const i = entries.findIndex((e) => e.id === entryId)
  if (i < 0) return null
  const seg = 360 / entries.length
  const j = Math.max(-0.45, Math.min(0.45, jitter))
  const pointAngle = (i + 0.5 + j) * seg // wheel angle that must end up under the pointer
  const target = mod360(-pointAngle) // rotation mod 360 that achieves it
  const delta = mod360(target - currentRotation)
  return currentRotation + turns * 360 + delta
}

// Inverse: which Entry is under the pointer at this rotation.
export function entryAtPointer(entries, rotation) {
  if (!entries.length) return null
  const seg = 360 / entries.length
  const i = Math.floor(mod360(-rotation) / seg)
  return entries[Math.min(i, entries.length - 1)]
}
