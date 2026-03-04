/**
 * Message value object — BC-01 Conversation Context
 * Reference: docs/tactical-design.md — Value Objects
 */

export type MessageDirection = 'INBOUND' | 'OUTBOUND'
export type SenderType = 'CLIENT' | 'OPERATOR' | 'BOT'

export interface Message {
  id: string
  dialogId: string
  tenantId: string
  direction: MessageDirection
  senderType: SenderType
  content: string
  attachments: unknown[]
  pqlSignals: unknown[]
  createdAt: Date
}

export interface CreateMessageParams {
  dialogId: string
  tenantId: string
  direction: MessageDirection
  senderType: SenderType
  content: string
  attachments?: unknown[]
  pqlSignals?: unknown[]
}

/**
 * Factory — creates a new Message value object with safe defaults.
 */
export function createMessage(
  params: CreateMessageParams,
): Omit<Message, 'id' | 'createdAt'> {
  return {
    dialogId: params.dialogId,
    tenantId: params.tenantId,
    direction: params.direction,
    senderType: params.senderType,
    content: params.content,
    attachments: params.attachments ?? [],
    pqlSignals: params.pqlSignals ?? [],
  }
}
