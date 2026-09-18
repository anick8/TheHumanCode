'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import SessionForm from '@/components/SessionForm'
import Link from 'next/link'

export default function NewSessionPage() {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleCreateSession = async (formData) => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      const { data, error } = await supabase
        .from('sessions')
        .insert([
          {
            title: formData.title,
            slug: formData.slug,
            results_mode: formData.results_mode,
            participation_mode: formData.participation_mode,
            identity_requires_name: formData.identity_requires_name,
            identity_requires_id: formData.identity_requires_id,
            is_scored: formData.is_scored,
            score_time_limit_seconds: formData.score_time_limit_seconds,
            is_active: formData.is_active,
            owner_id: user?.id,
          },
        ])
        .select()

      if (error) {
        throw error
      }

      if (data && data[0]) {
        router.push(`/dashboard/sessions/${data[0].id}`)
      } else {
        router.push('/dashboard')
      }
    } catch (error) {
      console.error('Error creating session:', error)
      alert(error.message || 'Failed to create session. Please check your Supabase connection and tables.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto py-4">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2 text-sm text-muted-foreground mb-2">
            <Link href="/dashboard" className="hover:text-foreground transition-colors">
              Dashboard
            </Link>
            <span>/</span>
            <span className="text-foreground font-medium">New Session</span>
          </div>
          
        </div>
      </div>

      <SessionForm onSubmit={handleCreateSession} loading={loading} />
    </div>
  )
}
