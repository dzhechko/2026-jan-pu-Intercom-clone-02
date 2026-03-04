'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

interface UseSocketOptions {
  token: string
  tenantId: string
  operatorId: string
}

/**
 * Hook: manages a single Socket.io connection to the /chat namespace.
 * Reconnects when auth params change. Disconnects on unmount.
 */
export function useSocket({ token, tenantId, operatorId }: UseSocketOptions) {
  const socketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!token || !tenantId || !operatorId) return

    const socket = io(`${API_BASE}/chat`, {
      auth: { token, tenantId, operatorId },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    })

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))

    socketRef.current = socket

    return () => {
      socket.disconnect()
      socketRef.current = null
      setConnected(false)
    }
  }, [token, tenantId, operatorId])

  const emit = useCallback(
    (event: string, data: unknown) => {
      socketRef.current?.emit(event, data)
    },
    [],
  )

  const on = useCallback(
    (event: string, handler: (...args: unknown[]) => void) => {
      socketRef.current?.on(event, handler)
      return () => {
        socketRef.current?.off(event, handler)
      }
    },
    [],
  )

  return { socket: socketRef, connected, emit, on }
}
