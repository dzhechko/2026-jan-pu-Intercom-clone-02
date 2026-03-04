/**
 * Analytics Service — Unit Tests
 * FR-08: Basic Analytics Dashboard
 *
 * Tests metric calculation with mock Pool returning controlled data.
 */
import { AnalyticsService, PeriodFilter, DashboardMetrics } from './analytics-service'

// ─── Mock Pool ──────────────────────────────────────────────────────────────

function createMockPool(queryResponses: Array<{ rows: Record<string, unknown>[] }>) {
  let callIndex = 0
  return {
    query: jest.fn().mockImplementation(() => {
      const response = queryResponses[callIndex] ?? { rows: [] }
      callIndex++
      return Promise.resolve(response)
    }),
  } as unknown as import('pg').Pool
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AnalyticsService', () => {
  const tenantId = '11111111-1111-1111-1111-111111111111'

  describe('getDashboardMetrics', () => {
    it('should return correct metrics with populated data', async () => {
      const mockPool = createMockPool([
        // totalDialogs
        { rows: [{ total: 120 }] },
        // pqlDetectedCount
        { rows: [{ total: 24 }] },
        // avgResponseTime
        { rows: [{ avg_ms: 45000 }] },
        // conversion (deals closed from PQL)
        { rows: [{ converted: 6 }] },
        // dialogsByChannel
        { rows: [
          { channel_type: 'WEB_CHAT', count: 80 },
          { channel_type: 'TELEGRAM', count: 30 },
          { channel_type: 'VK_MAX', count: 10 },
        ]},
        // pqlByTier
        { rows: [
          { pql_tier: 'HOT', count: 5 },
          { pql_tier: 'WARM', count: 12 },
          { pql_tier: 'COLD', count: 7 },
        ]},
        // dailyDialogCounts
        { rows: [
          { date: '2026-03-01', count: 5 },
          { date: '2026-03-02', count: 8 },
          { date: '2026-03-03', count: 3 },
        ]},
        // topOperators
        { rows: [
          { operator_id: 'op-1', name: 'Alice', dialogs_closed: 15, pql_converted: 3 },
          { operator_id: 'op-2', name: 'Bob', dialogs_closed: 10, pql_converted: 2 },
        ]},
      ])

      const service = new AnalyticsService(mockPool)
      const metrics = await service.getDashboardMetrics(tenantId, '30d')

      expect(metrics.totalDialogs).toBe(120)
      expect(metrics.pqlDetectedCount).toBe(24)
      expect(metrics.pqlRate).toBe(20) // 24/120 * 100
      expect(metrics.avgResponseTimeMs).toBe(45000)
      expect(metrics.pqlConversionRate).toBe(25) // 6/24 * 100
      expect(metrics.dialogsByChannel).toEqual({
        WEB_CHAT: 80,
        TELEGRAM: 30,
        VK_MAX: 10,
      })
      expect(metrics.pqlByTier).toEqual({
        HOT: 5,
        WARM: 12,
        COLD: 7,
      })
      expect(metrics.dailyDialogCounts).toHaveLength(3)
      expect(metrics.dailyDialogCounts[0]).toEqual({ date: '2026-03-01', count: 5 })
      expect(metrics.topOperators).toHaveLength(2)
      expect(metrics.topOperators[0].name).toBe('Alice')
    })

    it('should handle empty data gracefully', async () => {
      const mockPool = createMockPool([
        { rows: [{ total: 0 }] },      // totalDialogs
        { rows: [{ total: 0 }] },      // pqlDetectedCount
        { rows: [{ avg_ms: null }] },   // avgResponseTime
        { rows: [{ converted: 0 }] },   // conversion
        { rows: [] },                    // dialogsByChannel
        { rows: [] },                    // pqlByTier
        { rows: [] },                    // dailyDialogCounts
        { rows: [] },                    // topOperators
      ])

      const service = new AnalyticsService(mockPool)
      const metrics = await service.getDashboardMetrics(tenantId, '7d')

      expect(metrics.totalDialogs).toBe(0)
      expect(metrics.pqlDetectedCount).toBe(0)
      expect(metrics.pqlRate).toBe(0)
      expect(metrics.avgResponseTimeMs).toBeNull()
      expect(metrics.pqlConversionRate).toBe(0)
      expect(metrics.dialogsByChannel).toEqual({
        WEB_CHAT: 0,
        TELEGRAM: 0,
        VK_MAX: 0,
      })
      expect(metrics.pqlByTier).toEqual({
        HOT: 0,
        WARM: 0,
        COLD: 0,
      })
      expect(metrics.dailyDialogCounts).toEqual([])
      expect(metrics.topOperators).toEqual([])
    })

    it('should calculate PQL rate correctly with fractional values', async () => {
      const mockPool = createMockPool([
        { rows: [{ total: 7 }] },       // totalDialogs
        { rows: [{ total: 3 }] },       // pqlDetectedCount
        { rows: [{ avg_ms: null }] },
        { rows: [{ converted: 1 }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      ])

      const service = new AnalyticsService(mockPool)
      const metrics = await service.getDashboardMetrics(tenantId, '30d')

      // 3/7 * 100 = 42.857... rounded to 42.86
      expect(metrics.pqlRate).toBe(42.86)
      // 1/3 * 100 = 33.333... rounded to 33.33
      expect(metrics.pqlConversionRate).toBe(33.33)
    })

    it('should pass correct period interval to queries', async () => {
      const mockPool = createMockPool([
        { rows: [{ total: 0 }] },
        { rows: [{ total: 0 }] },
        { rows: [{ avg_ms: null }] },
        { rows: [{ converted: 0 }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      ])

      const service = new AnalyticsService(mockPool)
      await service.getDashboardMetrics(tenantId, '90d')

      // Verify tenantId was passed to queries
      expect(mockPool.query).toHaveBeenCalledTimes(8)
      const firstCall = (mockPool.query as jest.Mock).mock.calls[0]
      expect(firstCall[1]).toEqual([tenantId])
      // Verify 90 days interval is in the SQL
      expect(firstCall[0]).toContain('90 days')
    })

    it('should default channel counts to zero for missing channels', async () => {
      const mockPool = createMockPool([
        { rows: [{ total: 5 }] },
        { rows: [{ total: 0 }] },
        { rows: [{ avg_ms: null }] },
        { rows: [{ converted: 0 }] },
        // Only WEB_CHAT returned from DB
        { rows: [{ channel_type: 'WEB_CHAT', count: 5 }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      ])

      const service = new AnalyticsService(mockPool)
      const metrics = await service.getDashboardMetrics(tenantId, '30d')

      expect(metrics.dialogsByChannel.WEB_CHAT).toBe(5)
      expect(metrics.dialogsByChannel.TELEGRAM).toBe(0)
      expect(metrics.dialogsByChannel.VK_MAX).toBe(0)
    })
  })

  describe('getDialogsByChannel', () => {
    it('should return channel distribution', async () => {
      const mockPool = createMockPool([
        { rows: [
          { channel_type: 'WEB_CHAT', count: 50 },
          { channel_type: 'TELEGRAM', count: 20 },
        ]},
      ])

      const service = new AnalyticsService(mockPool)
      const result = await service.getDialogsByChannel(tenantId)

      expect(result).toEqual({
        WEB_CHAT: 50,
        TELEGRAM: 20,
        VK_MAX: 0,
      })
    })
  })

  describe('getPQLByTier', () => {
    it('should return tier distribution', async () => {
      const mockPool = createMockPool([
        { rows: [
          { pql_tier: 'HOT', count: 10 },
          { pql_tier: 'WARM', count: 25 },
          { pql_tier: 'COLD', count: 15 },
        ]},
      ])

      const service = new AnalyticsService(mockPool)
      const result = await service.getPQLByTier(tenantId)

      expect(result).toEqual({
        HOT: 10,
        WARM: 25,
        COLD: 15,
      })
    })
  })

  describe('getDailyTrend', () => {
    it('should return daily counts', async () => {
      const mockPool = createMockPool([
        { rows: [
          { date: '2026-03-01', count: 5 },
          { date: '2026-03-02', count: 10 },
        ]},
      ])

      const service = new AnalyticsService(mockPool)
      const result = await service.getDailyTrend(tenantId, 7)

      expect(result).toEqual([
        { date: '2026-03-01', count: 5 },
        { date: '2026-03-02', count: 10 },
      ])
      // Check days parameter is in the SQL
      const query = (mockPool.query as jest.Mock).mock.calls[0][0]
      expect(query).toContain('7 days')
    })
  })
})
