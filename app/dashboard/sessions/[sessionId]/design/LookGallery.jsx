'use client'

import { useRef } from 'react'
import SessionTheme from '@/components/SessionTheme'
import SessionLogo from '@/components/SessionLogo'
import { CheckIcon } from '@/app/dashboard/components/icons'

const COLOR_KEYS = ['primary', 'background', 'foreground', 'card']

export function matchPreset(draft, presets) {
  const hit = presets.find((p) => COLOR_KEYS.every((k) => p[k].toLowerCase() === (draft[k] || '').toLowerCase()))
  return hit ? hit.name : null
}

// A static stand-in for the attendee phone screen. Colors come only from the
// SessionTheme variables, so each card renders its look truthfully.
function MiniVote({ theme, title }) {
  return (
    <SessionTheme theme={theme} className="flex h-full flex-col gap-2 p-3">
      <div className="flex h-5 items-center gap-2">
        {theme.logoUrl ? (
          <SessionLogo theme={theme} className="h-4" />
        ) : (
          <span className="truncate font-display text-[10px] font-bold text-foreground">{title}</span>
        )}
      </div>
      <p className="font-display text-xs font-bold leading-tight text-foreground">Did you enjoy the session?</p>
      <div className="mt-auto space-y-1.5">
        <span className="block rounded-md border border-border bg-card px-2 py-1 text-[10px] text-foreground">Absolutely</span>
        <span className="block rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-white">Somewhat</span>
      </div>
    </SessionTheme>
  )
}

// Radiogroup of looks. `selected` is the matching preset name, or 'Custom'.
export default function LookGallery({ presets, draft, saved, selected, onPick, onCustom, disabled }) {
  const refs = useRef([])
  const options = [
    ...(saved ? [{ id: 'Current', label: 'Current', hint: 'Saved', theme: saved }] : []),
    ...presets.map((p) => ({
      id: p.name,
      label: p.name,
      hint: p.name === 'Charcoal Orange' ? 'Default' : null,
      theme: { ...draft, ...p },
      preset: p,
    })),
    { id: 'Custom', label: 'Custom', hint: null, theme: draft, custom: true },
  ]
  const selectedId = options.some((o) => o.id === selected) ? selected : 'Custom'

  const choose = (option) => {
    if (disabled) return
    if (option.custom) onCustom()
    else if (option.preset) onPick(option.preset)
    else onPick(option.theme)
  }

  const onKeyDown = (event, index) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (!step) return
    event.preventDefault()
    const next = (index + step + options.length) % options.length
    refs.current[next]?.focus()
    choose(options[next])
  }

  return (
    <div
      role="radiogroup"
      aria-label="Look"
      className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-7"
    >
      {options.map((option, index) => {
        const active = option.id === selectedId
        return (
          <button
            key={option.id}
            ref={(el) => (refs.current[index] = el)}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            disabled={disabled}
            onClick={() => choose(option)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className="group w-36 shrink-0 snap-start text-left sm:w-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
          >
            <span
              className={`block aspect-[4/5] overflow-hidden rounded-xl border transition-colors ${
                active ? 'border-foreground ring-2 ring-foreground' : 'border-border group-hover:border-muted-foreground'
              }`}
            >
              <MiniVote theme={option.theme} title="Session" />
            </span>
            <span className="mt-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <span className="truncate">{option.label}</span>
              {active && <CheckIcon className="h-3.5 w-3.5 shrink-0" />}
            </span>
            {option.hint && <span className="block text-xs text-muted-foreground">{option.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}
