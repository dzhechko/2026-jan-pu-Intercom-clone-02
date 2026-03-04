/**
 * Telegram Outbound Handler — FR-05 Telegram Channel
 *
 * Listens on the /chat Socket.io namespace for operator:message events.
 * When the target dialog is a TELEGRAM channel, forwards the message
 * to the Telegram user via Bot API (in addition to normal DB persistence).
 *
 * Also hooks into the REST POST /api/dialogs/:id/messages flow
 * by providing a middleware-style function.
 */
import { Server as SocketIOServer } from 'socket.io'
import { Pool } from 'pg'
import { DialogRepository } from '@conversation/infrastructure/repositories/dialog-repository'
import { TelegramBotService } from '@integration/services/telegram-bot-service'

/**
 * Register a Socket.io middleware on /chat namespace that intercepts
 * operator messages destined for TELEGRAM dialogs and forwards them.
 */
export function registerTelegramOutbound(io: SocketIOServer, pool: Pool): void {
  const chatNsp = io.of('/chat')
  const dialogRepo = new DialogRepository(pool)

  // Use a Socket.io middleware to intercept outgoing operator messages
  chatNsp.use((socket, next) => {
    // Add a listener for operator:message after connection
    socket.on('operator:message:telegram', async (payload: {
      dialogId: string
      content: string
    }) => {
      try {
        const dialog = await dialogRepo.findById(payload.dialogId)
        if (!dialog || dialog.channelType !== 'TELEGRAM') return

        const botService = TelegramBotService.fromEnv()
        if (!botService) {
          console.error('[telegram-outbound] TELEGRAM_BOT_TOKEN not configured')
          return
        }

        await botService.sendMessage(dialog.externalChannelId, payload.content)
      } catch (err) {
        console.error('[telegram-outbound] Failed to forward message to Telegram:', err)
      }
    })

    next()
  })
}

/**
 * Standalone function: forward a message to Telegram if the dialog is a TELEGRAM channel.
 * Can be called from REST routes or other services.
 */
export async function forwardToTelegramIfNeeded(
  pool: Pool,
  dialogId: string,
  content: string,
): Promise<void> {
  const dialogRepo = new DialogRepository(pool)
  const dialog = await dialogRepo.findById(dialogId)

  if (!dialog || dialog.channelType !== 'TELEGRAM') return

  const botService = TelegramBotService.fromEnv()
  if (!botService) {
    console.error('[telegram-outbound] TELEGRAM_BOT_TOKEN not configured')
    return
  }

  const result = await botService.sendMessage(dialog.externalChannelId, content)
  if (!result.ok) {
    console.error('[telegram-outbound] Telegram API error:', result.description)
  }
}
