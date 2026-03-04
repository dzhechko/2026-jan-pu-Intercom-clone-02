'use client'

interface DailyTrendProps {
  data: Array<{ date: string; count: number }>
}

export function DailyTrend({ data }: DailyTrendProps) {
  if (data.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Daily Dialog Trend</h3>
        <p className="text-sm text-gray-400">No data available</p>
      </div>
    )
  }

  const maxCount = Math.max(...data.map((d) => d.count), 1)

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Daily Dialog Trend</h3>

      {/* Simple bar chart using Tailwind */}
      <div className="flex items-end gap-px h-32">
        {data.map((entry) => {
          const heightPct = (entry.count / maxCount) * 100
          return (
            <div
              key={entry.date}
              className="flex-1 group relative"
              title={`${entry.date}: ${entry.count} dialogs`}
            >
              <div
                className="bg-indigo-400 hover:bg-indigo-500 rounded-t transition-colors w-full"
                style={{ height: `${Math.max(heightPct, 2)}%` }}
              />
            </div>
          )
        })}
      </div>

      {/* Date labels — show first, middle, last */}
      <div className="flex justify-between mt-2 text-xs text-gray-400">
        <span>{data[0]?.date ?? ''}</span>
        {data.length > 2 && (
          <span>{data[Math.floor(data.length / 2)]?.date ?? ''}</span>
        )}
        <span>{data[data.length - 1]?.date ?? ''}</span>
      </div>

      {/* Summary table for recent days */}
      <div className="mt-4 max-h-40 overflow-y-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 border-b">
              <th className="text-left py-1 font-medium">Date</th>
              <th className="text-right py-1 font-medium">Dialogs</th>
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().slice(0, 10).map((entry) => (
              <tr key={entry.date} className="border-b border-gray-50">
                <td className="py-1 text-gray-600">{entry.date}</td>
                <td className="py-1 text-right font-medium text-gray-900">{entry.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
