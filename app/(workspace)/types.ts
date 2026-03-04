/**
 * Shared TypeScript types for the Operator Workspace (FR-07).
 * These mirror the server-side domain types from BC-01 Conversation Context.
 */

export type ChannelType = 'WEB_CHAT' | 'TELEGRAM' | 'VK_MAX'
export type DialogStatus = 'OPEN' | 'ASSIGNED' | 'CLOSED' | 'ARCHIVED'
export type PQLTier = 'HOT' | 'WARM' | 'COLD'
export type MessageDirection = 'INBOUND' | 'OUTBOUND'
export type SenderType = 'CLIENT' | 'OPERATOR' | 'BOT'

export interface Dialog {
  id: string
  tenantId: string
  channelType: ChannelType
  externalChannelId: string
  status: DialogStatus
  assignedOperatorId?: string
  contactEmail?: string
  pqlScore?: number
  pqlTier?: PQLTier
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  /** Client-side computed field: last message preview */
  lastMessagePreview?: string
  /** Client-side computed field: last message timestamp */
  lastMessageAt?: string
  /** Client-side computed field: unread message count */
  unreadCount?: number
}

export interface Message {
  id: string
  dialogId: string
  tenantId: string
  direction: MessageDirection
  senderType: SenderType
  content: string
  attachments: unknown[]
  pqlSignals: unknown[]
  createdAt: string
}

export interface OperatorProfile {
  id: string
  email: string
  name: string
  role: 'ADMIN' | 'OPERATOR'
  tenantId: string
  status: string
}

export interface QuickReply {
  id: string
  label: string
  content: string
}
