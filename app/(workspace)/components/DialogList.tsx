'use client'

import { Dialog, ChannelType, PQLTier } from '../types'

function channelBadge(channel: ChannelType) {
  const map: Record<ChannelType, { label: string; color: string }> = {
    WEB_CHAT: { label: 'Web', color: 'bg-blue-100 text-blue-700' },
    TELEGRAM: { label: 'TG', color: 'bg-sky-100 text-sky-700' },
    VK_MAX: { label: 'VK', color: 'bg-indigo-100 text-indigo-700' },
  }
  const badge = map[channel] ?? { label: channel, color: 'bg-gray-100 text-gray-700' }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badge.color}`}>
      {badge.label}
    </span>
  )
}

function pqlBadge(tier?: PQLTier) {
  if (!tier) return null
  const map: Record<PQLTier, { label: string; color: string }> = {
    HOT: { label: 'HOT', color: 'bg-red-100 text-red-700' },
    WARM: { label: 'WARM', color: 'bg-orange-100 text-orange-700' },
    COLD: { label: 'COLD', color: 'bg-gray-100 text-gray-500' },
  }
  const badge = map[tier]
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badge.color}`}>
      {badge.label}
    </span>
  )
}

function timeAgo(dateStr?: string): string {
  if (!dateStr) return ''
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d`
}

interface DialogListProps {
  dialogs: Dialog[]
  selectedId: string | null
  onSelect: (id: string) => void
  loading: boolean
}

export function DialogList({ dialogs, selectedId, onSelect, loading }: DialogListProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
        Loading dialogs...
      </div>
    )
  }

  if (dialogs.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
        No open dialogs
      </div>
    )
  }

  return (
    <div className="flex flex-col overflow-y-auto">
      {dialogs.map((dialog) => {
        const isSelected = dialog.id === selectedId
        const contactName = dialog.contactEmail ?? dialog.externalChannelId.slice(0, 8)

        return (
          <button
            key={dialog.id}
            onClick={() => onSelect(dialog.id)}
            className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
              isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
            }`}
            data-testid={`dialog-item-${dialog.id}`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-sm text-gray-900 truncate max-w-[140px]">
                {contactName}
              </span>
              <div className="flex items-center gap-1">
                {channelBadge(dialog.channelType)}
                {pqlBadge(dialog.pqlTier)}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-500 truncate max-w-[180px]">
                {dialog.lastMessagePreview ?? 'No messages yet'}
              </p>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-400">
                  {timeAgo(dialog.lastMessageAt ?? dialog.updatedAt)}
                </span>
                {(dialog.unreadCount ?? 0) > 0 && (
                  <span className="bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-medium">
                    {dialog.unreadCount! > 9 ? '9+' : dialog.unreadCount}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-1 flex items-center gap-1">
              <span
                className={`w-2 h-2 rounded-full ${
                  dialog.status === 'OPEN'
                    ? 'bg-green-400'
                    : dialog.status === 'ASSIGNED'
                    ? 'bg-yellow-400'
                    : 'bg-gray-300'
                }`}
              />
              <span className="text-xs text-gray-400">{dialog.status}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
