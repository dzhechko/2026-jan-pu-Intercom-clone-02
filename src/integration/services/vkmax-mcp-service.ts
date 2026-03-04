/**
 * VK Max / Messenger Max MCP Service — FR-09 VK Max Channel
 *
 * Wraps Cloud.ru Messenger Max MCP API calls.
 * Uses opossum circuit breaker (ACL + circuit breaker rule).
 * Currently a mock implementation — real MCP integration to follow.
 *
 * Env vars:
 *   VKMAX_MCP_URL      — MCP endpoint URL
 *   VKMAX_ACCESS_TOKEN — Bot access token
 */
import CircuitBreaker from 'opossum'

export interface VKMaxSendResult {
  ok: boolean
  messageId?: number
  description?: string
}

export interface VKMaxBotInfo {
  ok: boolean
  result?: {
    id: number
    name: string
    groupId: number
  }
  description?: string
}

export interface VKMaxWebhookResult {
  ok: boolean
  result?: boolean
  description?: string
}

const CIRCUIT_BREAKER_OPTIONS = {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
}

export class VKMaxMCPService {
  private readonly sendBreaker: CircuitBreaker

  constructor(
    private readonly mcpUrl: string,
    private readonly accessToken: string,
  ) {
    // Wrap sendMessage in circuit breaker
    this.sendBreaker = new CircuitBreaker(
      this._sendMessage.bind(this),
      CIRCUIT_BREAKER_OPTIONS,
    )

    this.sendBreaker.on('open', () => {
      console.warn('[vkmax-mcp-service] Circuit breaker OPEN — VK Max API unavailable')
    })

    this.sendBreaker.on('halfOpen', () => {
      console.info('[vkmax-mcp-service] Circuit breaker HALF-OPEN — testing VK Max API')
    })

    this.sendBreaker.on('close', () => {
      console.info('[vkmax-mcp-service] Circuit breaker CLOSED — VK Max API recovered')
    })
  }

  /**
   * Resolve service from env vars. Returns null if not configured.
   */
  static fromEnv(): VKMaxMCPService | null {
    const mcpUrl = process.env.VKMAX_MCP_URL
    const accessToken = process.env.VKMAX_ACCESS_TOKEN
    if (!mcpUrl || !accessToken) return null
    return new VKMaxMCPService(mcpUrl, accessToken)
  }

  /**
   * Send a text message to a VK Max peer (via circuit breaker).
   */
  async sendMessage(peerId: string | number, text: string): Promise<VKMaxSendResult> {
    return this.sendBreaker.fire(peerId, text) as Promise<VKMaxSendResult>
  }

  /**
   * Internal send — called through circuit breaker.
   * TODO: Replace mock with real MCP API call.
   */
  private async _sendMessage(peerId: string | number, text: string): Promise<VKMaxSendResult> {
    if (!this.mcpUrl) {
      // Mock implementation — log and return success
      console.info(`[vkmax-mcp-service] MOCK sendMessage to peer ${peerId}: ${text.slice(0, 80)}`)
      return { ok: true, messageId: Date.now() }
    }

    const response = await fetch(`${this.mcpUrl}/messages.send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({
        peer_id: peerId,
        message: text,
        random_id: Date.now(),
      }),
    })
    return response.json() as Promise<VKMaxSendResult>
  }

  /**
   * Register a webhook (callback server) URL with VK Max.
   * TODO: Replace mock with real MCP API call.
   */
  async setWebhook(url: string): Promise<VKMaxWebhookResult> {
    if (!this.mcpUrl) {
      console.info(`[vkmax-mcp-service] MOCK setWebhook: ${url}`)
      return { ok: true, result: true }
    }

    const response = await fetch(`${this.mcpUrl}/groups.setCallbackServer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({ url }),
    })
    return response.json() as Promise<VKMaxWebhookResult>
  }

  /**
   * Check connection status / bot info.
   * TODO: Replace mock with real MCP API call.
   */
  async getStatus(): Promise<VKMaxBotInfo> {
    if (!this.mcpUrl) {
      return {
        ok: true,
        result: { id: 0, name: 'VK Max Bot (mock)', groupId: 0 },
      }
    }

    const response = await fetch(`${this.mcpUrl}/groups.getById`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    })
    return response.json() as Promise<VKMaxBotInfo>
  }

  /**
   * Check if the circuit breaker is currently open (service degraded).
   */
  isCircuitOpen(): boolean {
    return this.sendBreaker.opened
  }
}
