'use client'

import type { Dialog, PQLTier, QuickReply } from '../types'

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

interface RightPanelProps {
  dialog: Dialog | null
  operatorId: string
  onAssign: (dialogId: string) => void
  onClose: (dialogId: string) => void
  onChangeStatus: (dialogId: string, status: string) => void
  onQuickReply: (content: string) => void
}

export function RightPanel({
  dialog,
  operatorId,
  onAssign,
  onClose,
  onChangeStatus,
  onQuickReply,
}: RightPanelProps) {
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

        {/* PQL Signals placeholder */}
        <div className="mt-3">
          <p className="text-xs text-gray-500 mb-1 font-medium">Top Signals</p>
          {dialog.pqlTier === 'HOT' && (
            <ul className="text-xs text-gray-600 space-y-0.5">
              <li>-- Pricing page visited 3x</li>
              <li>-- Compared plans in conversation</li>
              <li>-- Asked about enterprise features</li>
            </ul>
          )}
          {dialog.pqlTier === 'WARM' && (
            <ul className="text-xs text-gray-600 space-y-0.5">
              <li>-- Multiple return visits</li>
              <li>-- Feature inquiry detected</li>
            </ul>
          )}
          {(!dialog.pqlTier || dialog.pqlTier === 'COLD') && (
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

      {/* Memory AI placeholder */}
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Memory AI (CRM)
        </h3>
        <p className="text-xs text-gray-400 italic">
          CRM data will appear here when FR-03 Memory AI is implemented.
        </p>
      </div>

      {/* Quick Replies */}
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Quick Replies
        </h3>
        <div className="space-y-1.5">
          {DEFAULT_QUICK_REPLIES.map((qr) => (
            <button
              key={qr.id}
              onClick={() => onQuickReply(qr.content)}
              className="w-full text-left text-xs px-2.5 py-1.5 rounded border border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-colors text-gray-700"
              data-testid={`quick-reply-${qr.id}`}
            >
              {qr.label}
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
          >
            Assign to me
          </button>
        )}

        {dialog.status !== 'CLOSED' && dialog.status !== 'ARCHIVED' && (
          <button
            onClick={() => onClose(dialog.id)}
            className="w-full text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
            data-testid="close-dialog-button"
          >
            Close dialog
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
      </div>
    </div>
  )
}
