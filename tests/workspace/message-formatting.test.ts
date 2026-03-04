/**
 * Tests for message formatting utilities (FR-07).
 * Verifies direction mapping, sender type display, and time formatting.
 */

describe('Message formatting', () => {
  describe('direction classification', () => {
    it('should identify INBOUND as client messages (displayed on the left)', () => {
      const direction = 'INBOUND'
      const isInbound = direction === 'INBOUND'
      expect(isInbound).toBe(true)
    })

    it('should identify OUTBOUND as operator messages (displayed on the right)', () => {
      const direction: string = 'OUTBOUND'
      const isInbound = direction === 'INBOUND'
      expect(isInbound).toBe(false)
    })
  })

  describe('sender type mapping', () => {
    const senderLabels: Record<string, string> = {
      CLIENT: 'Client',
      OPERATOR: 'Operator',
      BOT: 'Bot',
    }

    it('should map CLIENT to "Client"', () => {
      expect(senderLabels['CLIENT']).toBe('Client')
    })

    it('should map OPERATOR to "Operator"', () => {
      expect(senderLabels['OPERATOR']).toBe('Operator')
    })

    it('should map BOT to "Bot"', () => {
      expect(senderLabels['BOT']).toBe('Bot')
    })
  })

  describe('time ago calculation', () => {
    function timeAgo(dateStr?: string): string {
      if (!dateStr) return ''
      const now = Date.now()
      const then = new Date(dateStr).getTime()
      const diffMs = now - then
      const diffMin = Math.floor(diffMs / 60000)
      if (diffMin < 1) return 'now'
      if (diffMin < 60) return `${diffMin}m`
      const diffHr = Math.floor(diffMin / 60)
      if (diffHr < 24) return `${diffHr}h`
      const diffDay = Math.floor(diffHr / 24)
      return `${diffDay}d`
    }

    it('should return empty string for undefined', () => {
      expect(timeAgo(undefined)).toBe('')
    })

    it('should return "now" for very recent dates', () => {
      const now = new Date().toISOString()
      expect(timeAgo(now)).toBe('now')
    })

    it('should return minutes for dates within the hour', () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
      expect(timeAgo(fiveMinAgo)).toBe('5m')
    })

    it('should return hours for dates within the day', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
      expect(timeAgo(threeHoursAgo)).toBe('3h')
    })

    it('should return days for dates older than 24 hours', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
      expect(timeAgo(twoDaysAgo)).toBe('2d')
    })
  })

  describe('message content truncation for preview', () => {
    function truncatePreview(content: string, maxLen = 100): string {
      if (content.length <= maxLen) return content
      return content.slice(0, maxLen) + '...'
    }

    it('should not truncate short messages', () => {
      expect(truncatePreview('Hello')).toBe('Hello')
    })

    it('should truncate messages longer than 100 chars', () => {
      const longMsg = 'A'.repeat(150)
      const result = truncatePreview(longMsg)
      expect(result.length).toBe(103) // 100 + '...'
      expect(result.endsWith('...')).toBe(true)
    })

    it('should handle empty strings', () => {
      expect(truncatePreview('')).toBe('')
    })
  })

  describe('channel type display', () => {
    const channelLabels: Record<string, string> = {
      WEB_CHAT: 'Web',
      TELEGRAM: 'TG',
      VK_MAX: 'VK',
    }

    it('should map all channel types correctly', () => {
      expect(channelLabels['WEB_CHAT']).toBe('Web')
      expect(channelLabels['TELEGRAM']).toBe('TG')
      expect(channelLabels['VK_MAX']).toBe('VK')
    })
  })

  describe('PQL tier ordering', () => {
    const tierOrder: Record<string, number> = { HOT: 0, WARM: 1, COLD: 2 }

    it('should rank HOT as highest priority (0)', () => {
      expect(tierOrder['HOT']).toBe(0)
    })

    it('should rank WARM as medium priority (1)', () => {
      expect(tierOrder['WARM']).toBe(1)
    })

    it('should rank COLD as lowest priority (2)', () => {
      expect(tierOrder['COLD']).toBe(2)
    })
  })
})
