/**
 * Auto-Attribution Service — FR-12: amoCRM Auto-Update.
 * On PQL deal close, auto-attribute in Revenue Report via amoCRM MCP.
 *
 * Flow:
 *   1. Receive DealClosedEvent (from amoCRM webhook or manual trigger)
 *   2. Find PQL detection linked to this deal's contact
 *   3. Create PQLAttribution record with confidence score
 *   4. Emit DealAttributed domain event
 *
 * Reference: docs/pseudocode.md PS-05, ADR-008
 */
import { v4 as uuidv4 } from 'uuid'
import {
  calculateTimeToClose,
  calculateAttributionConfidence,
} from '@revenue/domain/value-objects/pql-attribution'
import { DealClosedEvent } from '@integration/infrastructure/crm-webhook-types'
import type {
  Attribution,
  AttributionRepository,
  CreateAttributionInput,
} from '@revenue/infrastructure/repositories/attribution-repository'

// ─── Dependencies (ports) ───────────────────────────────────────────────────

/**
 * Minimal PQL detection record needed for attribution.
 */
export interface PQLDetectionRecord {
  readonly id: string
  readonly dialogId: string
  readonly tenantId: string
  readonly score: number
  readonly createdAt: Date
  readonly contactEmail?: string | null
}

/**
 * Port for looking up PQL detections — implemented by PQL BC repository.
 */
export interface PQLDetectionLookup {
  findByContactEmail(email: string, tenantId: string): Promise<PQLDetectionRecord | null>
  findById(detectionId: string): Promise<PQLDetectionRecord | null>
}

/**
 * Port for resolving amoCRM account_id → tenant mapping.
 */
export interface TenantLookup {
  findByAmoCRMAccountId(accountId: string): Promise<string | null>
}

// ─── Service ────────────────────────────────────────────────────────────────

export class AutoAttributionService {
  constructor(
    private readonly attributionRepo: AttributionRepository,
    private readonly pqlDetectionLookup: PQLDetectionLookup,
    private readonly tenantLookup: TenantLookup,
    private readonly onDealAttributed?: (attribution: Attribution) => void,
  ) {}

  /**
   * Process a deal closed event from amoCRM webhook.
   * Auto-attributes the deal to the most recent PQL detection for the contact.
   *
   * Returns the attribution if created, null if no matching PQL detection found.
   */
  async processDealClosed(event: DealClosedEvent): Promise<Attribution | null> {
    // 1. Resolve tenant from amoCRM account ID
    const tenantId = await this.tenantLookup.findByAmoCRMAccountId(event.accountId)
    if (!tenantId) {
      console.warn(`[auto-attribution] Unknown amoCRM account: ${event.accountId}`)
      return null
    }

    // 2. Check for duplicate attribution (idempotency)
    const existing = await this.attributionRepo.findByDealId(event.dealId)
    if (existing) {
      console.info(`[auto-attribution] Deal ${event.dealId} already attributed`)
      return existing
    }

    // 3. Find PQL detection linked to this deal's contact
    if (!event.contactEmail) {
      console.warn(`[auto-attribution] Deal ${event.dealId} has no contact email`)
      return null
    }

    const detection = await this.pqlDetectionLookup.findByContactEmail(
      event.contactEmail,
      tenantId,
    )
    if (!detection) {
      console.info(
        `[auto-attribution] No PQL detection found for ${event.contactEmail}`,
      )
      return null
    }

    // 4. Calculate attribution metrics
    const timeToClose = calculateTimeToClose(detection.createdAt, event.closedAt)
    const confidence = calculateAttributionConfidence(timeToClose, detection.score)

    // 5. Create attribution record
    const input: CreateAttributionInput = {
      id: uuidv4(),
      tenantId,
      pqlDetectionId: detection.id,
      dialogId: detection.dialogId,
      dealId: event.dealId,
      dealValue: event.dealValue,
      closedAt: event.closedAt,
      timeToClose,
      operatorId: event.responsibleUserId,
      confidence,
    }

    const attribution = await this.attributionRepo.save(input)

    // 6. Emit domain event
    if (this.onDealAttributed) {
      this.onDealAttributed(attribution)
    }

    console.info(
      `[auto-attribution] Deal ${event.dealId} attributed to PQL detection ${detection.id} ` +
        `(value: ${event.dealValue}, confidence: ${confidence})`,
    )

    return attribution
  }

  /**
   * Manually link a PQL detection to a deal.
   * Used by operators to create attributions that weren't auto-detected.
   */
  async linkDetectionToDeal(
    detectionId: string,
    dealId: string,
    dealValue: number,
    operatorId: string,
  ): Promise<Attribution | null> {
    // Check for duplicate
    const existing = await this.attributionRepo.findByDealId(dealId)
    if (existing) {
      return existing
    }

    // Look up the PQL detection
    const detection = await this.pqlDetectionLookup.findById(detectionId)
    if (!detection) {
      return null
    }

    const closedAt = new Date()
    const timeToClose = calculateTimeToClose(detection.createdAt, closedAt)
    const confidence = calculateAttributionConfidence(timeToClose, detection.score)

    const input: CreateAttributionInput = {
      id: uuidv4(),
      tenantId: detection.tenantId,
      pqlDetectionId: detectionId,
      dialogId: detection.dialogId,
      dealId,
      dealValue,
      closedAt,
      timeToClose,
      operatorId,
      confidence,
    }

    const attribution = await this.attributionRepo.save(input)

    if (this.onDealAttributed) {
      this.onDealAttributed(attribution)
    }

    return attribution
  }
}
