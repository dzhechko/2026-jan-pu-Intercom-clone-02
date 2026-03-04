'use client'

interface PQLTierChartProps {
  data: Record<string, number>
}

const TIER_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  HOT: { label: 'Hot', color: 'text-red-700', bgColor: 'bg-red-500' },
  WARM: { label: 'Warm', color: 'text-amber-700', bgColor: 'bg-amber-400' },
  COLD: { label: 'Cold', color: 'text-blue-700', bgColor: 'bg-blue-400' },
}

export function PQLTierChart({ data }: PQLTierChartProps) {
  const total = Object.values(data).reduce((sum, v) => sum + v, 0)
  const tiers = ['HOT', 'WARM', 'COLD']

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">PQL by Tier</h3>
      {total === 0 ? (
        <p className="text-sm text-gray-400">No PQL detections</p>
      ) : (
        <div className="space-y-3">
          {tiers.map((tier) => {
            const config = TIER_CONFIG[tier]
            const count = data[tier] ?? 0
            const pct = total > 0 ? (count / total) * 100 : 0
            return (
              <div key={tier}>
                <div className="flex justify-between text-sm mb-1">
                  <span className={`font-medium ${config.color}`}>{config.label}</span>
                  <span className="font-medium text-gray-900">
                    {count} <span className="text-gray-400">({pct.toFixed(1)}%)</span>
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className={`${config.bgColor} h-2 rounded-full transition-all`}
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
