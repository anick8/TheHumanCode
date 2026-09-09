'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/app/components/AuthProvider'

export default function DashboardNav({ session, user: propUser }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user: authUser, session: authSession, signOut } = useAuth()

  const currentUser = authUser || authSession?.user || propUser || session?.user
  const userEmail = currentUser?.email || 'User'
  const userInitial = userEmail.charAt(0).toUpperCase()

  const navigation = [
    { name: 'Sessions', href: '/dashboard' },
    { name: 'New Session', href: '/dashboard/sessions/new' },
  ]

  const isActive = (path) => {
    if (path === '/dashboard') {
      return pathname === '/dashboard'
    }
    return pathname.startsWith(path)
  }

  const handleSignOut = async () => {
    try {
      await signOut()
      router.push('/')
      router.refresh()
    } catch (error) {
      console.error('Error signing out:', error)
      router.push('/')
    }
  }

  return (
    <nav className="border-b border-gray-200 bg-white sticky top-0 z-30 shadow-2xs">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 justify-between items-center">
          <div className="flex items-center">
            <div className="flex flex-shrink-0 items-center">
              <Link href="/dashboard" className="flex items-center">
                <div className="h-9 w-9 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 flex items-center justify-center shadow-xs">
                  <span className="text-xl font-black text-white">⚡</span>
                </div>
                <span className="ml-3 text-xl font-bold text-gray-900">LivePolls</span>
                <span className="ml-2 text-xs font-semibold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
                  Dashboard
                </span>
              </Link>
            </div>
            <div className="hidden sm:ml-8 sm:flex sm:space-x-4">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`inline-flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    isActive(item.href)
                      ? 'bg-blue-50 text-blue-700 font-semibold'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex items-center">
              <div className="h-8 w-8 rounded-full bg-gradient-to-r from-blue-600 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-xs">
                {userInitial}
              </div>
              <span className="ml-2.5 text-xs sm:text-sm font-medium text-gray-700 max-w-[140px] sm:max-w-[200px] truncate hidden xs:inline-block">
                {userEmail}
              </span>
            </div>

            <button
              onClick={handleSignOut}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs sm:text-sm font-medium text-gray-700 shadow-2xs hover:bg-gray-50 hover:text-red-600 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Mobile navigation */}
        <div className="sm:hidden border-t border-gray-100 py-2 flex space-x-2">
          {navigation.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                isActive(item.href)
                  ? 'bg-blue-50 text-blue-700 font-semibold'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {item.name}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  )
}
