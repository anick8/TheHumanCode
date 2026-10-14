'use client'

import { useEffect, useState } from 'react'
import SessionLogo from '@/components/SessionLogo'
import SessionTheme from '@/components/SessionTheme'
import { FONT_OPTIONS, contrastRatio, isHexColor } from '@/lib/theme'
import { CheckIcon } from '@/app/dashboard/components/icons'

const COLOR_FIELDS = [
  { key: 'primary', label: 'Primary' },
  { key: 'background', label: 'Background' },
  { key: 'foreground', label: 'Text' },
  { key: 'card', label: 'Cards' },
]

const inputClass =
  'h-10 w-full rounded-lg border border-border bg-input px-3 text-sm text-foreground focus:border-ring focus:outline-2 focus:outline-offset-2 focus:outline-ring'

function Section({ title, defaultOpen = false, children, sectionRef }) {
  return (
    <details open={defaultOpen} ref={sectionRef} className="group border-b border-border last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 font-display text-sm font-bold text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        {title}
        <svg
          className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="px-5 pb-5">{children}</div>
    </details>
  )
}

function ColorField({ label, value, onChange }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={isHexColor(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="h-10 w-12 shrink-0 cursor-pointer rounded border border-border bg-transparent"
        />
        <input
          type="text"
          value={text}
          aria-label={`${label} hex`}
          onChange={(e) => {
            setText(e.target.value)
            if (isHexColor(e.target.value)) onChange(e.target.value.toLowerCase())
          }}
          maxLength={7}
          className={`${inputClass} font-mono tabular-nums`}
        />
      </div>
    </div>
  )
}

function ContrastRow({ label, ratio, min }) {
  if (ratio === null) return null
  const ok = ratio >= min
  return (
    <li className={`flex items-center justify-between gap-3 text-xs ${ok ? 'text-muted-foreground' : 'text-destructive'}`}>
      <span>{label}</span>
      <span className="inline-flex items-center gap-1 font-semibold tabular-nums">
        {ratio.toFixed(1)}:1
        {ok ? <CheckIcon className="h-3.5 w-3.5" /> : <span aria-hidden="true">!</span>}
        <span className="sr-only">{ok ? 'passes' : `is below ${min}:1`}</span>
      </span>
    </li>
  )
}

export default function FineTunePanel({ draft, set, disabled, uploading, onUpload, logoTypes, colorsRef }) {
  const textRatio = contrastRatio(draft.foreground, draft.background)
  const buttonRatio = contrastRatio('#ffffff', draft.primary)
  return (
    <fieldset disabled={disabled} className="min-w-0 rounded-2xl border border-border bg-card">
      <legend className="sr-only">Fine-tune</legend>
      <div className="border-b border-border px-5 py-4">
        <h2 className="font-display text-base font-bold text-foreground">Fine-tune</h2>
      </div>

      <Section title="Logo">
        <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-border bg-muted p-4">
          {draft.logoUrl ? (
            <SessionLogo theme={draft} className="h-12" />
          ) : (
            <span className="text-sm text-muted-foreground">No logo</span>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <label className="flex h-10 flex-1 cursor-pointer items-center justify-center rounded-lg border border-border text-sm font-medium text-foreground transition-colors hover:bg-muted has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
            {uploading ? 'Uploading…' : draft.logoUrl ? 'Replace logo' : 'Upload logo'}
            <input type="file" accept={logoTypes.join(',')} onChange={onUpload} disabled={uploading} className="sr-only" />
          </label>
          {draft.logoUrl && (
            <button
              type="button"
              onClick={() => set({ logoUrl: null })}
              className="h-10 rounded-lg border border-border px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              Remove
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">PNG, JPG, SVG or WebP, up to 2 MB. Transparent works best.</p>
      </Section>

      <Section title="Colors" defaultOpen sectionRef={colorsRef}>
        <div className="space-y-4">
          {COLOR_FIELDS.map(({ key, label }) => (
            <ColorField key={key} label={label} value={draft[key]} onChange={(value) => set({ [key]: value })} />
          ))}
        </div>
        <ul aria-live="polite" className="mt-4 space-y-1.5 border-t border-border pt-3">
          <ContrastRow label="Text on background" ratio={textRatio} min={4.5} />
          <ContrastRow label="White on primary button" ratio={buttonRatio} min={3} />
        </ul>
      </Section>

      <Section title="Fonts">
        <div className="space-y-4">
          {[
            { key: 'headingFont', label: 'Headings' },
            { key: 'bodyFont', label: 'Body text' },
          ].map(({ key, label }) => (
            <label key={key} className="block">
              <span className="mb-1 block text-sm font-medium text-foreground">{label}</span>
              <select value={draft[key]} onChange={(e) => set({ [key]: e.target.value })} className={inputClass}>
                {FONT_OPTIONS.map((font) => (
                  <option key={font} value={font}>{font}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <SessionTheme theme={draft} className="mt-4 rounded-lg border border-border p-3">
          <p className="font-display text-base font-bold text-foreground">Did you enjoy the session?</p>
          <p className="mt-1 text-sm text-muted-foreground">Pick one answer and the room sees it live.</p>
        </SessionTheme>
      </Section>
    </fieldset>
  )
}
