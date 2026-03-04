'use client'

import { useState, useEffect, useCallback } from 'react'

export interface OperatorInfo {
  id: string
  email: string
  name: string
  role: 'ADMIN' | 'OPERATOR'
  status: string
  isOnline?: boolean
  activeDialogs?: number
}

interface UseOperatorsOptions {
  token: string
  on: (event: string, handler: (...args: unknown[]) => void) => () => void
}

/**
 * Hook: fetches operators from the API and keeps online status updated via Socket.io.
 */
export function useOperators({ token, on }: UseOperatorsOptions) {
  const [operators, setOperators] = useState<OperatorInfo[]>([])
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const fetchOperators = useCallback(async () => {
    if (!token) return
    try {
      setLoading(true)

      // Fetch all operators and online operators in parallel
      const [allRes, onlineRes] = await Promise.all([
        fetch('/api/proxy/operators', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/proxy/operators/online', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ])

      if (!allRes.ok) return

      const allData = await allRes.json()
      const onlineData = onlineRes.ok ? await onlineRes.json() : { operators: [] }

      const onlineSet = new Set<string>(
        (onlineData.operators ?? []).map((op: OperatorInfo) => op.id),
      )
      setOnlineIds(onlineSet)

      const ops: OperatorInfo[] = (allData.operators ?? []).map((op: OperatorInfo) => ({
        ...op,
        isOnline: onlineSet.has(op.id),
      }))

      setOperators(ops)
    } catch {
      // Silently fail — operators list is supplementary
    } finally {
      setLoading(false)
    }
  }, [token])

  // Initial fetch
  useEffect(() => {
    fetchOperators()
  }, [fetchOperators])

  // Real-time: operator comes online
  useEffect(() => {
    const unsub = on('operator:online', (payload: unknown) => {
      const data = payload as { operatorId?: string }
      if (!data.operatorId) return

      setOnlineIds((prev) => {
        const next = new Set(prev)
        next.add(data.operatorId!)
        return next
      })
      setOperators((prev) =>
        prev.map((op) =>
          op.id === data.operatorId ? { ...op, isOnline: true } : op,
        ),
      )
    })
    return unsub
  }, [on])

  // Real-time: operator goes offline
  useEffect(() => {
    const unsub = on('operator:offline', (payload: unknown) => {
      const data = payload as { operatorId?: string }
      if (!data.operatorId) return

      setOnlineIds((prev) => {
        const next = new Set(prev)
        next.delete(data.operatorId!)
        return next
      })
      setOperators((prev) =>
        prev.map((op) =>
          op.id === data.operatorId ? { ...op, isOnline: false } : op,
        ),
      )
    })
    return unsub
  }, [on])

  return { operators, onlineIds, loading, fetchOperators }
}
