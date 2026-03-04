/**
 * Telegram Bot Adapter — FR-05 Telegram Channel
 *
 * Processes incoming Telegram webhook updates:
 *   1. Parses Telegram Update objects (message, callback_query)
 *   2. Creates or finds existing dialog (channelType=TELEGRAM)
 *   3. Persists inbound message
 *   4. Broadcasts to operator workspace via Socket.io
 *
 * Outbound: sendReply() forwards operator messages to Telegram via Bot API.
 */
import { Pool } from 'pg'
import { Server as SocketIOServer } from 'socket.io'
import { DialogRepository } from '@conversation/infrastructure/repositories/dialog-repository'
import { MessageRepository } from '@conversation/infrastructure/repositories/message-repository'
import { TelegramBotService } from '@integration/services/telegram-bot-service'

// ─── Telegram types (subset) ─────────────────────────────────────────────────

export interface TelegramUser {
  id: number
  is_bot?: boolean
  first_name: string
  last_name?: string
  username?: string
}

export interface TelegramChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
  first_name?: string
  username?: string
}

export interface TelegramMessage {
  message_id: number
  from?: TelegramUser
  chat: TelegramChat
  date: number
  text?: string
}

export interface TelegramCallbackQuery {
  id: string
  from: TelegramUser
  message?: TelegramMessage
  data?: string
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class TelegramAdapter {
  private readonly dialogRepo: DialogRepository
  private readonly messageRepo: MessageRepository

  constructor(
    private readonly pool: Pool,
    private readonly io: SocketIOServer,
    private readonly botService: TelegramBotService,
    private readonly tenantId: string,
  ) {
    this.dialogRepo = new DialogRepository(pool)
    this.messageRepo = new MessageRepository(pool)
  }

  /**
   * Process an incoming Telegram Update webhook payload.
   * Returns true if the update was handled, false if skipped.
   */
  async handleUpdate(update: TelegramUpdate): Promise<boolean> {
    // Handle text messages
    if (update.message?.text) {
      await this.handleIncomingMessage(update.message)
      return true
    }

    // Handle callback_query (button press) — treat data as text
    if (update.callback_query?.data) {
      const syntheticMessage: TelegramMessage = {
        message_id: 0,
        from: update.callback_query.from,
        chat: update.callback_query.message?.chat ?? {
          id: update.callback_query.from.id,
          type: 'private',
        },
        date: Math.floor(Date.now() / 1000),
        text: update.callback_query.data,
      }
      await this.handleIncomingMessage(syntheticMessage)
      return true
    }

    // Non-text updates (photos, stickers, etc.) — skip for now
    return false
  }

  /**
   * Process a single text message from Telegram.
   */
  private async handleIncomingMessage(tgMessage: TelegramMessage): Promise<void> {
    const chatId = String(tgMessage.chat.id)
    const text = tgMessage.text ?? ''
    const senderName = tgMessage.from
      ? [tgMessage.from.first_name, tgMessage.from.last_name].filter(Boolean).join(' ')
      : 'Unknown'
    const senderUsername = tgMessage.from?.username

    // Find or create dialog for this Telegram chat
    let dialog = await this.dialogRepo.findByExternalId(this.tenantId, chatId)
    let isNewDialog = false

    if (!dialog) {
      dialog = await this.dialogRepo.create({
        tenantId: this.tenantId,
        channelType: 'TELEGRAM',
        externalChannelId: chatId,
        metadata: {
          telegramChatId: chatId,
          senderName,
          senderUsername: senderUsername ?? null,
        },
      })
      isNewDialog = true
    }

    // Persist the message
    const message = await this.messageRepo.create({
      dialogId: dialog.id,
      tenantId: this.tenantId,
      direction: 'INBOUND',
      senderType: 'CLIENT',
      content: text,
    })

    // Broadcast to operators via Socket.io /chat namespace
    const chatNsp = this.io.of('/chat')

    if (isNewDialog) {
      chatNsp.to(`tenant:${this.tenantId}`).emit('dialog:created', { dialog })
    }

    chatNsp.to(`tenant:${this.tenantId}`).emit('message:new', { message, dialog })
  }

  /**
   * Send an operator reply back to Telegram.
   * Called when operator sends a message to a TELEGRAM dialog.
   */
  async sendReply(chatId: string, text: string): Promise<void> {
    const result = await this.botService.sendMessage(chatId, text)
    if (!result.ok) {
      console.error('[telegram-adapter] Failed to send message to Telegram:', result.description)
      throw new Error(`Telegram API error: ${result.description}`)
    }
  }
}
