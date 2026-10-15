import { COLOR_PRESETS } from '@/lib/theme'

export default function PresetSwatches() {
  return (
    <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {COLOR_PRESETS.map((p) => (
        <li key={p.name} className="rounded-xl border border-border p-3" style={{ background: p.background }}>
          <div className="flex gap-1.5">
            <span className="h-5 w-5 rounded-full border border-black/20" style={{ background: p.primary }} />
            <span className="h-5 w-5 rounded-full border border-black/20" style={{ background: p.card }} />
            <span className="h-5 w-5 rounded-full border border-black/20" style={{ background: p.foreground }} />
          </div>
          <p className="mt-2 text-sm font-semibold" style={{ color: p.foreground }}>{p.name}</p>
        </li>
      ))}
    </ul>
  )
}
