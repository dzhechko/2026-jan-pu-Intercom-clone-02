/**
 * Memory AI Service — FR-03: Auto-load customer context from CRM before operator responds.
 * Reference: docs/pseudocode.md PS-06, docs/refinement.md FR-03
 *
 * Uses hexagonal architecture: depends on CRMPort interface, not concrete adapter.
 * Caches results in Redis (TTL 5 min) to avoid hammering CRM.
 * Graceful degradation: if CRM unavailable, returns empty context with low enrichmentScore.
 */
import Redis from 'ioredis'
import { CRMPort, CRMContactContext, CRMResult } from '@pql/domain/ports/crm-port'

const CACHE_TTL_SECONDS = 300 // 5 minutes
const CACHE_PREFIX = 'memory-ai:context:'

export class MemoryAIService {
  constructor(
    private readonly crmPort: CRMPort,
    private readonly redis: Redis | null,
  ) {}

  /**
   * Fetch enriched CRM context for a contact.
   * 1. Check Redis cache
   * 2. Call CRM port (adapter pattern)
   * 3. Cache successful result
   * 4. Graceful degradation on failure
   */
  async fetchContext(contactEmail: string, tenantId: string): Promise<CRMResult<CRMContactContext>> {
    if (!contactEmail) {
      return CRMResult.ok(this.emptyContext(contactEmail))
    }

    // 1. Check cache
    const cached = await this.getFromCache(contactEmail, tenantId)
    if (cached) {
      return CRMResult.ok(cached)
    }

    // 2. Call CRM port
    try {
      const result = await this.crmPort.getContactContextEnriched(contactEmail, tenantId)

      if (result.status === 'ok') {
        // 3. Cache the result
        await this.setInCache(contactEmail, tenantId, result.data)
        return result
      }

      if (result.status === 'not_configured') {
        return result
      }

      // CRM error — graceful degradation
      return CRMResult.ok(this.emptyContext(contactEmail))
    } catch {
      // Unexpected error — graceful degradation
      return CRMResult.ok(this.emptyContext(contactEmail))
    }
  }

  /**
   * Invalidate cached context for a contact (e.g., after CRM update).
   */
  async invalidateCache(contactEmail: string, tenantId: string): Promise<void> {
    if (!this.redis) return
    const key = this.cacheKey(contactEmail, tenantId)
    await this.redis.del(key).catch(() => { /* ignore redis errors */ })
  }

  /**
   * Empty context with low enrichment score — returned when CRM is unavailable.
   */
  private emptyContext(contactEmail: string): CRMContactContext {
    return {
      contactEmail,
      deals: [],
      previousDialogCount: 0,
      tags: [],
      enrichmentScore: 0,
    }
  }

  private cacheKey(contactEmail: string, tenantId: string): string {
    return `${CACHE_PREFIX}${tenantId}:${contactEmail.toLowerCase()}`
  }

  private async getFromCache(contactEmail: string, tenantId: string): Promise<CRMContactContext | null> {
    if (!this.redis) return null
    try {
      const raw = await this.redis.get(this.cacheKey(contactEmail, tenantId))
      if (!raw) return null
      return JSON.parse(raw) as CRMContactContext
    } catch {
      return null
    }
  }

  private async setInCache(contactEmail: string, tenantId: string, context: CRMContactContext): Promise<void> {
    if (!this.redis) return
    try {
      const key = this.cacheKey(contactEmail, tenantId)
      await this.redis.set(key, JSON.stringify(context), 'EX', CACHE_TTL_SECONDS)
    } catch {
      // Cache write failure is non-critical — log and continue
    }
  }
}
