'use client'

interface ChannelBreakdownProps {
  data: Record<string, number>
}

const CHANNEL_LABELS: Record<string, string> = {
  WEB_CHAT: 'Web Chat',
  TELEGRAM: 'Telegram',
  VK_MAX: 'VK Max',
}

const CHANNEL_COLORS: Record<string, string> = {
  WEB_CHAT: 'bg-blue-500',
  TELEGRAM: 'bg-sky-400',
  VK_MAX: 'bg-violet-500',
}

export function ChannelBreakdown({ data }: ChannelBreakdownProps) {
  const total = Object.values(data).reduce((sum, v) => sum + v, 0)
  const entries = Object.entries(data).sort(([, a], [, b]) => b - a)

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Dialogs by Channel</h3>
      {total === 0 ? (
        <p className="text-sm text-gray-400">No data available</p>
      ) : (
        <div className="space-y-3">
          {entries.map(([channel, count]) => {
            const pct = total > 0 ? (count / total) * 100 : 0
            return (
              <div key={channel}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">{CHANNEL_LABELS[channel] ?? channel}</span>
                  <span className="font-medium text-gray-900">
                    {count} <span className="text-gray-400">({pct.toFixed(1)}%)</span>
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className={`${CHANNEL_COLORS[channel] ?? 'bg-gray-400'} h-2 rounded-full transition-all`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
