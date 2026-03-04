/**
 * Unit tests for MemoryAIService (FR-03: Memory AI).
 * Tests fetchContext with mocked CRM adapter, caching, graceful degradation.
 */
import { MemoryAIService } from './memory-ai-service'
import { CRMPort, CRMContactContext, CRMResult, ContactContext, CRMDeal } from '@pql/domain/ports/crm-port'
import { Result, ok } from '@shared/types/result'

// ── Mock CRM Port ────────────────────────────────────────────────────────────

function createMockCRMPort(overrides?: {
  enrichedResult?: CRMResult<CRMContactContext>
}): CRMPort {
  return {
    getContactContext: jest.fn().mockResolvedValue(ok({
      contacts: [],
      deals: [],
      lastActivityDate: null,
      currentPlan: null,
      accountAge: null,
    })),
    getContactContextEnriched: jest.fn().mockResolvedValue(
      overrides?.enrichedResult ?? CRMResult.ok({
        contactEmail: 'alice@acme.com',
        contactName: 'Alice Johnson',
        currentPlan: 'Professional',
        accountAge: 180,
        deals: [
          { id: 'deal-1', title: 'Annual Subscription', value: 12000, status: 'WON', closedAt: '2025-12-01T00:00:00Z' },
          { id: 'deal-2', title: 'Add-on Package', value: 2400, status: 'OPEN' },
        ],
        previousDialogCount: 5,
        tags: ['enterprise', 'high-value'],
        enrichmentScore: 0.85,
      } satisfies CRMContactContext),
    ),
    createDeal: jest.fn().mockResolvedValue(ok({ dealId: 'new-deal-1' })),
    findDealByDialogContext: jest.fn().mockResolvedValue(ok(null)),
  }
}

// ── Mock Redis ───────────────────────────────────────────────────────────────

function createMockRedis(cache: Map<string, string> = new Map()) {
  return {
    get: jest.fn().mockImplementation(async (key: string) => cache.get(key) ?? null),
    set: jest.fn().mockImplementation(async (key: string, value: string) => {
      cache.set(key, value)
      return 'OK'
    }),
    del: jest.fn().mockImplementation(async (key: string) => {
      cache.delete(key)
      return 1
    }),
  } as any
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MemoryAIService', () => {
  const TENANT_ID = 'tenant-123'
  const CONTACT_EMAIL = 'alice@acme.com'

  describe('fetchContext()', () => {
    it('returns enriched CRM context from adapter', async () => {
      const crmPort = createMockCRMPort()
      const redis = createMockRedis()
      const service = new MemoryAIService(crmPort, redis)

      const result = await service.fetchContext(CONTACT_EMAIL, TENANT_ID)

      expect(result.status).toBe('ok')
      if (result.status !== 'ok') throw new Error('Expected ok')
      expect(result.data.contactEmail).toBe('alice@acme.com')
      expect(result.data.contactName).toBe('Alice Johnson')
      expect(result.data.currentPlan).toBe('Professional')
      expect(result.data.deals).toHaveLength(2)
      expect(result.data.enrichmentScore).toBe(0.85)
      expect(crmPort.getContactContextEnriched).toHaveBeenCalledWith(CONTACT_EMAIL, TENANT_ID)
    })

    it('returns empty context with enrichmentScore 0 for empty email', async () => {
      const crmPort = createMockCRMPort()
      const redis = createMockRedis()
      const service = new MemoryAIService(crmPort, redis)

      const result = await service.fetchContext('', TENANT_ID)

      expect(result.status).toBe('ok')
      if (result.status !== 'ok') throw new Error('Expected ok')
      expect(result.data.enrichmentScore).toBe(0)
      expect(result.data.deals).toHaveLength(0)
      expect(crmPort.getContactContextEnriched).not.toHaveBeenCalled()
    })

    it('passes through not_configured status from CRM', async () => {
      const crmPort = createMockCRMPort({
        enrichedResult: CRMResult.notConfigured(),
      })
      const redis = createMockRedis()
      const service = new MemoryAIService(crmPort, redis)

      const result = await service.fetchContext(CONTACT_EMAIL, TENANT_ID)

      expect(result.status).toBe('not_configured')
    })
  })

  describe('caching behavior', () => {
    it('caches result in Redis after successful fetch', async () => {
      const crmPort = createMockCRMPort()
      const redis = createMockRedis()
      const service = new MemoryAIService(crmPort, redis)

      await service.fetchContext(CONTACT_EMAIL, TENANT_ID)

      expect(redis.set).toHaveBeenCalledTimes(1)
      const setCall = redis.set.mock.calls[0]
      expect(setCall[0]).toContain(TENANT_ID)
      expect(setCall[0]).toContain(CONTACT_EMAIL)
      expect(setCall[2]).toBe('EX')
      expect(setCall[3]).toBe(300) // 5 min TTL
    })

    it('returns cached result on second call without hitting CRM', async () => {
      const crmPort = createMockCRMPort()
      const cache = new Map<string, string>()
      const redis = createMockRedis(cache)
      const service = new MemoryAIService(crmPort, redis)

      // First call — fetches from CRM and caches
      await service.fetchContext(CONTACT_EMAIL, TENANT_ID)
      expect(crmPort.getContactContextEnriched).toHaveBeenCalledTimes(1)

      // Second call — returns from cache
      const result = await service.fetchContext(CONTACT_EMAIL, TENANT_ID)
      expect(crmPort.getContactContextEnriched).toHaveBeenCalledTimes(1) // NOT called again
      expect(result.status).toBe('ok')
      if (result.status !== 'ok') throw new Error('Expected ok')
      expect(result.data.contactName).toBe('Alice Johnson')
    })

    it('invalidateCache() removes cached entry', async () => {
      const crmPort = createMockCRMPort()
      const cache = new Map<string, string>()
      const redis = createMockRedis(cache)
      const service = new MemoryAIService(crmPort, redis)

      // Cache a result
      await service.fetchContext(CONTACT_EMAIL, TENANT_ID)
      expect(cache.size).toBe(1)

      // Invalidate
      await service.invalidateCache(CONTACT_EMAIL, TENANT_ID)
      expect(redis.del).toHaveBeenCalledTimes(1)
    })

    it('works without Redis (null)', async () => {
      const crmPort = createMockCRMPort()
      const service = new MemoryAIService(crmPort, null)

      const result = await service.fetchContext(CONTACT_EMAIL, TENANT_ID)

      expect(result.status).toBe('ok')
      if (result.status !== 'ok') throw new Error('Expected ok')
      expect(result.data.contactName).toBe('Alice Johnson')
      // Called every time since no cache
      await service.fetchContext(CONTACT_EMAIL, TENANT_ID)
      expect(crmPort.getContactContextEnriched).toHaveBeenCalledTimes(2)
    })
  })

  describe('graceful degradation', () => {
    it('returns empty context when CRM adapter throws', async () => {
      const crmPort = createMockCRMPort()
      ;(crmPort.getContactContextEnriched as jest.Mock).mockRejectedValue(
        new Error('Connection refused'),
      )
      const redis = createMockRedis()
      const service = new MemoryAIService(crmPort, redis)

      const result = await service.fetchContext(CONTACT_EMAIL, TENANT_ID)

      expect(result.status).toBe('ok')
      if (result.status !== 'ok') throw new Error('Expected ok')
      expect(result.data.enrichmentScore).toBe(0)
      expect(result.data.deals).toHaveLength(0)
      expect(result.data.contactEmail).toBe(CONTACT_EMAIL)
    })

    it('returns empty context when CRM returns error status', async () => {
      const crmPort = createMockCRMPort({
        enrichedResult: CRMResult.error('Rate limit exceeded'),
      })
      const redis = createMockRedis()
      const service = new MemoryAIService(crmPort, redis)

      const result = await service.fetchContext(CONTACT_EMAIL, TENANT_ID)

      expect(result.status).toBe('ok')
      if (result.status !== 'ok') throw new Error('Expected ok')
      expect(result.data.enrichmentScore).toBe(0)
    })
  })

  describe('enrichment score', () => {
    it('returns 0 enrichmentScore for empty context', async () => {
      const crmPort = createMockCRMPort()
      const redis = createMockRedis()
      const service = new MemoryAIService(crmPort, redis)

      const result = await service.fetchContext('', TENANT_ID)

      expect(result.status).toBe('ok')
      if (result.status !== 'ok') throw new Error('Expected ok')
      expect(result.data.enrichmentScore).toBe(0)
    })

    it('returns high enrichmentScore when CRM provides full data', async () => {
      const crmPort = createMockCRMPort()
      const redis = createMockRedis()
      const service = new MemoryAIService(crmPort, redis)

      const result = await service.fetchContext(CONTACT_EMAIL, TENANT_ID)

      expect(result.status).toBe('ok')
      if (result.status !== 'ok') throw new Error('Expected ok')
      expect(result.data.enrichmentScore).toBeGreaterThan(0.5)
    })
  })
})
