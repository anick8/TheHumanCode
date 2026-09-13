'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/components/AuthProvider'

export default function AuthForm({ defaultTab = 'signin', onSuccess }) {
  const [tab, setTab] = useState(defaultTab) // 'signin' | 'signup' | 'reset'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)

  const { signInWithEmail, signUpWithEmail, signInWithGoogle, resetPassword } = useAuth()
  const router = useRouter()

  const handleTabSwitch = (newTab) => {
    setTab(newTab)
    setError(null)
    setSuccessMessage(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSuccessMessage(null)

    if (!email.trim()) {
      setError('Please enter your email address.')
      return
    }

    if (tab === 'reset') {
      setLoading(true)
      try {
        const { error: resetErr } = await resetPassword(email)
        if (resetErr) throw resetErr
        setSuccessMessage('Password reset instructions sent to your email.')
      } catch (err) {
        setError(err.message || 'Failed to send password reset email.')
      } finally {
        setLoading(false)
      }
      return
    }

    if (!password) {
      setError('Please enter your password.')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.')
      return
    }

    if (tab === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)

    try {
      if (tab === 'signin') {
        const { data, error: signInErr } = await signInWithEmail(email, password)
        if (signInErr) {
          if (signInErr.message.includes('Invalid login credentials')) {
            throw new Error('Invalid email or password. Please check your credentials.')
          }
          if (signInErr.message.includes('Email not confirmed')) {
            throw new Error('Please verify your email address before signing in.')
          }
          throw signInErr
        }

        if (onSuccess) {
          onSuccess(data)
        } else {
          router.push('/dashboard')
        }
      } else if (tab === 'signup') {
        const { data, error: signUpErr } = await signUpWithEmail(email, password)
        if (signUpErr) {
          if (signUpErr.message.includes('already registered')) {
            throw new Error('An account with this email already exists. Please sign in instead.')
          }
          throw signUpErr
        }

        // Check if session was returned immediately (auto-confirm enabled)
        if (data?.session) {
          if (onSuccess) {
            onSuccess(data)
          } else {
            router.push('/dashboard')
          }
        } else {
          // Email confirmation is required by Supabase project settings
          setSuccessMessage(
            'Account created! Please check your email inbox to confirm your account, then sign in.'
          )
        }
      }
    } catch (err) {
      setError(err.message || 'Authentication failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setError(null)
    try {
      await signInWithGoogle()
    } catch (err) {
      setError(err.message || 'Google sign in failed. Please use email/password.')
    }
  }

  return (
    <div className="w-full max-w-md bg-card rounded-2xl border border-border shadow-xl overflow-hidden">
      {/* Tab Switcher */}
      {tab !== 'reset' && (
        <div className="flex border-b border-border bg-muted/70">
          <button
            type="button"
            onClick={() => handleTabSwitch('signin')}
            className={`flex-1 py-3.5 text-sm font-semibold transition-colors ${
              tab === 'signin'
                ? 'bg-card text-accent border-b-2 border-primary shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => handleTabSwitch('signup')}
            className={`flex-1 py-3.5 text-sm font-semibold transition-colors ${
              tab === 'signup'
                ? 'bg-card text-accent border-b-2 border-primary shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Create Account
          </button>
        </div>
      )}

      {tab === 'reset' && (
        <div className="px-6 pt-5 pb-2 flex items-center justify-between border-b border-border">
          <h3 className="text-lg font-bold text-foreground">Reset Password</h3>
          <button
            type="button"
            onClick={() => handleTabSwitch('signin')}
            className="text-xs font-medium text-accent hover:text-accent"
          >
            ← Back to Sign In
          </button>
        </div>
      )}

      <div className="p-6 sm:p-8">
        {/* Error Alert */}
        {error && (
          <div className="mb-5 rounded-lg bg-destructive/10 border border-destructive/30 p-3.5 flex items-start text-sm text-destructive">
            <svg className="w-5 h-5 text-destructive mr-2.5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <div className="flex-1">{error}</div>
          </div>
        )}

        {/* Success Alert */}
        {successMessage && (
          <div className="mb-5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3.5 flex items-start text-sm text-emerald-300">
            <svg className="w-5 h-5 text-emerald-400 mr-2.5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <div className="flex-1">{successMessage}</div>
          </div>
        )}

        {/* Auth Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Email field */}
          <div>
            <label htmlFor="auth-email" className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
              Email Address
            </label>
            <div className="relative rounded-lg shadow-xs">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-muted-foreground">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                </svg>
              </div>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="block w-full pl-10 pr-3.5 py-2.5 border border-border rounded-lg text-sm text-foreground placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring transition-colors"
                autoComplete="email"
              />
            </div>
          </div>

          {/* Password field (not shown in reset tab) */}
          {tab !== 'reset' && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="auth-password" className="block text-xs font-semibold text-foreground uppercase tracking-wider">
                  Password
                </label>
                {tab === 'signin' && (
                  <button
                    type="button"
                    onClick={() => handleTabSwitch('reset')}
                    className="text-xs text-accent hover:text-accent transition-colors"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <div className="relative rounded-lg shadow-xs">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-muted-foreground">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={tab === 'signup' ? 'Create a secure password (6+ chars)' : 'Enter your password'}
                  className="block w-full pl-10 pr-10 py-2.5 border border-border rounded-lg text-sm text-foreground placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring transition-colors"
                  autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-muted-foreground focus:outline-none"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Confirm Password (only on Sign Up) */}
          {tab === 'signup' && (
            <div>
              <label htmlFor="auth-confirm-password" className="block text-xs font-semibold text-foreground uppercase tracking-wider mb-1.5">
                Confirm Password
              </label>
              <div className="relative rounded-lg shadow-xs">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-muted-foreground">
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <input
                  id="auth-confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your password"
                  className="block w-full pl-10 pr-3.5 py-2.5 border border-border rounded-lg text-sm text-foreground placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring transition-colors"
                  autoComplete="new-password"
                />
              </div>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-4 py-3 text-sm font-semibold text-white shadow-md hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center">
                <svg className="animate-spin -ml-1 mr-2.5 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {tab === 'signin' ? 'Signing In...' : tab === 'signup' ? 'Creating Account...' : 'Sending Link...'}
              </span>
            ) : (
              <span>
                {tab === 'signin' ? 'Sign In' : tab === 'signup' ? 'Create Account' : 'Send Reset Link'}
              </span>
            )}
          </button>
        </form>

        {/* Divider & Google OAuth Option */}
        {tab !== 'reset' && (
          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-3 text-muted-foreground font-medium">Or continue with</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="mt-4 w-full inline-flex items-center justify-center rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground shadow-xs hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-colors"
            >
              <svg className="mr-2.5 h-4 w-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Google
            </button>
          </div>
        )}

        {/* Footer switch prompt */}
        <div className="mt-6 text-center text-xs text-muted-foreground">
          {tab === 'signin' ? (
            <p>
              Don't have an account?{' '}
              <button
                type="button"
                onClick={() => handleTabSwitch('signup')}
                className="font-semibold text-accent hover:text-accent transition-colors"
              >
                Create one now
              </button>
            </p>
          ) : tab === 'signup' ? (
            <p>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => handleTabSwitch('signin')}
                className="font-semibold text-accent hover:text-accent transition-colors"
              >
                Sign in here
              </button>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
