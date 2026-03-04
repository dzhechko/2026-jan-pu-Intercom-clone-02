/**
 * Operator Presence Service — FR-13 Multi-operator
 * Tracks online/offline operator status via Redis SETs per tenant.
 * Key pattern: presence:{tenantId} → SET of operatorIds
 */
import Redis from 'ioredis'

export class PresenceService {
  constructor(private readonly redis: Redis) {}

  /**
   * Mark an operator as online within their tenant.
   */
  async setOnline(operatorId: string, tenantId: string): Promise<void> {
    try {
      await this.redis.sadd(`presence:${tenantId}`, operatorId)
    } catch (err) {
      console.error('[presence] setOnline error', err)
    }
  }

  /**
   * Mark an operator as offline. Removes from all tenant presence sets.
   * Since we know tenantId at disconnect time, we remove directly.
   */
  async setOffline(operatorId: string, tenantId?: string): Promise<void> {
    try {
      if (tenantId) {
        await this.redis.srem(`presence:${tenantId}`, operatorId)
      }
    } catch (err) {
      console.error('[presence] setOffline error', err)
    }
  }

  /**
   * Get all online operator IDs for a tenant.
   */
  async getOnlineOperators(tenantId: string): Promise<string[]> {
    try {
      return await this.redis.smembers(`presence:${tenantId}`)
    } catch (err) {
      console.error('[presence] getOnlineOperators error', err)
      return []
    }
  }

  /**
   * Check if a specific operator is online.
   */
  async isOnline(operatorId: string, tenantId: string): Promise<boolean> {
    try {
      const result = await this.redis.sismember(`presence:${tenantId}`, operatorId)
      return result === 1
    } catch (err) {
      console.error('[presence] isOnline error', err)
      return false
    }
  }
}
