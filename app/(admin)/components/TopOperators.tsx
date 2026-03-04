'use client'

interface TopOperatorsProps {
  data: Array<{
    operatorId: string
    name: string
    dialogsClosed: number
    pqlConverted: number
  }>
}

export function TopOperators({ data }: TopOperatorsProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Top Operators</h3>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400">No operator data available</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 border-b border-gray-200">
                <th className="text-left py-2 font-medium">#</th>
                <th className="text-left py-2 font-medium">Operator</th>
                <th className="text-right py-2 font-medium">Closed</th>
                <th className="text-right py-2 font-medium">PQL Converted</th>
              </tr>
            </thead>
            <tbody>
              {data.map((op, idx) => (
                <tr key={op.operatorId} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 text-gray-400">{idx + 1}</td>
                  <td className="py-2 font-medium text-gray-900">{op.name}</td>
                  <td className="py-2 text-right text-gray-700">{op.dialogsClosed}</td>
                  <td className="py-2 text-right">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      {op.pqlConverted}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
