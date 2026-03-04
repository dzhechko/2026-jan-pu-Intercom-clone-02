'use client'

import { useState, useEffect } from 'react'
import type { OperatorInfo } from '../hooks/useOperators'

interface OperatorListProps {
  operators: OperatorInfo[]
  currentOperatorId: string
  token: string
  loading: boolean
}

/**
 * Sidebar component showing online operators with their active dialog load.
 * Part of FR-13: Multi-operator support.
 */
export function OperatorList({
  operators,
  currentOperatorId,
  token,
  loading,
}: OperatorListProps) {
  const [stats, setStats] = useState<Record<string, { activeDialogs: number }>>({})

  // Fetch stats for online operators
  useEffect(() => {
    if (!token || operators.length === 0) return

    const onlineOps = operators.filter((op) => op.isOnline)
    if (onlineOps.length === 0) return

    Promise.all(
      onlineOps.map(async (op) => {
        try {
          const res = await fetch(`/api/proxy/operators/${op.id}/stats`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (!res.ok) return null
          const data = await res.json()
          return { id: op.id, activeDialogs: data.activeDialogs ?? 0 }
        } catch {
          return null
        }
      }),
    ).then((results) => {
      const newStats: Record<string, { activeDialogs: number }> = {}
      for (const r of results) {
        if (r) newStats[r.id] = { activeDialogs: r.activeDialogs }
      }
      setStats(newStats)
    })
  }, [operators, token])

  const onlineOperators = operators.filter((op) => op.isOnline)
  const offlineOperators = operators.filter((op) => !op.isOnline)

  if (loading) {
    return (
      <div className="p-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Team
        </h3>
        <div className="space-y-2 animate-pulse">
          <div className="h-8 bg-gray-200 rounded" />
          <div className="h-8 bg-gray-200 rounded" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-3" data-testid="operator-list">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
        Team ({onlineOperators.length} online)
      </h3>

      {/* Online operators */}
      <div className="space-y-1 mb-3">
        {onlineOperators.map((op) => (
          <div
            key={op.id}
            className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm ${
              op.id === currentOperatorId ? 'bg-blue-50' : 'hover:bg-gray-50'
            }`}
            data-testid={`operator-${op.id}`}
          >
            {/* Online indicator */}
            <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
            <span className="text-gray-700 truncate flex-1">
              {op.name}
              {op.id === currentOperatorId && (
                <span className="text-gray-400 text-xs ml-1">(you)</span>
              )}
            </span>
            {/* Role badge */}
            {op.role === 'ADMIN' && (
              <span className="text-[10px] font-semibold px-1 rounded bg-purple-100 text-purple-700 shrink-0">
                ADMIN
              </span>
            )}
            {/* Active dialog count */}
            {stats[op.id] != null && (
              <span className="text-[10px] text-gray-400 shrink-0">
                {stats[op.id].activeDialogs} active
              </span>
            )}
          </div>
        ))}
        {onlineOperators.length === 0 && (
          <p className="text-xs text-gray-400 italic px-2">No operators online</p>
        )}
      </div>

      {/* Offline operators */}
      {offlineOperators.length > 0 && (
        <>
          <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1 px-2">
            Offline
          </p>
          <div className="space-y-1">
            {offlineOperators.map((op) => (
              <div
                key={op.id}
                className="flex items-center gap-2 px-2 py-1 rounded text-sm opacity-50"
              >
                <span className="w-2 h-2 rounded-full bg-gray-300 shrink-0" />
                <span className="text-gray-500 truncate flex-1">{op.name}</span>
                {op.role === 'ADMIN' && (
                  <span className="text-[10px] font-semibold px-1 rounded bg-gray-100 text-gray-500 shrink-0">
                    ADMIN
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
