'use client'

import { useState, useEffect, useCallback } from 'react'
import { MetricCard } from '../components/MetricCard'
import { ChannelBreakdown } from '../components/ChannelBreakdown'
import { PQLTierChart } from '../components/PQLTierChart'
import { DailyTrend } from '../components/DailyTrend'
import { TopOperators } from '../components/TopOperators'

const TOKEN_KEY = 'kommuniq_token'

type Period = '7d' | '30d' | '90d'

interface DashboardMetrics {
  totalDialogs: number
  pqlDetectedCount: number
  pqlRate: number
  avgResponseTimeMs: number | null
  pqlConversionRate: number
  dialogsByChannel: Record<string, number>
  pqlByTier: Record<string, number>
  dailyDialogCounts: Array<{ date: string; count: number }>
  topOperators: Array<{
    operatorId: string
    name: string
    dialogsClosed: number
    pqlConverted: number
  }>
}

function formatResponseTime(ms: number | null): string {
  if (ms === null) return '--'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<Period>('30d')
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchMetrics = useCallback(async () => {
    setLoading(true)
    setError(null)

    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) {
      setError('Not authenticated')
      setLoading(false)
      return
    }

    try {
      const res = await fetch(`/api/proxy/analytics/dashboard?period=${period}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }

      const data: DashboardMetrics = await res.json()
      setMetrics(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load metrics')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    fetchMetrics()
  }, [fetchMetrics])

  return (
    <div>
      {/* Header with period selector */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Analytics Dashboard</h2>
        <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
          {(['7d', '30d', '90d'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                period === p
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : '90 Days'}
            </button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={fetchMetrics}
            className="text-sm text-red-600 underline mt-1"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && !metrics && (
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-400">Loading dashboard metrics...</div>
        </div>
      )}

      {/* Dashboard content */}
      {metrics && (
        <div className="space-y-6">
          {/* Metric cards row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label="Total Dialogs"
              value={metrics.totalDialogs}
              subtitle={`In last ${period}`}
            />
            <MetricCard
              label="PQL Rate"
              value={`${metrics.pqlRate}%`}
              subtitle={`${metrics.pqlDetectedCount} of ${metrics.totalDialogs} dialogs`}
              colorClass={metrics.pqlRate > 10 ? 'text-green-600' : 'text-gray-900'}
            />
            <MetricCard
              label="Avg Response Time"
              value={formatResponseTime(metrics.avgResponseTimeMs)}
              subtitle="Dialog open to first reply"
            />
            <MetricCard
              label="PQL Conversion"
              value={`${metrics.pqlConversionRate}%`}
              subtitle="PQL to closed deal"
              colorClass={metrics.pqlConversionRate > 5 ? 'text-green-600' : 'text-gray-900'}
            />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChannelBreakdown data={metrics.dialogsByChannel} />
            <PQLTierChart data={metrics.pqlByTier} />
          </div>

          {/* Trend and operators row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DailyTrend data={metrics.dailyDialogCounts} />
            <TopOperators data={metrics.topOperators} />
          </div>
        </div>
      )}
    </div>
  )
}
