/**
 * Notification domain types — BC-06 Notification Context.
 * Reference: FR-11 PQL Pulse Notifications
 */

export type NotificationType = 'pql_detected' | 'dialog_assigned' | 'system'
export type NotificationChannel = 'push' | 'email'

export interface Notification {
  id: string
  tenantId: string
  operatorId: string
  type: NotificationType
  channel: NotificationChannel
  dialogId: string
  title: string
  body: string
  metadata: {
    score?: number
    tier?: 'HOT' | 'WARM' | 'COLD'
    topSignals?: Array<{ type: string; weight: number }>
    contactEmail?: string | null
  }
  read: boolean
  createdAt: Date
}

export interface PQLNotificationPayload {
  detectionId: string
  dialogId: string
  tenantId: string
  score: number
  tier: 'HOT' | 'WARM' | 'COLD'
  topSignals: Array<{ ruleId: string; type: string; weight: number; matchedText: string }>
  contactEmail?: string | null
  assignedOperatorId?: string | null
}
