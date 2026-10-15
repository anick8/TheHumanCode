// Keys come from the presenter handlers in app/present/[sessionId]/page.js
// and components/WheelPresenter.jsx.
const GROUPS = {
  presenter: [
    { keys: ['→', 'Page Down'], does: 'Next step (reveal, leaderboard, next question)' },
    { keys: ['F'], does: 'Toggle fullscreen' },
    { keys: ['I'], does: 'Show or hide your Instagram QR badge (only if you set a handle)' },
  ],
  wheel: [
    { keys: ['Space'], does: 'Spin the wheel' },
    { keys: ['R'], does: 'Remove the Pick from the wheel (after a spin)' },
    { keys: ['K'], does: 'Keep the Pick on the wheel (after a spin)' },
    { keys: ['Esc'], does: 'Close an open drawer' },
  ],
}

export default function ShortcutTable({ group = 'presenter' }) {
  const rows = GROUPS[group] || GROUPS.presenter
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            <th className="border-b border-border px-3 py-2 font-semibold text-foreground">Key</th>
            <th className="border-b border-border px-3 py-2 font-semibold text-foreground">What it does</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.does}>
              <td className="border-b border-border px-3 py-2">
                {row.keys.map((k, i) => (
                  <span key={k}>
                    {i > 0 && <span className="px-1 text-muted-foreground">or</span>}
                    <kbd className="rounded border border-border bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">{k}</kbd>
                  </span>
                ))}
              </td>
              <td className="border-b border-border px-3 py-2 text-muted-foreground">{row.does}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
