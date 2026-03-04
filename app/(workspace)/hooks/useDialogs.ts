'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { Dialog, Message } from '../types'

/**
 * Sort dialogs: HOT first, then WARM, then COLD/undefined, then by most recent message.
 */
export function sortDialogs(dialogs: Dialog[]): Dialog[] {
  const tierOrder: Record<string, number> = { HOT: 0, WARM: 1, COLD: 2 }

  return [...dialogs].sort((a, b) => {
    const tierA = a.pqlTier ? tierOrder[a.pqlTier] ?? 3 : 3
    const tierB = b.pqlTier ? tierOrder[b.pqlTier] ?? 3 : 3
    if (tierA !== tierB) return tierA - tierB

    const timeA = a.lastMessageAt ?? a.updatedAt ?? a.createdAt
    const timeB = b.lastMessageAt ?? b.updatedAt ?? b.createdAt
    return new Date(timeB).getTime() - new Date(timeA).getTime()
  })
}

interface UseDialogsOptions {
  token: string
  on: (event: string, handler: (...args: unknown[]) => void) => () => void
}

/**
 * Hook: fetches dialogs from the API and keeps them updated via Socket.io events.
 */
export function useDialogs({ token, on }: UseDialogsOptions) {
  const [dialogs, setDialogs] = useState<Dialog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const dialogsRef = useRef<Dialog[]>([])

  // Keep ref in sync
  useEffect(() => {
    dialogsRef.current = dialogs
  }, [dialogs])

  const fetchDialogs = useCallback(async () => {
    if (!token) return
    try {
      setLoading(true)
      const res = await fetch('/api/proxy/dialogs', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Failed to fetch dialogs: ${res.status}`)
      const data = await res.json()
      const sorted = sortDialogs(data.dialogs ?? [])
      setDialogs(sorted)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [token])

  // Initial fetch
  useEffect(() => {
    fetchDialogs()
  }, [fetchDialogs])

  // Real-time: new messages update dialog preview + resort
  useEffect(() => {
    const unsub = on('message:new', (payload: unknown) => {
      const data = payload as { message?: Message; dialog?: Dialog }
      if (!data.message) return

      setDialogs((prev) => {
        const msg = data.message!
        let updated = prev.map((d) => {
          if (d.id === msg.dialogId) {
            return {
              ...d,
              lastMessagePreview: msg.content.slice(0, 100),
              lastMessageAt: msg.createdAt,
              unreadCount: (d.unreadCount ?? 0) + (msg.direction === 'INBOUND' ? 1 : 0),
            }
          }
          return d
        })

        // If the dialog doesn't exist yet (new dialog), add it
        if (data.dialog && !prev.some((d) => d.id === data.dialog!.id)) {
          updated = [...updated, { ...data.dialog!, lastMessagePreview: msg.content.slice(0, 100), lastMessageAt: msg.createdAt, unreadCount: 1 }]
        }

        return sortDialogs(updated)
      })
    })
    return unsub
  }, [on])

  // Real-time: new dialog created
  useEffect(() => {
    const unsub = on('dialog:created', (payload: unknown) => {
      const data = payload as { dialog?: Dialog }
      if (!data.dialog) return

      setDialogs((prev) => {
        if (prev.some((d) => d.id === data.dialog!.id)) return prev
        return sortDialogs([...prev, { ...data.dialog!, unreadCount: 1 }])
      })
    })
    return unsub
  }, [on])

  // Real-time: dialog assigned
  useEffect(() => {
    const unsub = on('dialog:assigned', (payload: unknown) => {
      const data = payload as { dialog?: Dialog }
      if (!data.dialog) return

      setDialogs((prev) =>
        sortDialogs(
          prev.map((d) => (d.id === data.dialog!.id ? { ...d, ...data.dialog!, unreadCount: d.unreadCount } : d)),
        ),
      )
    })
    return unsub
  }, [on])

  const clearUnread = useCallback((dialogId: string) => {
    setDialogs((prev) =>
      prev.map((d) => (d.id === dialogId ? { ...d, unreadCount: 0 } : d)),
    )
  }, [])

  return { dialogs, loading, error, fetchDialogs, clearUnread }
}
