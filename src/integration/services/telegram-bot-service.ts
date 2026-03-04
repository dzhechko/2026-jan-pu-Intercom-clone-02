/**
 * Telegram Bot API Service — FR-05 Telegram Channel
 *
 * Thin HTTP client for Telegram Bot API with Circuit Breaker (FF-04).
 * Uses native fetch (Node 18+) + opossum circuit breaker.
 *
 * Bot token sourced from TELEGRAM_BOT_TOKEN env var.
 * MUST be instantiated as a singleton at server startup — never per-request.
 */
import CircuitBreaker from 'opossum'

const TELEGRAM_API_BASE = 'https://api.telegram.org'

const CIRCUIT_BREAKER_OPTIONS = {
  timeout: 3000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
}

export interface TelegramSendResult {
  ok: boolean
  result?: {
    message_id: number
    chat: { id: number }
    text?: string
  }
  description?: string
}

export interface TelegramBotInfo {
  ok: boolean
  result?: {
    id: number
    is_bot: boolean
    first_name: string
    username: string
  }
  description?: string
}

export interface TelegramWebhookResult {
  ok: boolean
  result?: boolean
  description?: string
}

export class TelegramBotService {
  private readonly apiBase: string
  private readonly sendBreaker: CircuitBreaker
  private readonly adminBreaker: CircuitBreaker

  constructor(private readonly botToken: string) {
    this.apiBase = `${TELEGRAM_API_BASE}/bot${botToken}`

    this.sendBreaker = new CircuitBreaker(
      this._sendMessage.bind(this),
      CIRCUIT_BREAKER_OPTIONS,
    )

    this.adminBreaker = new CircuitBreaker(
      async (url: string, options?: RequestInit) => {
        const response = await fetch(url, options)
        return response.json()
      },
      CIRCUIT_BREAKER_OPTIONS,
    )

    this.sendBreaker.on('open', () => {
      console.warn('[telegram-bot-service] Circuit breaker OPEN — Telegram API unavailable')
    })
    this.sendBreaker.on('halfOpen', () => {
      console.info('[telegram-bot-service] Circuit breaker HALF-OPEN — testing Telegram API')
    })
    this.sendBreaker.on('close', () => {
      console.info('[telegram-bot-service] Circuit breaker CLOSED — Telegram API recovered')
    })

    this.adminBreaker.on('open', () => {
      console.warn('[telegram-bot-service] Admin circuit breaker OPEN — Telegram API unavailable')
    })
    this.adminBreaker.on('halfOpen', () => {
      console.info('[telegram-bot-service] Admin circuit breaker HALF-OPEN — testing Telegram API')
    })
    this.adminBreaker.on('close', () => {
      console.info('[telegram-bot-service] Admin circuit breaker CLOSED — Telegram API recovered')
    })
  }

  /**
   * Resolve bot token: use explicit token or fall back to env var.
   */
  static fromEnv(): TelegramBotService | null {
    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token) return null
    return new TelegramBotService(token)
  }

  /**
   * Send a text message to a Telegram chat (via circuit breaker).
   */
  async sendMessage(chatId: string | number, text: string): Promise<TelegramSendResult> {
    return this.sendBreaker.fire(chatId, text) as Promise<TelegramSendResult>
  }

  /**
   * Internal send — called through circuit breaker.
   */
  private async _sendMessage(chatId: string | number, text: string): Promise<TelegramSendResult> {
    const response = await fetch(`${this.apiBase}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    })
    return response.json() as Promise<TelegramSendResult>
  }

  /**
   * Register a webhook URL with Telegram Bot API (via admin circuit breaker).
   */
  async setWebhook(url: string): Promise<TelegramWebhookResult> {
    return this.adminBreaker.fire(`${this.apiBase}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }) as Promise<TelegramWebhookResult>
  }

  /**
   * Verify bot connection — returns bot info (via admin circuit breaker).
   */
  async getMe(): Promise<TelegramBotInfo> {
    return this.adminBreaker.fire(`${this.apiBase}/getMe`) as Promise<TelegramBotInfo>
  }

  /**
   * Check if the circuit breaker is currently open (service degraded).
   */
  isCircuitOpen(): boolean {
    return this.sendBreaker.opened
  }
}
