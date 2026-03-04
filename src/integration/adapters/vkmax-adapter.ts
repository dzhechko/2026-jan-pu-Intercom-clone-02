/**
 * VK Max / Messenger Max Adapter — FR-09 VK Max Channel
 *
 * Processes incoming VK Max webhook updates:
 *   1. Parses VK Max Update objects (message_new)
 *   2. Creates or finds existing dialog (channelType=VK_MAX)
 *   3. Persists inbound message
 *   4. Broadcasts to operator workspace via Socket.io
 *
 * Outbound: sendReply() forwards operator messages to VK Max via MCP.
 */
import { Pool } from 'pg'
import { Server as SocketIOServer } from 'socket.io'
import { DialogRepository } from '@conversation/infrastructure/repositories/dialog-repository'
import { MessageRepository } from '@conversation/infrastructure/repositories/message-repository'
import { VKMaxMCPService } from '@integration/services/vkmax-mcp-service'

// ─── VK Max types (subset) ──────────────────────────────────────────────────

export interface VKMaxMessage {
  peer_id: number
  from_id: number
  text: string
  date: number
}

export interface VKMaxUpdate {
  type: string
  object: {
    message: VKMaxMessage
  }
  group_id: number
}

// ─── Adapter ────────────────────────────────────────────────────────────────

export class VKMaxAdapter {
  private readonly dialogRepo: DialogRepository
  private readonly messageRepo: MessageRepository

  constructor(
    private readonly pool: Pool,
    private readonly io: SocketIOServer,
    private readonly mcpService: VKMaxMCPService,
    private readonly tenantId: string,
  ) {
    this.dialogRepo = new DialogRepository(pool)
    this.messageRepo = new MessageRepository(pool)
  }

  /**
   * Process an incoming VK Max webhook payload.
   * Returns true if the update was handled, false if skipped.
   */
  async handleUpdate(update: VKMaxUpdate): Promise<boolean> {
    // Only handle message_new events with text
    if (update.type === 'message_new' && update.object?.message?.text) {
      await this.handleIncomingMessage(update.object.message, update.group_id)
      return true
    }

    // Non-text or unknown event types — skip for now
    return false
  }

  /**
   * Process a single text message from VK Max.
   */
  private async handleIncomingMessage(vkMessage: VKMaxMessage, groupId: number): Promise<void> {
    const peerId = String(vkMessage.peer_id)
    const text = vkMessage.text
    const fromId = String(vkMessage.from_id)

    // Find or create dialog for this VK Max peer
    let dialog = await this.dialogRepo.findByExternalId(this.tenantId, peerId)
    let isNewDialog = false

    if (!dialog) {
      dialog = await this.dialogRepo.create({
        tenantId: this.tenantId,
        channelType: 'VK_MAX',
        externalChannelId: peerId,
        metadata: {
          vkMaxPeerId: peerId,
          vkMaxFromId: fromId,
          vkMaxGroupId: String(groupId),
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
   * Send an operator reply back to VK Max.
   * Called when operator sends a message to a VK_MAX dialog.
   */
  async sendReply(peerId: string, text: string): Promise<void> {
    const result = await this.mcpService.sendMessage(peerId, text)
    if (!result.ok) {
      console.error('[vkmax-adapter] Failed to send message to VK Max:', result.description)
      throw new Error(`VK Max MCP error: ${result.description}`)
    }
  }
}
