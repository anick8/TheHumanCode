'use client'

import { useState } from 'react'
import Link from 'next/link'
import { QRCodeSVG } from 'qrcode.react'
import { copyFor } from '@/lib/sessionCopy'
import { formatDateTime, getAppUrl } from '@/lib/utils'
import { presentLabel } from '@/lib/presenting'
import {
  ChartIcon,
  CheckIcon,
  CopyIcon,
  ExternalIcon,
  PaletteIcon,
  PencilIcon,
  PlayIcon,
  TrashIcon,
} from './icons'

const RESULTS_MODE_LABELS = { live: 'Live results', after_all: 'After all questions' }

const secondaryButton =
  'inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted'

// Everything needed to run one session without leaving the list: the join QR
// and link, the Active switch, and Present as the page's single orange action.
export default function SessionInspector({
  session,
  questionCount,
  presenting,
  error,
  onPresent,
  onToggleActive,
  onDelete,
}) {
  const [copied, setCopied] = useState(false)
  const typeCopy = copyFor(session.session_type)
  const isWheel = session.session_type === 'wheel'
  const isHunt = session.session_type === 'treasure_hunt'
  const isComments = session.session_type === 'comments'
  const joinUrl = `${getAppUrl()}/vote/${session.slug}`
  const countReady = isWheel || questionCount !== null
  const label = presentLabel(session, questionCount ?? 0)

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard unavailable (insecure context): the URL is selectable text.
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <h2 className="break-words font-display text-xl font-bold leading-tight text-foreground">
        {session.title}
      </h2>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {typeCopy.typeLabel}
        {!isComments && !isHunt && !isWheel && RESULTS_MODE_LABELS[session.results_mode]
          ? ` · ${RESULTS_MODE_LABELS[session.results_mode]}`
          : ''}
        {session.session_type === 'quiz' && !session.is_scored ? ' · Legacy, unscored' : ''}
      </p>

      <div className="mt-5 flex items-start gap-4">
        <div className="shrink-0 rounded-xl bg-white p-2.5">
          <QRCodeSVG value={joinUrl} size={132} level="M" bgColor="#ffffff" fgColor="#111418" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-muted-foreground">Join link</p>
          <p className="mt-1 break-all font-mono text-xs leading-relaxed text-foreground">
            {joinUrl.replace(/^https?:\/\//, '')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={copyLink} className={`${secondaryButton} h-9`}>
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <a
              href={`/vote/${session.slug}`}
              target="_blank"
              rel="noreferrer"
              className={`${secondaryButton} h-9`}
            >
              <ExternalIcon />
              Open
            </a>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-4 py-3">
        <div className="min-w-0">
          <p id={`active-${session.id}`} className="text-sm font-semibold text-foreground">
            {session.is_active ? 'Accepting attendees' : 'Closed to attendees'}
          </p>
          <p className="text-xs text-muted-foreground">
            {session.is_active
              ? 'Anyone with the link or QR can join.'
              : 'The link and QR will not let anyone in.'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={session.is_active}
          aria-labelledby={`active-${session.id}`}
          onClick={() => onToggleActive(session)}
          className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
            session.is_active ? 'border-foreground bg-foreground' : 'border-border bg-muted'
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 rounded-full transition-transform ${
              session.is_active ? 'translate-x-5 bg-background' : 'bg-muted-foreground'
            }`}
            style={{ height: '1.125rem', width: '1.125rem' }}
          />
        </button>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        {!isWheel && (
          <div>
            <dt className="text-xs text-muted-foreground">
              {isHunt ? 'Clues' : 'Questions'}
            </dt>
            <dd className="mt-0.5 font-medium tabular-nums text-foreground">
              {questionCount === null ? '–' : questionCount}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-muted-foreground">Created</dt>
          <dd className="mt-0.5 font-medium text-foreground">
            {formatDateTime(session.created_at)}
          </dd>
        </div>
      </dl>

      {!isHunt && (
        <button
          type="button"
          onClick={() => onPresent(session)}
          disabled={presenting || !countReady}
          className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-primary to-accent px-6 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <PlayIcon className="h-5 w-5" />
          {presenting ? 'Opening…' : label === 'Resume' ? 'Resume presenting' : 'Present'}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className={`mt-3 grid gap-2 ${isHunt ? 'grid-cols-2' : 'grid-cols-3'}`}>
        <Link href={`/dashboard/sessions/${session.id}`} className={secondaryButton}>
          <PencilIcon className="hidden h-4 w-4 sm:block" />
          Edit
        </Link>
        {!isHunt && (
          <Link href={`/dashboard/sessions/${session.id}/results`} className={secondaryButton}>
            <ChartIcon className="hidden h-4 w-4 sm:block" />
            Results
          </Link>
        )}
        <Link href={`/dashboard/sessions/${session.id}/design`} className={secondaryButton}>
          <PaletteIcon className="hidden h-4 w-4 sm:block" />
          Design
        </Link>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <button
          type="button"
          onClick={() => onDelete(session)}
          className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 -ml-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
        >
          <TrashIcon />
          Delete session
        </button>
      </div>
    </div>
  )
}
