'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { QRCodeSVG } from 'qrcode.react'
import { createClient } from '@/lib/supabase/client'
import { getAppUrl } from '@/lib/utils'

// Printable sheet of every clue's QR code. Each clue reuses the `questions`
// row's clue_token - a random, permanent value set at creation (see
// database-setup.sql section 20) - so re-saving a clue's message here never
// changes the URL a printed code points to.
export default function CluesPage() {
  const params = useParams()
  const sessionId = params.sessionId
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(null)
  const [clues, setClues] = useState([])
  const [downloadingId, setDownloadingId] = useState(null)
  const [labels, setLabels] = useState({})
  const [labelStatus, setLabelStatus] = useState({})
  const qrRefs = useRef(new Map())
  const supabase = createClient()

  useEffect(() => {
    if (sessionId) load()
  }, [sessionId])

  const load = async () => {
    try {
      const [{ data: sessionData, error: sessionError }, { data: cluesData, error: cluesError }] = await Promise.all([
        supabase.from('sessions').select('*').eq('id', sessionId).single(),
        supabase.from('questions').select('*').eq('session_id', sessionId).order('order_index'),
      ])
      if (sessionError) throw sessionError
      if (cluesError) throw cluesError
      setSession(sessionData)
      setClues(cluesData || [])
      setLabels(Object.fromEntries((cluesData || []).map((c) => [c.id, c.clue_label || ''])))
    } catch (error) {
      console.error('Error loading clues:', error)
    } finally {
      setLoading(false)
    }
  }

  const setQrRef = (id) => (el) => {
    if (el) qrRefs.current.set(id, el)
    else qrRefs.current.delete(id)
  }

  // Live input value wins so an unsaved edit still lands in the PNG/print.
  const labelFor = (clue, index) =>
    (labels[clue.id] ?? clue.clue_label ?? '').trim() || `Clue #${index + 1}`

  const saveLabel = async (clue) => {
    const value = (labels[clue.id] || '').trim()
    if (value === (clue.clue_label || '')) return
    setLabelStatus((s) => ({ ...s, [clue.id]: 'saving' }))
    const { error } = await supabase
      .from('questions')
      .update({ clue_label: value || null })
      .eq('id', clue.id)
    if (error) {
      console.error('Error saving clue label:', error)
      setLabelStatus((s) => ({ ...s, [clue.id]: 'error' }))
      return
    }
    setClues((prev) => prev.map((c) => (c.id === clue.id ? { ...c, clue_label: value || null } : c)))
    setLabelStatus((s) => ({ ...s, [clue.id]: 'saved' }))
  }

  const downloadClue = (clue, index) => {
    const container = qrRefs.current.get(clue.id)
    const svg = container?.querySelector('svg')
    if (!svg) return

    setDownloadingId(clue.id)
    const size = 512
    const canvas = document.createElement('canvas')
    const captionHeight = 96
    canvas.width = size
    canvas.height = size + captionHeight
    const ctx = canvas.getContext('2d')

    const svgData = new XMLSerializer().serializeToString(svg)
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    const img = new Image()
    img.onload = () => {
      ctx.fillStyle = 'white'
      ctx.fillRect(0, 0, size, size + captionHeight)
      ctx.drawImage(img, 0, 0, size, size)

      const label = labelFor(clue, index)
      let fontSize = 36
      ctx.fillStyle = 'black'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      do {
        ctx.font = `bold ${fontSize}px sans-serif`
        fontSize -= 2
      } while (ctx.measureText(label).width > size - 48 && fontSize > 12)
      ctx.fillText(label, size / 2, size + captionHeight / 2, size - 48)

      const pngUrl = canvas.toDataURL('image/png')
      const link = document.createElement('a')
      const custom = (labels[clue.id] ?? clue.clue_label ?? '').trim()
      const labelSlug = custom
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
      link.download = `${session?.slug || 'treasure-hunt'}-clue-${index + 1}${labelSlug ? `-${labelSlug}` : ''}.png`
      link.href = pngUrl
      link.click()
      URL.revokeObjectURL(url)
      setDownloadingId(null)
    }
    img.onerror = () => setDownloadingId(null)
    img.src = url
  }

  if (loading) {
    return (
      <div className="py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-muted rounded w-48 mb-8"></div>
          <div className="h-64 bg-muted rounded-lg"></div>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="py-8 text-center">
        <h2 className="font-display text-2xl font-bold text-foreground">Session not found</h2>
        <Link href="/dashboard" className="mt-4 inline-block text-accent hover:underline">Back to dashboard</Link>
      </div>
    )
  }

  const appUrl = getAppUrl()

  return (
    <div className="py-8">
      <div className="mb-8 print:hidden">
        <Link href={`/dashboard/sessions/${sessionId}`} className="text-sm text-accent hover:underline">
          ← Back to {session.title}
        </Link>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold text-foreground">Clue QR codes</h1>
            <p className="mt-2 text-muted-foreground">
              Print this sheet, cut out each code, and hide it where its clue's number says. Codes only
              show a message while the session is Active.
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
          >
            <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print
          </button>
        </div>
      </div>

      {clues.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-border p-12 text-center print:hidden">
          <h3 className="text-lg font-medium text-foreground">No clues yet</h3>
          <p className="mt-2 text-muted-foreground">
            Add clues on the session page first - a QR code appears here for each one you save.
          </p>
          <Link
            href={`/dashboard/sessions/${sessionId}`}
            className="mt-6 inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
          >
            Add clues
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3 print:gap-4">
          {clues.map((clue, index) => (
            <div
              key={clue.id}
              className="flex flex-col items-center rounded-2xl border border-border bg-card p-6 text-center shadow-sm print:break-inside-avoid print:border-black print:shadow-none"
            >
              <p className="mb-2 text-sm text-muted-foreground print:hidden">Clue #{index + 1}</p>
              <input
                type="text"
                value={labels[clue.id] ?? ''}
                maxLength={60}
                placeholder={`Clue #${index + 1}`}
                onChange={(e) => {
                  setLabels((l) => ({ ...l, [clue.id]: e.target.value }))
                  setLabelStatus((s) => ({ ...s, [clue.id]: undefined }))
                }}
                onBlur={() => saveLabel(clue)}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                aria-label={`Label for clue ${index + 1}`}
                className="mb-1 w-full rounded-lg border border-border bg-background px-3 py-1.5 text-center text-sm font-semibold text-foreground print:hidden"
              />
              <p className="mb-3 h-4 text-xs text-muted-foreground print:hidden">
                {labelStatus[clue.id] === 'saving' && 'Saving…'}
                {labelStatus[clue.id] === 'saved' && 'Saved'}
                {labelStatus[clue.id] === 'error' && <span className="text-red-600">Couldn't save</span>}
              </p>
              <p className="mb-4 hidden text-lg font-semibold text-foreground print:block">{labelFor(clue, index)}</p>
              <div ref={setQrRef(clue.id)} className="inline-flex rounded-xl bg-white p-3">
                {clue.clue_token ? (
                  <QRCodeSVG
                    value={`${appUrl}/h/${clue.clue_token}`}
                    size={180}
                    level="H"
                    includeMargin={true}
                    bgColor="#ffffff"
                    fgColor="#000000"
                  />
                ) : (
                  <div className="flex h-[180px] w-[180px] items-center justify-center text-xs text-muted-foreground">
                    Save this clue to generate its code
                  </div>
                )}
              </div>
              {clue.clue_token && (
                <button
                  onClick={() => downloadClue(clue, index)}
                  disabled={downloadingId === clue.id}
                  className="mt-4 inline-flex items-center justify-center rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm hover:bg-muted transition-colors disabled:opacity-50 print:hidden"
                >
                  {downloadingId === clue.id ? 'Downloading…' : 'Download PNG'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
