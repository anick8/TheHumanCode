'use client'

// People who signed up without a Grant. "Grant access" pre-fills the add form.
export default function LeadsList({ leads, onGrant }) {
  return (
    <section aria-labelledby="leads-heading" className="rounded-2xl border border-border bg-card">
      <div className="flex items-baseline justify-between px-4 pt-4 sm:px-5">
        <h2 id="leads-heading" className="font-display text-lg font-bold text-foreground">
          Leads
        </h2>
        <span className="text-xs text-muted-foreground">{leads.length} waiting</span>
      </div>
      {leads.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground sm:px-5">No sign-ups waiting for access.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {leads.map((lead) => (
            <li key={lead.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{lead.email}</p>
                <p className="text-xs text-muted-foreground">
                  Signed up{' '}
                  {new Date(lead.created_at).toLocaleDateString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onGrant(lead.email)}
                className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
              >
                Grant access
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
