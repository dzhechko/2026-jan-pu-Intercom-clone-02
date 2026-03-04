'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

export interface PQLNotification {
  id: string
  type: 'pql_detected'
  dialogId: string
  title: string
  body: string
  metadata: {
    score?: number
    tier?: 'HOT' | 'WARM' | 'COLD'
    topSignals?: Array<{ type: string; weight: number }>
    contactEmail?: string | null
  }
  read: boolean
  createdAt: string
}

interface UseNotificationsOptions {
  token: string
  on: (event: string, handler: (...args: unknown[]) => void) => () => void
}

/**
 * Hook: fetches notifications from REST API and listens for real-time
 * `notification:pql` events via Socket.io.
 */
export function useNotifications({ token, on }: UseNotificationsOptions) {
  const [notifications, setNotifications] = useState<PQLNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const initialFetchDone = useRef(false)

  // Fetch initial notifications list
  const fetchNotifications = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API_BASE}/api/notifications?limit=20`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications ?? [])
      }
    } catch (err) {
      console.error('[useNotifications] fetch error', err)
    } finally {
      setLoading(false)
    }
  }, [token])

  // Fetch unread count
  const fetchUnreadCount = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`${API_BASE}/api/notifications/unread-count`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setUnreadCount(data.count ?? 0)
      }
    } catch (err) {
      console.error('[useNotifications] unread count error', err)
    }
  }, [token])

  // Mark a single notification as read
  const markAsRead = useCallback(
    async (notificationId: string) => {
      if (!token) return
      try {
        const res = await fetch(`${API_BASE}/api/notifications/${notificationId}/read`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          setNotifications((prev) =>
            prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)),
          )
          setUnreadCount((prev) => Math.max(0, prev - 1))
        }
      } catch (err) {
        console.error('[useNotifications] markAsRead error', err)
      }
    },
    [token],
  )

  // Initial fetch
  useEffect(() => {
    if (token && !initialFetchDone.current) {
      initialFetchDone.current = true
      fetchNotifications()
      fetchUnreadCount()
    }
  }, [token, fetchNotifications, fetchUnreadCount])

  // Listen for real-time PQL notifications via Socket.io
  useEffect(() => {
    const cleanup = on('notification:pql', (data: unknown) => {
      const payload = data as {
        type: string
        dialogId: string
        score: number
        tier: 'HOT' | 'WARM' | 'COLD'
        topSignals: Array<{ type: string; weight: number }>
        contactEmail?: string | null
        timestamp: string
      }

      const newNotification: PQLNotification = {
        id: `rt-${Date.now()}`,
        type: 'pql_detected',
        dialogId: payload.dialogId,
        title: `${payload.tier === 'HOT' ? 'Hot' : 'Warm'} PQL Lead Detected`,
        body: `Score: ${(payload.score * 100).toFixed(0)}% — ${payload.topSignals.map((s) => s.type).join(', ')}`,
        metadata: {
          score: payload.score,
          tier: payload.tier,
          topSignals: payload.topSignals,
          contactEmail: payload.contactEmail,
        },
        read: false,
        createdAt: payload.timestamp,
      }

      setNotifications((prev) => [newNotification, ...prev].slice(0, 50))
      setUnreadCount((prev) => prev + 1)
    })

    return cleanup
  }, [on])

  return {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    refresh: fetchNotifications,
  }
}
