'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const TOKEN_KEY = 'kommuniq_token'
const OPERATOR_KEY = 'kommuniq_operator'

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const [authorized, setAuthorized] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    const operator = localStorage.getItem(OPERATOR_KEY)

    if (!token || !operator) {
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

  return <>{children}</>
}
