// Inline result of a settings action, announced to screen readers.
export default function StatusLine({ message }) {
  if (!message) return null
  const error = message.type === 'error'
  return (
    <p
      role={error ? 'alert' : 'status'}
      className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
        error
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      }`}
    >
      {message.text}
    </p>
  )
}
