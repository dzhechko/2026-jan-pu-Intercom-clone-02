# FR-06: Revenue Intelligence Report -- Pseudocode

**Feature ID:** FR-06
**Bounded Context:** BC-03 Revenue
**Reference:** docs/pseudocode.md PS-05

---

## 1. Report Generation Pipeline (RevenueReportService.generateReportForTenant)

```pseudocode
FUNCTION generateReportForTenant(tenantId: UUID, period: ReportPeriod) -> RevenueReport
  // Step 1: Idempotency check
  existing := reportRepo.findByPeriod(tenantId, period)
  IF existing != NULL AND existing.status != 'DRAFT' THEN
    RETURN existing   // Already generated or sent, skip re-generation
  END IF

  // Step 2: Calculate date boundaries
  { start, end } := getPeriodDateRange(period)
  // start = first day of month 00:00:00
  // end   = first day of next month 00:00:00

  // Step 3: Collect input data (sequential reads)
  detections := pqlReader.findByTenantIdForPeriod(tenantId, start, end)
  deals      := crmReader.findClosedDealsForPeriod(tenantId, start, end)
  totalDialogs := dialogReader.countByTenantForPeriod(tenantId, start, end)

  // Step 4: Build attributions
  attributions := buildAttributions(detections, deals)

  // Step 5: Calculate summary
  summary := calculateSummary(totalDialogs, detections, attributions)

  // Step 6: Create or reuse report shell
  report := existing ?? createRevenueReport(tenantId, period)  // new DRAFT

  // Step 7: Generate HTML
  tenant := tenantReader.findById(tenantId)
  html := generateReportHtml({
    tenantName: tenant.name ?? 'Unknown',
    period, summary, attributions
  })

  // Step 8: Transition to GENERATED
  generated := markReportGenerated(report, summary, attributions, html, pdfUrl=NULL)

  // Step 9: Persist
  IF existing != NULL THEN
    RETURN reportRepo.update(generated)
  ELSE
    RETURN reportRepo.save(generated)
  END IF
END FUNCTION
```

## 2. Attribution Builder (buildAttributions)

```pseudocode
FUNCTION buildAttributions(
  detections: PQLDetectionForReport[],
  deals: CRMDealForReport[]
) -> PQLAttribution[]

  // Guard: no data means no attributions
  IF detections.length == 0 OR deals.length == 0 THEN
    RETURN []
  END IF

  attributions := []

  // Filter to eligible detections and deals
  qualifiedDetections := detections.FILTER(d => d.tier == 'HOT' OR d.tier == 'WARM')
  wonDeals := deals.FILTER(d => d.status == 'WON' AND d.closedAt != NULL)

  // v1: Round-robin matching (index-based)
  // v2 will match via contactEmail linkage
  matchCount := MIN(qualifiedDetections.length, wonDeals.length)

  FOR i := 0 TO matchCount - 1 DO
    detection := qualifiedDetections[i]
    deal      := wonDeals[i]

    operatorId := dialogReader.findOperatorByDialogId(detection.dialogId)
    timeToClose := calculateTimeToClose(detection.createdAt, deal.closedAt)
    confidence  := calculateAttributionConfidence(timeToClose, detection.score)

    attributions.PUSH({
      pqlDetectionId: detection.id,
      dialogId: detection.dialogId,
      dealId: deal.id,
      dealValue: deal.value,
      closedAt: deal.closedAt,
      timeToClose,
      operatorId,
      confidence
    })
  END FOR

  RETURN attributions
END FUNCTION
```

## 3. Confidence Scoring

```pseudocode
FUNCTION calculateAttributionConfidence(timeToCloseDays: number, pqlScore: number) -> number
  // 90-day maximum attribution window
  IF timeToCloseDays > 90 THEN
    RETURN 0
  END IF

  // Linear decay: closer = higher confidence
  timeFactor := MAX(0, 1 - timeToCloseDays / 90)

  // Multiply by PQL signal strength
  confidence := timeFactor * pqlScore

  // Round to 2 decimal places
  RETURN ROUND(confidence * 100) / 100
END FUNCTION

FUNCTION calculateTimeToClose(detectedAt: Date, closedAt: Date) -> number
  diffMs := closedAt.getTime() - detectedAt.getTime()
  RETURN MAX(0, ROUND(diffMs / MS_PER_DAY))
END FUNCTION
```

## 4. Summary Calculation

```pseudocode
FUNCTION calculateSummary(
  totalDialogs: number,
  detections: PQLDetectionForReport[],
  attributions: PQLAttribution[]
) -> RevenueSummary

  totalRevenue := SUM(attributions, a => a.dealValue)
  avgTimeToClose := attributions.length > 0
    ? ROUND(SUM(attributions, a => a.timeToClose) / attributions.length)
    : 0

  // Group by operator for top performers
  operatorMap := new Map<operatorId, { dealsWon, totalRevenue, totalTime }>

  FOR EACH attr IN attributions DO
    opId := attr.operatorId ?? 'unassigned'
    entry := operatorMap.GET(opId) ?? { dealsWon: 0, totalRevenue: 0, totalTime: 0 }
    entry.dealsWon += 1
    entry.totalRevenue += attr.dealValue
    entry.totalTime += attr.timeToClose
    operatorMap.SET(opId, entry)
  END FOR

  topOperators := operatorMap.entries()
    .MAP(([opId, stats]) => ({
      operatorId: opId,
      dealsWon: stats.dealsWon,
      totalRevenue: stats.totalRevenue,
      avgTimeToClose: ROUND(stats.totalTime / stats.dealsWon)
    }))
    .SORT_BY(totalRevenue, DESC)
    .SLICE(0, 5)

  RETURN buildRevenueSummary({
    totalDialogs,
    pqlDetected: detections.length,
    pqlConvertedToDeals: attributions.length,
    totalRevenue,
    avgTimeToClose,
    topOperators
  })
END FUNCTION
```

## 5. Batch Monthly Generation

```pseudocode
FUNCTION generateMonthlyReports() -> { generated: number, errors: string[] }
  // Calculate previous month
  now := new Date()
  IF now.month == January THEN
    period := { year: now.year - 1, month: 12 }
  ELSE
    period := { year: now.year, month: now.month - 1 }
  END IF

  tenants := tenantReader.findAllActive()
  generated := 0
  errors := []

  FOR EACH tenant IN tenants DO
    TRY
      generateReportForTenant(tenant.id, period)
      generated += 1
    CATCH error
      errors.PUSH("Tenant ${tenant.id}: ${error.message}")
      // CONTINUE -- do not abort for other tenants
    END TRY
  END FOR

  RETURN { generated, errors }
END FUNCTION
```

## 6. Email Sending

```pseudocode
FUNCTION sendReport(reportId: UUID) -> RevenueReport
  report := reportRepo.findById(reportId)
  IF report == NULL THEN
    THROW "Report not found"
  END IF
  IF report.status == 'SENT' THEN
    RETURN report  // already sent, idempotent
  END IF
  IF report.status != 'GENERATED' THEN
    THROW "Report not yet generated"
  END IF

  tenant := tenantReader.findById(report.tenantId)
  IF tenant == NULL THEN
    THROW "Tenant not found"
  END IF

  emailSender.send({
    to: tenant.billingEmail,
    subject: "KommuniQ Revenue Report -- ${formatPeriod(report.period)}",
    html: report.htmlContent ?? '<p>Report content unavailable</p>'
  })

  sent := markReportSent(report)
  RETURN reportRepo.update(sent)
END FUNCTION
```

## 7. Auto-Attribution (FR-12 integration)

```pseudocode
FUNCTION processDealClosed(event: DealClosedEvent) -> Attribution | NULL
  // 1. Resolve tenant
  tenantId := tenantLookup.findByAmoCRMAccountId(event.accountId)
  IF tenantId == NULL THEN RETURN NULL

  // 2. Idempotency
  existing := attributionRepo.findByDealId(event.dealId)
  IF existing != NULL THEN RETURN existing

  // 3. Find linked PQL detection
  IF event.contactEmail == NULL THEN RETURN NULL
  detection := pqlDetectionLookup.findByContactEmail(event.contactEmail, tenantId)
  IF detection == NULL THEN RETURN NULL

  // 4. Calculate metrics
  timeToClose := calculateTimeToClose(detection.createdAt, event.closedAt)
  confidence := calculateAttributionConfidence(timeToClose, detection.score)

  // 5. Create and persist
  attribution := attributionRepo.save({
    id: newUUID(), tenantId, pqlDetectionId: detection.id,
    dialogId: detection.dialogId, dealId: event.dealId,
    dealValue: event.dealValue, closedAt: event.closedAt,
    timeToClose, operatorId: event.responsibleUserId, confidence
  })

  // 6. Emit domain event
  EMIT DealAttributed(attribution)

  RETURN attribution
END FUNCTION
```
