// Shared by every Wheel of Fortune surface that adds manual Entries.
// Mirrors the add_wheel_entries RPC (trim, drop blanks, cap at 24) so the UI
// shows what the server will keep.
export const WHEEL_LABEL_MAX = 24

export function parseEntryLines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim().slice(0, WHEEL_LABEL_MAX))
    .filter(Boolean)
}
