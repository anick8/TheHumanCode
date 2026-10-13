'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/app/components/AuthProvider'
import { useAccess } from '@/app/components/AccessProvider'
import { normalizeStats } from '@/lib/accountStats'
import AccountHeader from './components/AccountHeader'
import StatsLedger from './components/StatsLedger'
import ActivityChart from './components/ActivityChart'
import SessionMix from './components/SessionMix'
import TopSessions from './components/TopSessions'
import PlanCard from './components/PlanCard'
import ProfileCard from './components/ProfileCard'
import SecurityCard from './components/SecurityCard'
import DataCard from './components/DataCard'

function Skeleton() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse py-8" aria-busy="true" aria-label="Loading your account">
      <div className="flex items-center gap-5">
        <div className="h-16 w-16 rounded-2xl bg-muted" />
        <div className="space-y-2">
          <div className="h-8 w-56 rounded bg-muted" />
          <div className="h-4 w-72 rounded bg-muted" />
        </div>
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="h-96 rounded-2xl bg-muted lg:col-span-2" />
        <div className="h-96 rounded-2xl bg-muted" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="h-72 rounded-2xl bg-muted" />
        <div className="h-72 rounded-2xl bg-muted" />
      </div>
    </div>
  )
}

export default function AccountPage() {
  const supabase = useMemo(() => createClient(), [])
  const { user, loading: authLoading } = useAuth()
  const { access, row, loading: accessLoading } = useAccess()
  const [stats, setStats] = useState(null)
  const [statsError, setStatsError] = useState(false)

  const userId = user?.id
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase.rpc('account_stats').then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        console.error('Account stats error:', error)
        setStatsError(true)
      } else {
        setStats(normalizeStats(data))
      }
    })
    return () => {
      cancelled = true
    }
  }, [supabase, userId])

  if (authLoading || accessLoading || !user) return <Skeleton />

  return (
    <div className="mx-auto max-w-6xl py-8">
      <AccountHeader user={user} access={access} />

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <section
          className="rounded-2xl border border-border bg-card p-6 lg:col-span-2"
          aria-labelledby="stage-heading"
        >
          <h2 id="stage-heading" className="font-display text-lg font-bold text-foreground">
            Your stage
          </h2>

          {statsError ? (
            <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              Couldn&apos;t load your numbers. Refresh the page to try again.
            </p>
          ) : !stats ? (
            <div className="mt-4 animate-pulse space-y-6" aria-busy="true">
              <div className="h-20 rounded-lg bg-muted" />
              <div className="h-40 rounded-lg bg-muted" />
            </div>
          ) : (
            <>
              <div className="mt-4">
                <StatsLedger totals={stats.totals} />
              </div>

              {stats.totals.sessions === 0 ? (
                <p className="mt-6 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  You haven&apos;t created a session yet.{' '}
                  <Link href="/dashboard" className="font-semibold text-accent underline underline-offset-4">
                    Start one from the dashboard
                  </Link>
                  .
                </p>
              ) : (
                <>
                  <div className="mt-6 border-t border-border pt-6">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">Activity, last 12 weeks</h3>
                    <ActivityChart weekly={stats.weekly} />
                  </div>

                  <div className="mt-6 border-t border-border pt-6">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">What you run</h3>
                    <SessionMix byType={stats.totals.byType} />
                  </div>

                  <div className="mt-6 border-t border-border pt-6">
                    <h3 className="mb-1 text-sm font-semibold text-foreground">Busiest sessions</h3>
                    <TopSessions sessions={stats.top} />
                  </div>

                  <p className="mt-6 text-xs text-muted-foreground">
                    Counts what&apos;s stored now. Responses you&apos;ve cleared aren&apos;t included.
                  </p>
                </>
              )}
            </>
          )}
        </section>

        <aside className="rounded-2xl border border-border bg-card p-6">
          <PlanCard access={access} row={row} />
        </aside>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ProfileCard user={user} />
        <SecurityCard user={user} />
      </div>

      <div className="mt-6">
        <DataCard user={user} stats={stats} />
      </div>
    </div>
  )
}
