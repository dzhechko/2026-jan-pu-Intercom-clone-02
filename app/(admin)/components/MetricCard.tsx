'use client'

interface MetricCardProps {
  label: string
  value: string | number
  subtitle?: string
  colorClass?: string
}

export function MetricCard({ label, value, subtitle, colorClass = 'text-gray-900' }: MetricCardProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${colorClass}`}>{value}</p>
      {subtitle && (
        <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
      )}
    </div>
  )
}
