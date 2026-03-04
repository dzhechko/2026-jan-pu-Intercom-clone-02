'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Dialog, PQLTier, QuickReply } from '../types'
import { useMemoryAI, type CRMContactContextUI, type MemoryAIStatus } from '../hooks/useMemoryAI'

interface PQLSignal {
  ruleId: string
  type: string
  weight: number
  matchedText: string
}

interface PQLDetectionResponse {
  detections: Array<{
    id: string
    dialogId: string
    score: number
    tier: string
    topSignals: PQLSignal[]
    signals: PQLSignal[]
    createdAt: string
  }>
}

const DEFAULT_QUICK_REPLIES: QuickReply[] = [
  { id: 'qr-1', label: 'Greeting', content: 'Hello! How can I help you today?' },
  { id: 'qr-2', label: 'Pricing', content: 'I would be happy to help with pricing information. Let me check what plan suits your needs.' },
  { id: 'qr-3', label: 'Follow up', content: 'Thank you for reaching out! Is there anything else I can help with?' },
  { id: 'qr-4', label: 'Transfer', content: 'Let me transfer you to a specialist who can better assist you with this.' },
  { id: 'qr-5', label: 'Closing', content: 'Thank you for chatting with us! Feel free to reach out anytime.' },
]

function pqlTierDisplay(tier?: PQLTier) {
  if (!tier) return { label: 'N/A', color: 'text-gray-400', bg: 'bg-gray-50' }
  const map: Record<PQLTier, { label: string; color: string; bg: string }> = {
    HOT: { label: 'HOT', color: 'text-red-600', bg: 'bg-red-50' },
    WARM: { label: 'WARM', color: 'text-orange-600', bg: 'bg-orange-50' },
    COLD: { label: 'COLD', color: 'text-gray-600', bg: 'bg-gray-50' },
  }
  return map[tier]
}

/** FR-13: Operator info for reassign dropdown */
interface OperatorOption {
  id: string
  name: string
  isOnline?: boolean
}

interface RightPanelProps {
  dialog: Dialog | null
  operatorId: string
  token?: string
  onAssign: (dialogId: string) => void
  onClose: (dialogId: string) => void
  onChangeStatus: (dialogId: string, status: string) => void
  onQuickReply: (content: string) => void
  /** FR-13: List of operators for reassignment */
  operators?: OperatorOption[]
  /** FR-13: Callback when dialog is reassigned to another operator */
  onReassign?: (dialogId: string, operatorId: string) => void
}

export function RightPanel({
  dialog,
  operatorId,
  token,
  onAssign,
  onClose,
  onChangeStatus,
  onQuickReply,
  operators,
  onReassign,
}: RightPanelProps) {
  const [pqlSignals, setPqlSignals] = useState<PQLSignal[]>([])
  const [loadingSignals, setLoadingSignals] = useState(false)

  // FR-03: Memory AI — CRM context
  const memoryAI = useMemoryAI({
    dialogId: dialog?.id ?? null,
    contactEmail: dialog?.contactEmail,
    token: token ?? '',
  })

  // Fetch PQL detections when dialog changes
  useEffect(() => {
    if (!dialog?.id || !token) {
      setPqlSignals([])
      return
    }

    let cancelled = false
    setLoadingSignals(true)

    fetch(`/api/proxy/pql/detections/${dialog.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : { detections: [] }))
      .then((data: PQLDetectionResponse) => {
        if (cancelled) return
        // Aggregate unique signals across all detections for this dialog
        const signalMap = new Map<string, PQLSignal>()
        for (const detection of data.detections) {
          for (const signal of detection.signals) {
            // Keep highest-weight instance per signal type
            const existing = signalMap.get(signal.type)
            if (!existing || signal.weight > existing.weight) {
              signalMap.set(signal.type, signal)
            }
          }
        }
        setPqlSignals(
          Array.from(signalMap.values()).sort((a, b) => b.weight - a.weight),
        )
      })
      .catch(() => {
        if (!cancelled) setPqlSignals([])
      })
      .finally(() => {
        if (!cancelled) setLoadingSignals(false)
      })

    return () => {
      cancelled = true
    }
  }, [dialog?.id, dialog?.pqlScore, token])

  if (!dialog) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm p-4">
        Select a dialog to view details
      </div>
    )
  }

  const tier = pqlTierDisplay(dialog.pqlTier)
  const isAssignedToMe = dialog.assignedOperatorId === operatorId

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* PQL Score section */}
      <div className={`p-4 border-b border-gray-200 ${tier.bg}`}>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          PQL Score
        </h3>
        <div className="flex items-center gap-3">
          <span className={`text-3xl font-bold ${tier.color}`}>
            {dialog.pqlScore ?? 0}
          </span>
          <span className={`text-sm font-semibold px-2 py-0.5 rounded ${tier.color} ${tier.bg} border`}>
            {tier.label}
          </span>
        </div>

        {/* PQL Signals -- real data from API */}
        <div className="mt-3">
          <p className="text-xs text-gray-500 mb-1 font-medium">Top Signals</p>
          {loadingSignals && (
            <p className="text-xs text-gray-400 italic">Loading signals...</p>
          )}
          {!loadingSignals && pqlSignals.length > 0 && (
            <ul className="text-xs text-gray-600 space-y-0.5" data-testid="pql-signals-list">
              {pqlSignals.slice(0, 5).map((signal) => (
                <li key={signal.ruleId} className="flex items-center gap-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-current opacity-50" />
                  <span className="font-medium">{signal.type.replace(/_/g, ' ')}</span>
                  <span className="text-gray-400 ml-auto">
                    {Math.round(signal.weight * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!loadingSignals && pqlSignals.length === 0 && (
            <p className="text-xs text-gray-400 italic">No significant signals detected</p>
          )}
        </div>
      </div>

      {/* Contact Info */}
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Contact
        </h3>
        <div className="space-y-1 text-sm">
          <p className="text-gray-700">
            <span className="text-gray-500">Email:</span>{' '}
            {dialog.contactEmail ?? 'Unknown'}
          </p>
          <p className="text-gray-700">
            <span className="text-gray-500">Channel:</span>{' '}
            {dialog.channelType}
          </p>
          <p className="text-gray-700">
            <span className="text-gray-500">Status:</span>{' '}
            {dialog.status}
          </p>
          {dialog.assignedOperatorId && (
            <p className="text-gray-700">
              <span className="text-gray-500">Assigned:</span>{' '}
              {isAssignedToMe ? 'You' : dialog.assignedOperatorId.slice(0, 8) + '...'}
            </p>
          )}
        </div>
      </div>

      {/* FR-03: Memory AI (CRM Context) */}
      <div className="p-4 border-b border-gray-200" data-testid="memory-ai-section">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Memory AI (CRM)
          </h3>
          {memoryAI.status === 'ok' && memoryAI.data && (
            <button
              onClick={memoryAI.refresh}
              className="text-xs text-blue-500 hover:text-blue-700 transition-colors"
              title="Refresh CRM data"
            >
              Refresh
            </button>
          )}
        </div>

        {/* Loading state */}
        {memoryAI.status === 'loading' && (
          <div className="space-y-2 animate-pulse">
            <div className="h-3 bg-gray-200 rounded w-3/4" />
            <div className="h-3 bg-gray-200 rounded w-1/2" />
            <div className="h-3 bg-gray-200 rounded w-2/3" />
          </div>
        )}

        {/* CRM not configured */}
        {memoryAI.status === 'not_configured' && (
          <p className="text-xs text-gray-400 italic">
            CRM not configured. Connect amoCRM in Settings to see customer context.
          </p>
        )}

        {/* No email on dialog */}
        {memoryAI.status === 'no_email' && (
          <p className="text-xs text-gray-400 italic">
            No contact email for this dialog.
          </p>
        )}

        {/* Error state */}
        {memoryAI.status === 'error' && (
          <div>
            <p className="text-xs text-red-400 italic">
              Failed to load CRM data.
            </p>
            <button
              onClick={memoryAI.refresh}
              className="text-xs text-blue-500 hover:text-blue-700 mt-1"
            >
              Retry
            </button>
          </div>
        )}

        {/* Idle — no dialog selected */}
        {memoryAI.status === 'idle' && (
          <p className="text-xs text-gray-400 italic">
            No data available.
          </p>
        )}

        {/* Success: show CRM context */}
        {memoryAI.status === 'ok' && memoryAI.data && (
          <MemoryAIDisplay data={memoryAI.data} />
        )}
      </div>

      {/* Quick Replies */}
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Quick Replies
        </h3>
        <div className="space-y-1.5">
          {DEFAULT_QUICK_REPLIES.map((qr, index) => (
            <button
              key={qr.id}
              onClick={() => onQuickReply(qr.content)}
              className="w-full text-left text-xs px-2.5 py-1.5 rounded border border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-colors text-gray-700 flex items-center justify-between"
              data-testid={`quick-reply-${qr.id}`}
              title={index < 9 ? `Alt+${index + 1}` : undefined}
            >
              <span>{qr.label}</span>
              {index < 9 && (
                <kbd className="ml-1 text-[10px] text-gray-400 font-mono">Alt+{index + 1}</kbd>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Dialog Actions */}
      <div className="p-4 space-y-2">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Actions
        </h3>

        {!isAssignedToMe && dialog.status === 'OPEN' && (
          <button
            onClick={() => onAssign(dialog.id)}
            className="w-full text-sm px-3 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 transition-colors font-medium"
            data-testid="assign-button"
            title="Assign to me (Alt+A)"
          >
            Assign to me
            <kbd className="ml-2 text-xs text-blue-200 font-mono">Alt+A</kbd>
          </button>
        )}

        {dialog.status !== 'CLOSED' && dialog.status !== 'ARCHIVED' && (
          <button
            onClick={() => onClose(dialog.id)}
            className="w-full text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
            data-testid="close-dialog-button"
            title="Close dialog (Alt+C)"
          >
            Close dialog
            <kbd className="ml-2 text-xs text-gray-400 font-mono">Alt+C</kbd>
          </button>
        )}

        {dialog.status === 'CLOSED' && (
          <button
            onClick={() => onChangeStatus(dialog.id, 'ARCHIVED')}
            className="w-full text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            Archive
          </button>
        )}

        {dialog.status === 'ASSIGNED' && (
          <button
            onClick={() => onChangeStatus(dialog.id, 'OPEN')}
            className="w-full text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            Unassign
          </button>
        )}

        {/* FR-13: Reassign dropdown */}
        {onReassign && operators && operators.length > 0 &&
          (dialog.status === 'OPEN' || dialog.status === 'ASSIGNED') && (
          <div data-testid="reassign-section">
            <label className="text-xs text-gray-500 block mb-1">Reassign to:</label>
            <select
              className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
              data-testid="reassign-select"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  onReassign(dialog.id, e.target.value)
                  e.target.value = ''
                }
              }}
            >
              <option value="" disabled>
                Select operator...
              </option>
              {operators
                .filter((op) => op.id !== dialog.assignedOperatorId && op.isOnline)
                .map((op) => (
                  <option key={op.id} value={op.id}>
                    {op.name} {op.id === operatorId ? '(you)' : ''}
                  </option>
                ))}
            </select>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * FR-03: Memory AI Display — renders enriched CRM context in the operator sidebar.
 */
function MemoryAIDisplay({ data }: { data: CRMContactContextUI }) {
  const hasData = data.enrichmentScore > 0

  if (!hasData) {
    return (
      <p className="text-xs text-gray-400 italic">
        No CRM data available for this contact.
      </p>
    )
  }

  return (
    <div className="space-y-2.5 text-xs" data-testid="memory-ai-data">
      {/* Contact name */}
      {data.contactName && (
        <div>
          <span className="text-gray-500">Name:</span>{' '}
          <span className="text-gray-700 font-medium">{data.contactName}</span>
        </div>
      )}

      {/* Current plan */}
      {data.currentPlan && (
        <div>
          <span className="text-gray-500">Plan:</span>{' '}
          <span className="inline-block px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">
            {data.currentPlan}
          </span>
        </div>
      )}

      {/* Account age */}
      {data.accountAge != null && (
        <div>
          <span className="text-gray-500">Customer for:</span>{' '}
          <span className="text-gray-700">
            {data.accountAge >= 365
              ? `${Math.floor(data.accountAge / 365)}y ${data.accountAge % 365}d`
              : `${data.accountAge} days`}
          </span>
        </div>
      )}

      {/* Previous dialogs */}
      <div>
        <span className="text-gray-500">Previous dialogs:</span>{' '}
        <span className="text-gray-700">{data.previousDialogCount}</span>
      </div>

      {/* Tags */}
      {data.tags.length > 0 && (
        <div>
          <span className="text-gray-500 block mb-1">Tags:</span>
          <div className="flex flex-wrap gap-1">
            {data.tags.map((tag) => (
              <span
                key={tag}
                className="inline-block px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px]"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Deals */}
      {data.deals.length > 0 && (
        <div>
          <span className="text-gray-500 block mb-1">
            Deals ({data.deals.length}):
          </span>
          <div className="space-y-1">
            {data.deals.map((deal) => (
              <div
                key={deal.id}
                className="flex items-center justify-between px-2 py-1 rounded bg-gray-50 border border-gray-100"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-gray-700 truncate block">{deal.title}</span>
                </div>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  <span className="text-gray-600 font-medium">
                    ${deal.value.toLocaleString()}
                  </span>
                  <span
                    className={`text-[10px] font-semibold px-1 rounded ${
                      deal.status === 'WON'
                        ? 'bg-green-100 text-green-700'
                        : deal.status === 'LOST'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    {deal.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Enrichment score */}
      <div className="pt-1 border-t border-gray-100">
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Data completeness</span>
          <span className="text-gray-500 font-medium">
            {Math.round(data.enrichmentScore * 100)}%
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-1 mt-1">
          <div
            className="bg-blue-400 h-1 rounded-full transition-all"
            style={{ width: `${Math.round(data.enrichmentScore * 100)}%` }}
          />
        </div>
      </div>
    </div>
  )
}
