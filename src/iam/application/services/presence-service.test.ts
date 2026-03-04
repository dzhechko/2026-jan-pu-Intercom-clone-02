import Redis from 'ioredis'
import { PresenceService } from './presence-service'

const mockRedis = {
  sadd: jest.fn(),
  srem: jest.fn(),
  smembers: jest.fn(),
  sismember: jest.fn(),
} as unknown as Redis

describe('PresenceService', () => {
  let service: PresenceService

  beforeEach(() => {
    jest.clearAllMocks()
    service = new PresenceService(mockRedis)
  })

  describe('setOnline', () => {
    it('calls redis.sadd with correct key and operatorId', async () => {
      ;(mockRedis.sadd as jest.Mock).mockResolvedValue(1)

      await service.setOnline('op-1', 'tenant-abc')

      expect(mockRedis.sadd).toHaveBeenCalledWith('presence:tenant-abc', 'op-1')
      expect(mockRedis.sadd).toHaveBeenCalledTimes(1)
    })

    it('does not throw on Redis failure, returns void', async () => {
      ;(mockRedis.sadd as jest.Mock).mockRejectedValue(new Error('connection lost'))

      await expect(service.setOnline('op-1', 'tenant-abc')).resolves.toBeUndefined()
    })
  })

  describe('setOffline', () => {
    it('calls redis.srem with correct key and operatorId', async () => {
      ;(mockRedis.srem as jest.Mock).mockResolvedValue(1)

      await service.setOffline('op-1', 'tenant-abc')

      expect(mockRedis.srem).toHaveBeenCalledWith('presence:tenant-abc', 'op-1')
      expect(mockRedis.srem).toHaveBeenCalledTimes(1)
    })

    it('does nothing when tenantId is undefined', async () => {
      await service.setOffline('op-1')

      expect(mockRedis.srem).not.toHaveBeenCalled()
    })

    it('does not throw on Redis failure, returns void', async () => {
      ;(mockRedis.srem as jest.Mock).mockRejectedValue(new Error('connection lost'))

      await expect(service.setOffline('op-1', 'tenant-abc')).resolves.toBeUndefined()
    })
  })

  describe('getOnlineOperators', () => {
    it('returns array of operator IDs from redis.smembers', async () => {
      ;(mockRedis.smembers as jest.Mock).mockResolvedValue(['op-1', 'op-2', 'op-3'])

      const result = await service.getOnlineOperators('tenant-abc')

      expect(mockRedis.smembers).toHaveBeenCalledWith('presence:tenant-abc')
      expect(result).toEqual(['op-1', 'op-2', 'op-3'])
    })

    it('returns empty array when no operators are online', async () => {
      ;(mockRedis.smembers as jest.Mock).mockResolvedValue([])

      const result = await service.getOnlineOperators('tenant-abc')

      expect(result).toEqual([])
    })

    it('returns empty array on Redis failure', async () => {
      ;(mockRedis.smembers as jest.Mock).mockRejectedValue(new Error('connection lost'))

      const result = await service.getOnlineOperators('tenant-abc')

      expect(result).toEqual([])
    })
  })

  describe('isOnline', () => {
    it('returns true when sismember returns 1', async () => {
      ;(mockRedis.sismember as jest.Mock).mockResolvedValue(1)

      const result = await service.isOnline('op-1', 'tenant-abc')

      expect(mockRedis.sismember).toHaveBeenCalledWith('presence:tenant-abc', 'op-1')
      expect(result).toBe(true)
    })

    it('returns false when sismember returns 0', async () => {
      ;(mockRedis.sismember as jest.Mock).mockResolvedValue(0)

      const result = await service.isOnline('op-1', 'tenant-abc')

      expect(result).toBe(false)
    })

    it('returns false on Redis failure', async () => {
      ;(mockRedis.sismember as jest.Mock).mockRejectedValue(new Error('connection lost'))

      const result = await service.isOnline('op-1', 'tenant-abc')

      expect(result).toBe(false)
    })
  })
})
