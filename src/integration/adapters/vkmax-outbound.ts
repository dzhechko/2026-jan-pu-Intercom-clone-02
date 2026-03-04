/**
 * VK Max Outbound Handler — FR-09 VK Max Channel
 *
 * Listens on the /chat Socket.io namespace for operator:message events.
 * When the target dialog is a VK_MAX channel, forwards the message
 * to the VK Max user via MCP (in addition to normal DB persistence).
 *
 * Also hooks into the REST POST /api/dialogs/:id/messages flow
 * by providing a middleware-style function.
 */
import { Server as SocketIOServer } from 'socket.io'
import { Pool } from 'pg'
import { DialogRepository } from '@conversation/infrastructure/repositories/dialog-repository'
import { VKMaxMCPService } from '@integration/services/vkmax-mcp-service'

/**
 * Register a Socket.io middleware on /chat namespace that intercepts
 * operator messages destined for VK_MAX dialogs and forwards them.
 */
export function registerVKMaxOutbound(io: SocketIOServer, pool: Pool): void {
  const chatNsp = io.of('/chat')
  const dialogRepo = new DialogRepository(pool)

  // Use a Socket.io middleware to intercept outgoing operator messages
  chatNsp.use((socket, next) => {
    // Add a listener for operator:message after connection
    socket.on('operator:message:vkmax', async (payload: {
      dialogId: string
      content: string
    }) => {
      try {
        const dialog = await dialogRepo.findById(payload.dialogId)
        if (!dialog || dialog.channelType !== 'VK_MAX') return

        const mcpService = VKMaxMCPService.fromEnv()
        if (!mcpService) {
          console.error('[vkmax-outbound] VKMAX_MCP_URL or VKMAX_ACCESS_TOKEN not configured')
          return
        }

        await mcpService.sendMessage(dialog.externalChannelId, payload.content)
      } catch (err) {
        console.error('[vkmax-outbound] Failed to forward message to VK Max:', err)
      }
    })

    next()
  })
}

/**
 * Standalone function: forward a message to VK Max if the dialog is a VK_MAX channel.
 * Can be called from REST routes or other services.
 */
export async function forwardToVKMaxIfNeeded(
  pool: Pool,
  dialogId: string,
  content: string,
): Promise<void> {
  const dialogRepo = new DialogRepository(pool)
  const dialog = await dialogRepo.findById(dialogId)

  if (!dialog || dialog.channelType !== 'VK_MAX') return

  const mcpService = VKMaxMCPService.fromEnv()
  if (!mcpService) {
    console.error('[vkmax-outbound] VKMAX_MCP_URL or VKMAX_ACCESS_TOKEN not configured')
    return
  }

  const result = await mcpService.sendMessage(dialog.externalChannelId, content)
  if (!result.ok) {
    console.error('[vkmax-outbound] VK Max MCP error:', result.description)
  }
}
