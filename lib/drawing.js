// Pure helpers for the drawing canvas. Points are normalised 0..1 on a square canvas.
const clamp = (n) => Math.min(1, Math.max(0, n))

export function toNormalised(clientX, clientY, rect) {
  return { x: clamp((clientX - rect.left) / rect.width), y: clamp((clientY - rect.top) / rect.height) }
}

// Append a segment's points to the stroke with the same id (or start it). Returns a new list.
export function applySegment(strokes, { id, color, size, points }) {
  const i = strokes.findIndex((s) => s.id === id)
  if (i === -1) return [...strokes, { id, color, size, points: [...points] }]
  return strokes.map((s, j) => (j === i ? { ...s, points: [...s.points, ...points] } : s))
}

export const undoStroke = (strokes) => strokes.slice(0, -1)
