# FR-12: amoCRM Auto-Update — Pseudocode

## PS-12.1: Webhook Ingestion Pipeline

Reference: `src/integration/infrastructure/crm-webhook-routes.ts`

```
FUNCTION handleAmoCRMWebhook(request):
    payload = request.body AS AmoCRMWebhookPayload

    // Validate structure
    IF payload is empty OR (no leads AND no contacts):
        RETURN HTTP 400 { error: "Invalid webhook payload" }

    // Filter: only process deal-closed events
    IF NOT isDealClosedWebhook(payload):
        RETURN HTTP 200 { status: "ignored", reason: "not a deal closed event" }

    // ACL: Translate external types -> domain events
    dealClosedEvents = translateToDealClosedEvents(payload)

    // Process each event independently (error isolation)
    results = AWAIT Promise.allSettled(
        FOR EACH event IN dealClosedEvents:
            attributionService.processDealClosed(event)
    )

    processed = COUNT results WHERE status == "fulfilled"
    failed = COUNT results WHERE status == "rejected"

    IF failed > 0:
        LOG_ERROR failed results with reasons

    RETURN HTTP 200 { status: "ok", processed, failed }

CATCH error:
    LOG_ERROR "Webhook processing error", error
    RETURN HTTP 500 { error: "Internal server error" }
```

## PS-12.2: ACL Translation Functions

Reference: `src/integration/infrastructure/crm-webhook-types.ts`

```
CONSTANT AMOCRM_WON_STATUS_ID = "142"

FUNCTION isDealClosedWebhook(payload: AmoCRMWebhookPayload) -> boolean:
    statusChanges = payload.leads?.status
    IF statusChanges is empty:
        RETURN false
    RETURN ANY statusChange IN statusChanges WHERE status_id == AMOCRM_WON_STATUS_ID

FUNCTION translateToDealClosedEvents(payload: AmoCRMWebhookPayload) -> DealClosedEvent[]:
    statusChanges = payload.leads?.status
    IF statusChanges is empty:
        RETURN []

    RETURN statusChanges
        .FILTER(lead => lead.status_id == AMOCRM_WON_STATUS_ID)
        .MAP(lead =>
            // Extract contact email from custom_fields
            emailField = lead.custom_fields
                .FIND(f => f.name.toLowerCase() == "email")
            contactEmail = emailField?.values[0]?.value ?? null

            RETURN DealClosedEvent {
                dealId: lead.id,
                accountId: lead.account_id,
                dealValue: lead.price ?? 0,
                closedAt: NOW(),
                pipelineId: lead.pipeline_id,
                responsibleUserId: lead.responsible_user_id ?? null,
                contactEmail: contactEmail,
            }
        )
```

## PS-12.3: Auto-Attribution Pipeline

Reference: `src/revenue/application/services/auto-attribution-service.ts`

```
FUNCTION processDealClosed(event: DealClosedEvent) -> Attribution | null:

    // Step 1: Resolve tenant
    tenantId = AWAIT tenantLookup.findByAmoCRMAccountId(event.accountId)
    IF tenantId is null:
        LOG_WARN "Unknown amoCRM account: {event.accountId}"
        RETURN null

    // Step 2: Idempotency check
    existing = AWAIT attributionRepo.findByDealId(event.dealId)
    IF existing is not null:
        LOG_INFO "Deal {event.dealId} already attributed"
        RETURN existing

    // Step 3: Validate contact email
    IF event.contactEmail is null:
        LOG_WARN "Deal {event.dealId} has no contact email"
        RETURN null

    // Step 4: Find matching PQL detection
    detection = AWAIT pqlDetectionLookup.findByContactEmail(
        event.contactEmail, tenantId
    )
    IF detection is null:
        LOG_INFO "No PQL detection found for {event.contactEmail}"
        RETURN null

    // Step 5: Calculate metrics
    timeToClose = calculateTimeToClose(detection.createdAt, event.closedAt)
    confidence = calculateAttributionConfidence(timeToClose, detection.score)

    // Step 6: Persist
    attribution = AWAIT attributionRepo.save({
        id: UUID(),
        tenantId: tenantId,
        pqlDetectionId: detection.id,
        dialogId: detection.dialogId,
        dealId: event.dealId,
        dealValue: event.dealValue,
        closedAt: event.closedAt,
        timeToClose: timeToClose,
        operatorId: event.responsibleUserId,
        confidence: confidence,
    })

    // Step 7: Emit domain event
    IF onDealAttributed callback exists:
        CALL onDealAttributed(attribution)

    LOG_INFO "Deal {event.dealId} attributed to PQL {detection.id}"
    RETURN attribution
```

## PS-12.4: Confidence Scoring Algorithm

Reference: `src/revenue/domain/value-objects/pql-attribution.ts`

```
FUNCTION calculateTimeToClose(detectedAt: Date, closedAt: Date) -> number:
    diffMs = closedAt.getTime() - detectedAt.getTime()
    RETURN MAX(0, ROUND(diffMs / MS_PER_DAY))

FUNCTION calculateAttributionConfidence(timeToCloseDays: number, pqlScore: number) -> number:
    // Beyond 90-day window: no confidence in attribution
    IF timeToCloseDays > 90:
        RETURN 0

    // Linear decay: closer = more confident
    timeFactor = MAX(0, 1 - timeToCloseDays / 90)

    // Combined with PQL signal strength
    confidence = ROUND(timeFactor * pqlScore * 100) / 100

    RETURN confidence  // Range: 0.00 to 1.00

// Examples:
//   Day 0,  score 0.90 -> confidence 0.90 (immediate close, strong signal)
//   Day 31, score 0.85 -> confidence 0.56 (1 month, good signal)
//   Day 60, score 0.70 -> confidence 0.23 (2 months, moderate signal)
//   Day 91, score 0.95 -> confidence 0.00 (beyond window)
```

## PS-12.5: Manual Attribution

Reference: `src/revenue/application/services/auto-attribution-service.ts`

```
FUNCTION linkDetectionToDeal(
    detectionId: string,
    dealId: string,
    dealValue: number,
    operatorId: string
) -> Attribution | null:

    // Idempotency
    existing = AWAIT attributionRepo.findByDealId(dealId)
    IF existing is not null:
        RETURN existing

    // Lookup detection
    detection = AWAIT pqlDetectionLookup.findById(detectionId)
    IF detection is null:
        RETURN null

    closedAt = NOW()
    timeToClose = calculateTimeToClose(detection.createdAt, closedAt)
    confidence = calculateAttributionConfidence(timeToClose, detection.score)

    attribution = AWAIT attributionRepo.save({
        id: UUID(),
        tenantId: detection.tenantId,
        pqlDetectionId: detectionId,
        dialogId: detection.dialogId,
        dealId: dealId,
        dealValue: dealValue,
        closedAt: closedAt,
        timeToClose: timeToClose,
        operatorId: operatorId,
        confidence: confidence,
    })

    IF onDealAttributed callback exists:
        CALL onDealAttributed(attribution)

    RETURN attribution
```
