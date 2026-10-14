'use client'

import { memo, useRef } from 'react'
import SessionTheme from '@/components/SessionTheme'
import SessionLogo from '@/components/SessionLogo'
import WheelArt from '@/components/WheelArt'
import { DEFAULT_TYPE } from '@/lib/previewPlan'
import { wheelPalette } from '@/lib/wheelPalette'
import { CheckIcon } from '@/app/dashboard/components/icons'

const COLOR_KEYS = ['primary', 'background', 'foreground', 'card']

export function matchPreset(draft, presets) {
  const hit = presets.find((p) => COLOR_KEYS.every((k) => p[k].toLowerCase() === (draft[k] || '').toLowerCase()))
  return hit ? hit.name : null
}

// A static stand-in for the type's key screen. Colors come only from the
// SessionTheme variables (and the wheel palette for the wheel), so each card
// renders its look truthfully.
function MiniHeader({ theme, title }) {
  return (
    <div className="flex h-5 items-center gap-2">
      {theme.logoUrl ? (
        <SessionLogo theme={theme} className="h-4" />
      ) : (
        <span className="truncate font-display text-[10px] font-bold text-foreground">{title}</span>
      )}
    </div>
  )
}

const MiniWheel = memo(function MiniWheel({ theme, entries }) {
  return (
    <WheelArt
      entries={entries}
      palette={wheelPalette(theme)}
      logoUrl={theme.logoUrl || null}
      className="h-full w-full"
      label="Wheel preview"
    />
  )
})

function MiniScreen({ type, theme, title, content }) {
  const [first, second] = content.options
  const correct = content.options.find((o) => o.id === content.correctOptionId) || first
  const others = content.options.filter((o) => o !== correct)
  const [sampleA, sampleB] = content.people.comments
  const body = {
    poll: (
      <>
        <p className="font-display text-xs font-bold leading-tight text-foreground">{content.question.text}</p>
        <div className="mt-auto space-y-1.5">
          <span className="block truncate rounded-md border border-border bg-card px-2 py-1 text-[10px] text-foreground">{first.text}</span>
          <span className="block truncate rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-white">{second?.text ?? first.text}</span>
        </div>
      </>
    ),
    quiz: (
      <>
        <p className="font-display text-xs font-bold leading-tight text-foreground">{content.question.text}</p>
        <div className="mt-auto space-y-1.5">
          <span className="block truncate rounded-md border border-border bg-card px-2 py-1 text-[10px] text-foreground opacity-60">{(others[0] || first).text}</span>
          <span className="flex items-center justify-between gap-1 rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-white">
            <span className="truncate">{correct.text}</span>
            <CheckIcon className="h-3 w-3 shrink-0" />
          </span>
        </div>
      </>
    ),
    comments: (
      <>
        {content.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={content.imageUrl} alt="" className="h-16 w-full rounded-md border border-border object-cover" />
        ) : (
          <span className="block h-16 rounded-md border border-border bg-gradient-to-br from-primary/40 to-accent/40" />
        )}
        <div className="mt-auto space-y-1.5">
          <span className="block rounded-md border border-border bg-card px-2 py-1 text-[10px] text-foreground">{sampleA.body}</span>
          <span className="block rounded-md border border-border bg-card px-2 py-1 text-[10px] text-foreground">{sampleB.body}</span>
        </div>
      </>
    ),
    wheel: (
      <div className="mt-1 flex flex-1 items-center justify-center">
        <div className="aspect-square w-full max-w-[7.5rem]">
          <MiniWheel theme={theme} entries={content.people.wheelEntries.slice(0, 6)} />
        </div>
      </div>
    ),
    treasure_hunt: (
      <div className="mt-1 flex flex-1 flex-col justify-center rounded-md border border-border bg-card p-2 text-center">
        <p className="text-[8px] font-semibold uppercase tracking-widest text-accent">Clue #1</p>
        <p className="mt-1 line-clamp-3 font-display text-[11px] font-bold leading-tight text-foreground">{content.clue.message}</p>
        <span className="mt-2 block rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-white">
          {content.clue.choices[0]?.label || 'Reveal'}
        </span>
      </div>
    ),
  }[type]
  return (
    <SessionTheme theme={theme} className="flex h-full flex-col gap-2 p-3">
      <MiniHeader theme={theme} title={title} />
      {body}
    </SessionTheme>
  )
}

// Radiogroup of looks. `selected` is the matching preset name, or 'Custom'.
export default function LookGallery({ presets, draft, saved, selected, onPick, onCustom, disabled, type = DEFAULT_TYPE, content }) {
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
              <MiniScreen type={type} theme={option.theme} title="Session" content={content} />
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
