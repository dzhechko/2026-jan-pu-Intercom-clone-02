/**
 * Dialog aggregate — BC-01 Conversation Context
 * Reference: docs/tactical-design.md — Aggregates
 */

export type ChannelType = 'WEB_CHAT' | 'TELEGRAM' | 'VK_MAX'
export type DialogStatus = 'OPEN' | 'ASSIGNED' | 'CLOSED' | 'ARCHIVED'
export type PQLTier = 'HOT' | 'WARM' | 'COLD'

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
  createdAt: Date
  updatedAt: Date
}

export interface CreateDialogParams {
  tenantId: string
  channelType: ChannelType
  externalChannelId: string
  contactEmail?: string
  metadata?: Record<string, unknown>
}

/**
 * Factory — creates a new Dialog aggregate with safe defaults.
 */
export function createDialog(params: CreateDialogParams): Omit<Dialog, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    tenantId: params.tenantId,
    channelType: params.channelType,
    externalChannelId: params.externalChannelId,
    status: 'OPEN',
    contactEmail: params.contactEmail,
    metadata: params.metadata ?? {},
  }
}

/**
 * Business rule: a dialog can only be assigned when it is OPEN.
 */
export function canAssign(dialog: Dialog): boolean {
  return dialog.status === 'OPEN'
}

/**
 * Business rule: a dialog can only be closed when not already CLOSED or ARCHIVED.
 */
export function canClose(dialog: Dialog): boolean {
  return dialog.status !== 'CLOSED' && dialog.status !== 'ARCHIVED'
}
