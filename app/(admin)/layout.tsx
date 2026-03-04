'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const TOKEN_KEY = 'kommuniq_token'
const OPERATOR_KEY = 'kommuniq_operator'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const [authorized, setAuthorized] = useState(false)
  const [operatorName, setOperatorName] = useState('')

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    const operatorRaw = localStorage.getItem(OPERATOR_KEY)

    if (!token || !operatorRaw) {
      router.replace('/login')
      return
    }

    try {
      const operator = JSON.parse(operatorRaw)
      if (operator.role !== 'ADMIN') {
        // Non-admin operators get redirected to workspace
        router.replace('/')
        return
      }
      setOperatorName(operator.name || 'Admin')
    } catch {
      router.replace('/login')
      return
    }

    // Verify token is still valid
    fetch('/api/proxy/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) {
          localStorage.removeItem(TOKEN_KEY)
          localStorage.removeItem(OPERATOR_KEY)
          router.replace('/login')
          return
        }
        setAuthorized(true)
      })
      .catch(() => {
        router.replace('/login')
      })
  }, [router])

  if (!authorized) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-gray-400">Checking authorization...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Admin navigation header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-6">
            <h1 className="text-lg font-semibold text-gray-900">
              KommuniQ <span className="text-indigo-600">Admin</span>
            </h1>
            <nav className="flex gap-4">
              <Link
                href="/dashboard"
                className="text-sm text-gray-600 hover:text-indigo-600 transition-colors"
              >
                Dashboard
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">{operatorName}</span>
            <Link
              href="/"
              className="text-sm text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              Back to Workspace
            </Link>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {children}
      </main>
    </div>
  )
}
