'use client'

import { useState, useRef } from 'react'
import { QRCodeSVG } from 'qrcode.react'

export default function QRCodeDisplay({ slug, size = 256 }) {
  const [downloading, setDownloading] = useState(false)
  const qrRef = useRef(null)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const voteUrl = `${appUrl}/vote/${slug}`

  const downloadQRCode = () => {
    if (!qrRef.current) return

    setDownloading(true)

    try {
      const svg = qrRef.current.querySelector('svg')
      if (!svg) {
        throw new Error('QR code SVG not found')
      }

      // Create canvas from SVG
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')

      // Create image from SVG
      const svgData = new XMLSerializer().serializeToString(svg)
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(svgBlob)

      const img = new Image()
      img.onload = () => {
        // Draw white background
        ctx.fillStyle = 'white'
        ctx.fillRect(0, 0, size, size)

        // Draw QR code
        ctx.drawImage(img, 0, 0, size, size)

        // Create download link
        const pngUrl = canvas.toDataURL('image/png')
        const link = document.createElement('a')
        link.download = `poll-${slug}-qrcode.png`
        link.href = pngUrl
        link.click()

        URL.revokeObjectURL(url)
        setDownloading(false)
      }
      img.onerror = () => {
        console.error('Failed to load SVG image')
        setDownloading(false)
      }
      img.src = url
    } catch (error) {
      console.error('Failed to download QR code:', error)
      setDownloading(false)
    }
  }

  const copyLink = () => {
    navigator.clipboard.writeText(voteUrl)
      .then(() => {
        alert('Link copied to clipboard!')
      })
      .catch(err => {
        console.error('Failed to copy:', err)
        alert('Failed to copy link. Please copy it manually.')
      })
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
      <div className="text-center">
        <h3 className="text-xl font-semibold text-gray-900 mb-4">QR Code for Voting</h3>
        <p className="text-gray-600 mb-6">
          Share this QR code at your event. Attendees scan it to vote.
        </p>

        {/* QR Code Container */}
        <div className="inline-flex items-center justify-center p-4 bg-white rounded-xl border border-gray-200 mb-6">
          <div ref={qrRef}>
            <QRCodeSVG
              value={voteUrl}
              size={size}
              level="H" // High error correction
              includeMargin={true}
              bgColor="#ffffff"
              fgColor="#000000"
            />
          </div>
        </div>

        {/* Voting URL */}
        <div className="mb-6">
          <p className="text-sm text-gray-500 mb-2">Voting URL</p>
          <div className="flex items-center">
            <code className="flex-1 px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-800 truncate">
              {voteUrl}
            </code>
            <button
              onClick={copyLink}
              className="ml-2 inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg className="h-4 w-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy
            </button>
          </div>
        </div>

        {/* Instructions */}
        <div className="mb-6 rounded-lg bg-blue-50 p-4 text-left">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">How to use this QR code</h4>
          <ul className="text-sm text-blue-800 space-y-1">
            <li className="flex items-start">
              <span className="mr-2">📱</span>
              <span>Display on screen at your event or print on handouts</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">🔗</span>
              <span>Attendees scan with phone camera to open voting page</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">📊</span>
              <span>Results appear in real-time on your dashboard</span>
            </li>
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={downloadQRCode}
            disabled={downloading}
            className="flex-1 inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {downloading ? (
              <>
                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-solid border-white border-r-transparent"></div>
                Downloading...
              </>
            ) : (
              <>
                <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Download QR Code (PNG)
              </>
            )}
          </button>
          <button
            onClick={() => window.print()}
            className="flex-1 inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-6 py-3 text-base font-semibold text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
          >
            <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print Friendly
          </button>
        </div>
      </div>
    </div>
  )
}