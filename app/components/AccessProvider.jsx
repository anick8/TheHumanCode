'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { describeAccess } from '@/lib/accessStatus'
import { useAuth } from '@/app/components/AuthProvider'

// One organizer_access_status() fetch per signed-in user, shared by every
// dashboard page. Layouts do not re-render on client navigation, so pages read
// this context instead of depending on the layout. UX only: RLS is the gate.
const defaultValue = {
  access: describeAccess({ state: 'admin' }),
  row: null,
  loading: true,
  refresh: async () => {},
}

const AccessContext = createContext(defaultValue)

export function AccessProvider({ children }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const [row, setRow] = useState(null)
  const [loading, setLoading] = useState(Boolean(userId))

  const load = useCallback(async () => {
    if (!userId) {
      setRow(null)
      setLoading(false)
      return
    }
    try {
      const { data, error } = await createClient().rpc('organizer_access_status')
      if (error) throw error
      setRow((Array.isArray(data) ? data[0] : data) ?? null)
    } catch (error) {
      console.error('Access status error:', error)
      setRow(null)
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    setLoading(Boolean(userId))
    load()
  }, [userId, load])

  const value = useMemo(() => {
    // While the status is unknown, do not flash controls disabled: RLS still
    // refuses writes from a lapsed owner whatever the UI shows.
    const access = loading
      ? describeAccess({ state: 'admin' })
      : describeAccess(row)
    return { access, row, loading, refresh: load }
  }, [row, loading, load])

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
}

export const useAccess = () => useContext(AccessContext)
