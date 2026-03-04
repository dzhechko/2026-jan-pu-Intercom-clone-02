/**
 * Telegram Bot API Service — FR-05 Telegram Channel
 *
 * Thin HTTP client for Telegram Bot API.
 * Uses native fetch (Node 18+), no external dependencies.
 *
 * Bot token sourced from TELEGRAM_BOT_TOKEN env var.
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org'

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

  constructor(private readonly botToken: string) {
    this.apiBase = `${TELEGRAM_API_BASE}/bot${botToken}`
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
   * Send a text message to a Telegram chat.
   */
  async sendMessage(chatId: string | number, text: string): Promise<TelegramSendResult> {
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
   * Register a webhook URL with Telegram Bot API.
   */
  async setWebhook(url: string): Promise<TelegramWebhookResult> {
    const response = await fetch(`${this.apiBase}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    return response.json() as Promise<TelegramWebhookResult>
  }

  /**
   * Verify bot connection — returns bot info.
   */
  async getMe(): Promise<TelegramBotInfo> {
    const response = await fetch(`${this.apiBase}/getMe`)
    return response.json() as Promise<TelegramBotInfo>
  }
}
