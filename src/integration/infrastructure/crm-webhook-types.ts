/**
 * amoCRM Webhook Types — Anti-Corruption Layer.
 * FR-12: Translates external amoCRM webhook payloads → domain events.
 *
 * amoCRM sends webhook data as form-encoded or JSON with nested arrays.
 * This ACL ensures no amoCRM-specific types leak into domain code.
 */

// ─── External amoCRM Webhook Types (raw from amoCRM) ────────────────────────

export interface AmoCRMWebhookLeadStatus {
  readonly id: string
  readonly status_id: string
  readonly pipeline_id: string
  readonly old_status_id: string
  readonly account_id: string
  readonly price?: number
  readonly responsible_user_id?: string
  readonly custom_fields?: Array<{
    id: string
    name: string
    values: Array<{ value: string }>
  }>
}

export interface AmoCRMWebhookPayload {
  readonly leads?: {
    readonly status?: AmoCRMWebhookLeadStatus[]
    readonly add?: AmoCRMWebhookLeadStatus[]
    readonly update?: AmoCRMWebhookLeadStatus[]
  }
  readonly contacts?: {
    readonly update?: Array<{
      id: string
      name?: string
      email?: string
      account_id: string
    }>
  }
  readonly account?: {
    readonly id: string
    readonly subdomain: string
  }
}

// ─── Domain Events (internal) ───────────────────────────────────────────────

export interface DealClosedEvent {
  readonly dealId: string
  readonly accountId: string
  readonly dealValue: number
  readonly closedAt: Date
  readonly pipelineId: string
  readonly responsibleUserId: string | null
  readonly contactEmail: string | null
}

// ─── ACL: Translation Functions ─────────────────────────────────────────────

/**
 * amoCRM "won" status ID — status_id 142 is the default "successfully realized" status.
 * This matches the mapping in AmoCRMMCPAdapter.mapDealStatus().
 */
const AMOCRM_WON_STATUS_ID = '142'

/**
 * Check if the webhook payload contains a deal closed/won event.
 */
export function isDealClosedWebhook(payload: AmoCRMWebhookPayload): boolean {
  const statusChanges = payload.leads?.status
  if (!statusChanges || statusChanges.length === 0) return false
  return statusChanges.some((lead) => lead.status_id === AMOCRM_WON_STATUS_ID)
}

/**
 * ACL: Translate amoCRM webhook lead status changes → domain DealClosedEvent[].
 * Only returns events for deals that moved to "won" status.
 */
export function translateToDealClosedEvents(payload: AmoCRMWebhookPayload): DealClosedEvent[] {
  const statusChanges = payload.leads?.status
  if (!statusChanges) return []

  return statusChanges
    .filter((lead) => lead.status_id === AMOCRM_WON_STATUS_ID)
    .map((lead) => {
      // Extract contact email from custom fields if available
      const emailField = lead.custom_fields?.find(
        (f) => f.name.toLowerCase() === 'email' || f.name.toLowerCase() === 'email',
      )
      const contactEmail = emailField?.values?.[0]?.value ?? null

      return {
        dealId: lead.id,
        accountId: lead.account_id,
        dealValue: lead.price ?? 0,
        closedAt: new Date(),
        pipelineId: lead.pipeline_id,
        responsibleUserId: lead.responsible_user_id
          ? String(lead.responsible_user_id)
          : null,
        contactEmail,
      }
    })
}
