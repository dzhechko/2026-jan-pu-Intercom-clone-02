/**
 * Domain Event types — shared kernel between all Bounded Contexts.
 * These are the ONLY types that can be imported across BC boundaries (FF-02).
 * Reference: docs/tactical-design.md — Domain Events
 */

// Base event
export interface DomainEvent {
  readonly eventId: string
  readonly occurredAt: Date
  readonly tenantId: string
}

// BC-01: Conversation Events
export interface DialogStarted extends DomainEvent {
  readonly type: 'DialogStarted'
  readonly dialogId: string
  readonly channelType: 'WEB_CHAT' | 'TELEGRAM' | 'VK_MAX'
}

export interface MessageReceived extends DomainEvent {
  readonly type: 'MessageReceived'
  readonly dialogId: string
  readonly messageId: string
  readonly content: string
  readonly contactEmail: string | null
  readonly channelType: 'WEB_CHAT' | 'TELEGRAM' | 'VK_MAX'
}

export interface DialogAssigned extends DomainEvent {
  readonly type: 'DialogAssigned'
  readonly dialogId: string
  readonly operatorId: string
}

export interface DialogClosed extends DomainEvent {
  readonly type: 'DialogClosed'
  readonly dialogId: string
  readonly resolution: string
}

// BC-02: PQL Intelligence Events
export interface PQLDetected extends DomainEvent {
  readonly type: 'PQLDetected'
  readonly detectionId: string
  readonly dialogId: string
  readonly score: number
  readonly tier: 'HOT' | 'WARM' | 'COLD'
  readonly topSignals: Array<{ type: string; weight: number }>
}

export interface PQLFeedbackRecorded extends DomainEvent {
  readonly type: 'PQLFeedbackRecorded'
  readonly detectorId: string
  readonly totalSamples: number
  readonly accuracy: number
}

// BC-03: Revenue Events
export interface ReportGenerated extends DomainEvent {
  readonly type: 'ReportGenerated'
  readonly reportId: string
  readonly pdfUrl: string
  readonly summary: {
    pqlDetected: number
    pqlConverted: number
    totalRevenue: number
  }
}

export interface RevenueAttributed extends DomainEvent {
  readonly type: 'RevenueAttributed'
  readonly reportId: string
  readonly attributionId: string
  readonly dealValue: number
}

export interface DealAttributed extends DomainEvent {
  readonly type: 'DealAttributed'
  readonly attributionId: string
  readonly dealId: string
  readonly dealValue: number
  readonly pqlDetectionId: string
  readonly confidence: number
}

// BC-05: IAM Events
export interface OperatorInvited extends DomainEvent {
  readonly type: 'OperatorInvited'
  readonly operatorId: string
  readonly email: string
}

// BC-06: Notification Events
export interface PQLNotificationSent extends DomainEvent {
  readonly type: 'PQLNotificationSent'
  readonly notificationId: string
  readonly dialogId: string
  readonly tier: 'HOT' | 'WARM' | 'COLD'
  readonly channel: 'push' | 'email'
  readonly operatorId: string
}

// Union type for all events
export type KommuniqEvent =
  | DialogStarted
  | MessageReceived
  | DialogAssigned
  | DialogClosed
  | PQLDetected
  | PQLFeedbackRecorded
  | ReportGenerated
  | RevenueAttributed
  | DealAttributed
  | OperatorInvited
  | PQLNotificationSent
