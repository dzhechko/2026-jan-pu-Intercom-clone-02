'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * FR-03: Memory AI — CRM contact context for the operator sidebar.
 * Fetches enriched CRM context when a dialog is selected.
 * Caches results in local state; auto-refreshes when dialog changes.
 */

export interface CRMContactContextUI {
  contactEmail: string
  contactName?: string
  currentPlan?: string
  accountAge?: number
  deals: { id: string; title: string; value: number; status: string; closedAt?: string }[]
  previousDialogCount: number
  tags: string[]
  enrichmentScore: number
}

export type MemoryAIStatus = 'idle' | 'loading' | 'ok' | 'not_configured' | 'error' | 'no_email'

interface MemoryAIState {
  status: MemoryAIStatus
  data: CRMContactContextUI | null
  error: string | null
}

interface UseMemoryAIOptions {
  dialogId: string | null
  contactEmail: string | null | undefined
  token: string
}

export function useMemoryAI({ dialogId, contactEmail, token }: UseMemoryAIOptions) {
  const [state, setState] = useState<MemoryAIState>({
    status: 'idle',
    data: null,
    error: null,
  })

  // Local cache: dialogId/email -> context
  const cacheRef = useRef<Map<string, CRMContactContextUI>>(new Map())

  const fetchContext = useCallback(async () => {
    if (!dialogId || !token) {
      setState({ status: 'idle', data: null, error: null })
      return
    }

    if (!contactEmail) {
      setState({ status: 'no_email', data: null, error: null })
      return
    }

    // Check local cache first
    const cacheKey = `${dialogId}:${contactEmail}`
    const cached = cacheRef.current.get(cacheKey)
    if (cached) {
      setState({ status: 'ok', data: cached, error: null })
      return
    }

    setState({ status: 'loading', data: null, error: null })

    try {
      const res = await fetch(`/api/proxy/memory/${dialogId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) {
        setState({ status: 'error', data: null, error: `HTTP ${res.status}` })
        return
      }

      const json = await res.json()

      if (json.status === 'not_configured') {
        setState({ status: 'not_configured', data: null, error: null })
        return
      }

      if (json.status === 'error') {
        setState({ status: 'error', data: null, error: json.error || 'Unknown error' })
        return
      }

      const data = json.data as CRMContactContextUI
      cacheRef.current.set(cacheKey, data)
      setState({ status: 'ok', data, error: null })
    } catch (err) {
      setState({
        status: 'error',
        data: null,
        error: err instanceof Error ? err.message : 'Failed to fetch CRM context',
      })
    }
  }, [dialogId, contactEmail, token])

  // Auto-fetch when dialog changes
  useEffect(() => {
    fetchContext()
  }, [fetchContext])

  // Allow manual refresh (clears cache for this dialog)
  const refresh = useCallback(() => {
    if (dialogId && contactEmail) {
      cacheRef.current.delete(`${dialogId}:${contactEmail}`)
    }
    fetchContext()
  }, [dialogId, contactEmail, fetchContext])

  return {
    ...state,
    refresh,
  }
}
