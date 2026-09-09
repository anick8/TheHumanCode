'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { formatDateTime } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

export default function DashboardHome() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    loadSessions()
  }, [])

  const loadSessions = async () => {
    try {
      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .order('created_at', { ascending: false })

      if (error) throw error

      setSessions(data || [])
    } catch (error) {
      console.error('Error loading sessions:', error)
      setSessions([])
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-48 mb-8"></div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-44 bg-gray-200 rounded-xl"></div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="py-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Your Sessions</h1>
          <p className="mt-1 text-sm text-gray-600">
            Create and manage your poll sessions. Each session has a unique QR code for attendees.
          </p>
        </div>
        <Link
          href="/dashboard/sessions/new"
          className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
        >
          <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Session
        </Link>
      </div>

      {/* Empty State */}
      {sessions.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-gray-300 p-12 text-center bg-white">
          <div className="mx-auto h-20 w-20 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
            <svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="mt-5 text-lg font-bold text-gray-900">No sessions yet</h3>
          <p className="mt-2 text-sm text-gray-600 max-w-md mx-auto">
            Create your first poll session to generate a QR code for your event attendees to scan and vote.
          </p>
          <div className="mt-6">
            <Link
              href="/dashboard/sessions/new"
              className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-opacity"
            >
              <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Your First Session
            </Link>
          </div>
        </div>
      )}

      {/* Sessions Grid */}
      {sessions.length > 0 && (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {sessions.map((session) => (
            <Link
              key={session.id}
              href={`/dashboard/sessions/${session.id}`}
              className="group block rounded-xl border border-gray-200 bg-white p-6 shadow-xs hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 group-hover:text-blue-600">
                    {session.title}
                  </h3>
                  <p className="mt-1 text-xs text-gray-500">
                    Slug: <code className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-700 font-mono">{session.slug}</code>
                  </p>
                </div>
                <div className="flex-shrink-0">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    session.is_active
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {session.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="text-gray-500">Results Mode</div>
                  <div className="font-medium text-gray-900 capitalize mt-0.5">{session.results_mode}</div>
                </div>
                <div>
                  <div className="text-gray-500">Created</div>
                  <div className="font-medium text-gray-900 mt-0.5">
                    {formatDateTime(session.created_at)}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-gray-100 pt-4">
                <div className="flex items-center text-xs text-gray-500">
                  <svg className="mr-1.5 h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Manage Poll
                </div>
                <div className="text-xs font-medium text-blue-600 group-hover:translate-x-0.5 transition-transform">
                  View details →
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Setup Instructions Helper */}
      <div className="mt-12 rounded-xl border border-blue-200 bg-blue-50/70 p-6">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <svg className="h-5 w-5 text-blue-600 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-semibold text-blue-900">Database Schema Ready</h3>
            <div className="mt-1 text-xs text-blue-800 leading-relaxed">
              <p>
                Make sure you have run the schema in <code className="bg-blue-100 px-1 py-0.5 rounded font-mono">database-setup.sql</code> inside your Supabase SQL Editor.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
