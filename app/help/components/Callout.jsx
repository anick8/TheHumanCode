const TONES = {
  tip: { label: 'Tip', cls: 'border-border bg-muted/60' },
  warning: { label: 'Heads up', cls: 'border-accent bg-accent/10' },
}

export default function Callout({ type = 'tip', children }) {
  const tone = TONES[type] || TONES.tip
  return (
    <aside className={`mt-6 rounded-xl border p-4 ${tone.cls}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-foreground">{tone.label}</p>
      <div className="[&>p]:mt-1">{children}</div>
    </aside>
  )
}
