'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import QRCodeDisplay from '@/components/QRCodeDisplay'

export default function DemoPage() {
  const router = useRouter()
  const [sessions, setSessions] = useState([])
  const [newSessionTitle, setNewSessionTitle] = useState('')
  const [activeTab, setActiveTab] = useState('sessions')

  // Sample demo sessions
  const demoData = {
    sessions: [
      {
        id: 'demo-1',
        title: 'Team Meeting Poll',
        slug: 'team-meeting-2024',
        is_active: true,
        results_mode: 'live',
        created_at: '2024-01-15',
        questions: 3,
        votes: 145
      },
      {
        id: 'demo-2',
        title: 'Product Launch Feedback',
        slug: 'product-launch-feedback',
        is_active: true,
        results_mode: 'after_all',
        created_at: '2024-01-20',
        questions: 5,
        votes: 89
      },
      {
        id: 'demo-3',
        title: 'Conference Session Ratings',
        slug: 'conference-ratings',
        is_active: false,
        results_mode: 'live',
        created_at: '2024-01-10',
        questions: 4,
        votes: 210
      }
    ]
  }

  useEffect(() => {
    setSessions(demoData.sessions)
  }, [])

  const createDemoSession = () => {
    if (!newSessionTitle.trim()) return

    const newSession = {
      id: `demo-${Date.now()}`,
      title: newSessionTitle,
      slug: newSessionTitle.toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).substr(2, 4),
      is_active: true,
      results_mode: 'live',
      created_at: new Date().toISOString().split('T')[0],
      questions: 0,
      votes: 0
    }

    setSessions([newSession, ...sessions])
    setNewSessionTitle('')
  }

  const handleSignOut = () => {
    localStorage.removeItem('demo_mode')
    router.push('/')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted">
      {/* Header */}
      <header className="bg-card shadow-sm border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="h-8 w-8 rounded-full bg-gradient-to-r from-primary to-accent flex items-center justify-center">
                <span className="text-white text-sm font-bold">⚡</span>
              </div>
              <div>
                <h1 className="font-display text-xl font-bold text-foreground">MC Genie Demo</h1>
                <p className="text-sm text-muted-foreground">Demo Mode — Not connected to Supabase</p>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="px-4 py-2 text-sm font-medium text-foreground hover:text-foreground hover:bg-muted rounded-lg border border-border transition-colors"
            >
              Exit Demo
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tabs */}
        <div className="mb-8">
          <div className="border-b border-border">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('sessions')}
                className={`py-4 px-1 text-sm font-medium border-b-2 ${
                  activeTab === 'sessions'
                    ? 'border-ring text-accent'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                Sessions
              </button>
              <button
                onClick={() => setActiveTab('create')}
                className={`py-4 px-1 text-sm font-medium border-b-2 ${
                  activeTab === 'create'
                    ? 'border-ring text-accent'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                Create Session
              </button>
              <button
                onClick={() => setActiveTab('stats')}
                className={`py-4 px-1 text-sm font-medium border-b-2 ${
                  activeTab === 'stats'
                    ? 'border-ring text-accent'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
                }`}
              >
                Stats
              </button>
            </nav>
          </div>
        </div>

        {activeTab === 'sessions' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {sessions.map((session) => (
                <div key={session.id} className="bg-card rounded-lg shadow-sm border border-border p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="font-semibold text-foreground">{session.title}</h3>
                      <p className="text-sm text-muted-foreground">/{session.slug}</p>
                    </div>
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      session.is_active
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-muted text-foreground'
                    }`}>
                      {session.is_active ? 'Active' : 'Ended'}
                    </span>
                  </div>

                  <div className="mb-4">
                    <div className="text-sm text-muted-foreground mb-2">QR Code for voting:</div>
                    <div className="border border-border rounded p-2 bg-card">
                      <QRCodeDisplay
                        slug={session.slug}
                        size={150}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <div className="flex items-center space-x-4">
                      <span className="flex items-center">
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        {session.questions} Qs
                      </span>
                      <span className="flex items-center">
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                        </svg>
                        {session.votes} votes
                      </span>
                    </div>
                    <span className="text-xs px-2 py-1 rounded bg-muted text-foreground">
                      {session.results_mode === 'live' ? 'Live Results' : 'After All'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'create' && (
          <div className="bg-card rounded-lg shadow-sm border border-border p-6 max-w-2xl mx-auto">
            <h2 className="font-display text-lg font-semibold text-foreground mb-6">Create New Session</h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="title" className="block text-sm font-medium text-foreground mb-2">
                  Session Title
                </label>
                <input
                  type="text"
                  id="title"
                  value={newSessionTitle}
                  onChange={(e) => setNewSessionTitle(e.target.value)}
                  className="w-full px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                  placeholder="e.g., Weekly Team Meeting Poll"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Results Display Mode
                </label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="relative">
                    <input
                      type="radio"
                      id="live-mode"
                      name="mode"
                      defaultChecked
                      className="sr-only"
                    />
                    <label
                      htmlFor="live-mode"
                      className="block p-4 border border-border rounded-lg cursor-pointer hover:bg-muted peer-checked:border-ring peer-checked:bg-muted"
                    >
                      <div className="font-medium text-foreground">Live Results</div>
                      <p className="text-sm text-muted-foreground mt-1">Results update as votes come in</p>
                    </label>
                  </div>
                  <div className="relative">
                    <input
                      type="radio"
                      id="after-mode"
                      name="mode"
                      className="sr-only"
                    />
                    <label
                      htmlFor="after-mode"
                      className="block p-4 border border-border rounded-lg cursor-pointer hover:bg-muted peer-checked:border-ring peer-checked:bg-muted"
                    >
                      <div className="font-medium text-foreground">After All Questions</div>
                      <p className="text-sm text-muted-foreground mt-1">Show results only after all votes</p>
                    </label>
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <button
                  onClick={createDemoSession}
                  className="w-full inline-flex items-center justify-center px-6 py-3 border border-transparent rounded-lg shadow-sm text-base font-medium text-white bg-gradient-to-r from-primary to-accent hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring"
                >
                  Create Demo Session
                </button>
                <p className="text-sm text-muted-foreground mt-2 text-center">
                  This creates a local demo session. For real sessions, configure Supabase.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'stats' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-card rounded-lg shadow-sm border border-border p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="h-10 w-10 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Total Votes (Demo)</div>
                  <div className="text-2xl font-bold text-foreground">444</div>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow-sm border border-border p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="h-10 w-10 rounded-full bg-gradient-to-r from-primary to-accent flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Active Sessions</div>
                  <div className="text-2xl font-bold text-gray-9">2</div>
                </div>
              </div>
            </div>

            <div className="bg-card rounded-lg shadow-sm border border-border p-6">
              <div className="flex items-center space-x-3 mb-4">
                <div className="h-10 w-10 rounded-full bg-gradient-to-r from-primary to-secondary flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Avg. Engagement</div>
                  <div className="text-2xl font-bold text-gray-9">89%</div>
                </div>
              </div>
            </div>

            <div className="md:col-span-3 bg-card rounded-lg shadow-sm border border-border p-6">
              <h3 className="font-semibold text-foreground mb-4">Setup Guide</h3>
              <div className="space-y-3">
                <div className="flex items-center space-x-3">
                  <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center text-accent font-semibold">1</div>
                  <div>
                    <div className="font-medium text-foreground">Set Up Supabase</div>
                    <p className="text-sm text-muted-foreground">Create a project at supabase.com and run the database-setup.sql</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center text-accent font-semibold">2</div>
                  <div>
                    <div className="font-medium text-foreground">Configure Google OAuth</div>
                    <p className="text-sm text-muted-foreground">Enable Google provider in Supabase Dashboard → Authentication → Providers</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center text-accent font-semibold">3</div>
                  <div>
                    <div className="font-medium text-foreground">Update Environment Variables</div>
                    <p className="text-sm text-muted-foreground">Add your Supabase URL and anon key to .env.local</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-border bg-card py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              This is a demo mode. To use the full application with real-time voting and Google authentication, configure Supabase.
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              For setup instructions, see the{' '}
              <a
                href="https://github.com/supabase/supabase"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:text-accent"
              >
                Supabase documentation
              </a>
              .
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}