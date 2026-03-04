'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Message } from '../types'

interface UseMessagesOptions {
  dialogId: string | null
  token: string
  tenantId: string
  on: (event: string, handler: (...args: unknown[]) => void) => () => void
  emit: (event: string, data: unknown) => void
}

/**
 * Hook: fetches message history for a dialog and handles real-time updates.
 */
export function useMessages({ dialogId, token, tenantId, on, emit }: UseMessagesOptions) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [typingIndicator, setTypingIndicator] = useState(false)

  // Fetch message history when dialog changes
  useEffect(() => {
    if (!dialogId || !token) {
      setMessages([])
      return
    }

    let cancelled = false

    async function fetchMessages() {
      setLoading(true)
      try {
        const res = await fetch(`/api/proxy/dialogs/${dialogId}/messages?limit=100`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error(`Failed to fetch messages: ${res.status}`)
        const data = await res.json()
        if (!cancelled) {
          setMessages(data.messages ?? [])
        }
      } catch (err) {
        console.error('[useMessages] fetch error:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchMessages()
    return () => {
      cancelled = true
    }
  }, [dialogId, token])

  // Real-time: new messages
  useEffect(() => {
    if (!dialogId) return

    const unsub = on('message:new', (payload: unknown) => {
      const data = payload as { message?: Message }
      if (!data.message || data.message.dialogId !== dialogId) return

      setMessages((prev) => {
        // Prevent duplicates
        if (prev.some((m) => m.id === data.message!.id)) return prev
        return [...prev, data.message!]
      })
    })
    return unsub
  }, [dialogId, on])

  // Real-time: typing indicator
  useEffect(() => {
    if (!dialogId) return

    const unsub = on('typing', (payload: unknown) => {
      const data = payload as { dialogId?: string; isTyping?: boolean; senderType?: string }
      if (data.dialogId !== dialogId || data.senderType !== 'CLIENT') return
      setTypingIndicator(!!data.isTyping)
    })
    return unsub
  }, [dialogId, on])

  // Clear typing after 5s timeout
  useEffect(() => {
    if (!typingIndicator) return
    const timeout = setTimeout(() => setTypingIndicator(false), 5000)
    return () => clearTimeout(timeout)
  }, [typingIndicator])

  const sendMessage = useCallback(
    async (content: string) => {
      if (!dialogId || !token || !content.trim()) return

      // Send via REST for reliability
      try {
        const res = await fetch(`/api/proxy/dialogs/${dialogId}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ content, senderType: 'OPERATOR' }),
        })
        if (!res.ok) throw new Error(`Send failed: ${res.status}`)
        const data = await res.json()

        // Also emit via Socket.io for instant broadcast
        emit('operator:message', { dialogId, tenantId, content })

        // Add to local messages immediately
        if (data.message) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === data.message.id)) return prev
            return [...prev, data.message]
          })
        }
      } catch (err) {
        console.error('[useMessages] send error:', err)
        throw err
      }
    },
    [dialogId, token, tenantId, emit],
  )

  const sendTyping = useCallback(
    (isTyping: boolean) => {
      if (!dialogId || !tenantId) return
      emit('typing', { dialogId, tenantId, isTyping, senderType: 'OPERATOR' })
    },
    [dialogId, tenantId, emit],
  )

  return { messages, loading, typingIndicator, sendMessage, sendTyping }
}
