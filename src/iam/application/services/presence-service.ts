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
    await this.redis.sadd(`presence:${tenantId}`, operatorId)
  }

  /**
   * Mark an operator as offline. Removes from all tenant presence sets.
   * Since we know tenantId at disconnect time, we remove directly.
   */
  async setOffline(operatorId: string, tenantId?: string): Promise<void> {
    if (tenantId) {
      await this.redis.srem(`presence:${tenantId}`, operatorId)
    }
  }

  /**
   * Get all online operator IDs for a tenant.
   */
  async getOnlineOperators(tenantId: string): Promise<string[]> {
    return this.redis.smembers(`presence:${tenantId}`)
  }

  /**
   * Check if a specific operator is online.
   */
  async isOnline(operatorId: string, tenantId: string): Promise<boolean> {
    const result = await this.redis.sismember(`presence:${tenantId}`, operatorId)
    return result === 1
  }
}
