# Pseudocode: КоммуниК
**Version:** 1.0 | **Date:** 2026-03-04
**Conventions:** FUNCTION → VALIDATE → PROCESS → EMIT → RETURN

---

## PS-01: PQLDetectorService.analyze()
**Aggregate:** PQLDetector (BC-02)
**Trigger:** MessageReceived event from Redis Stream
**SLA:** <2 секунды end-to-end

```pseudocode
FUNCTION analyze(event: MessageReceivedEvent) -> PQLDetectionResult:

  // 1. Guard: только входящие от клиента
  IF event.message.senderType != CLIENT THEN
    RETURN PQLDetectionResult.skip("not_client_message")
  END IF

  // 2. Загрузить детектор тенанта (кеш 5 мин)
  detector = CACHE.get("detector:{event.tenantId}")
  IF detector IS NULL THEN
    detector = PQLDetectorRepository.findByTenantId(event.tenantId)
    CACHE.set("detector:{event.tenantId}", detector, TTL=300)
  END IF

  // 3. Параллельно: rule analysis + memory context fetch
  [ruleResult, memoryContext] = PARALLEL:
    - RuleEngine.analyze(event.message.content, detector.ruleSet)
    - MemoryAIService.fetchContext(event.contactEmail, event.tenantId)

  // 4. Score calculation
  baseScore = PQLScorer.calculate(ruleResult.signals)

  // 5. Context boost (если CRM данные обогатили контекст)
  boostedScore = APPLY_CONTEXT_BOOST(baseScore, memoryContext):
    IF memoryContext.crmData.currentPlan == 'FREE'
       AND memoryContext.crmData.accountAge > 30 days
    THEN score += 0.10  // активный Free user — выше вероятность конверсии
    IF memoryContext.crmData.deals.hasOpen == TRUE
    THEN score -= 0.05  // уже в воронке — чуть снижаем
    IF memoryContext.enrichmentScore < 0.3
    THEN score = baseScore  // мало данных — не буcтим

  finalScore = MIN(boostedScore, 1.0)

  // 6. Применить порог
  IF finalScore < detector.threshold THEN
    RETURN PQLDetectionResult.belowThreshold(finalScore)
  END IF

  // 7. Определить тир
  tier = SWITCH finalScore:
    >= 0.80 → HOT
    >= 0.65 → WARM
    default → COLD

  // 8. Сохранить детекцию
  detection = PQLDetection.create(
    tenantId: event.tenantId,
    dialogId: event.dialogId,
    messageId: event.messageId,
    score: finalScore,
    tier: tier,
    signals: ruleResult.signals,
    memoryCtx: memoryContext.snapshot()
  )
  PQLDetectionRepository.save(detection)

  // 9. Emit event
  EMIT PQLDetected(
    detectionId: detection.id,
    dialogId: event.dialogId,
    tenantId: event.tenantId,
    score: finalScore,
    tier: tier,
    topSignals: ruleResult.signals.top(3),
    memoryContext: memoryContext
  ) → Redis Stream "pql.detected"

  RETURN PQLDetectionResult.detected(detection)

END FUNCTION
```

---

## PS-02: RuleEngine.analyze()
**Part of:** PQLDetectorService
**Input:** message content (string) + ruleSet
**Output:** RuleAnalysisResult with matched signals

```pseudocode
FUNCTION analyze(content: string, ruleSet: RuleSet) -> RuleAnalysisResult:

  VALIDATE content IS NOT empty

  normalizedContent = content.toLowerCase().trim()
  matchedSignals = []
  totalWeight = 0.0

  FOR each rule IN ruleSet.rules:
    IF rule.pattern.test(normalizedContent) THEN
      matchedText = EXTRACT_MATCH(normalizedContent, rule.pattern)
      matchedSignals.append(SignalMatch(
        ruleId: rule.id,
        type: rule.type,
        weight: rule.weight,
        matchedText: matchedText
      ))
      totalWeight += rule.weight
    END IF
  END FOR

  // Нормализовать: cap при нескольких сильных сигналах
  normalizedScore = MIN(totalWeight / MAX_POSSIBLE_WEIGHT, 1.0)
  // MAX_POSSIBLE_WEIGHT = сумма top-5 весов = ~2.25

  RETURN RuleAnalysisResult(
    signals: matchedSignals,
    rawScore: totalWeight,
    normalizedScore: normalizedScore,
    topSignals: matchedSignals.sortByWeight().top(3)
  )

END FUNCTION
```

---

## PS-03: MemoryAIService.fetchContext()
**Part of:** PQLDetectorService
**MCP Used:** amoCRM MCP (Cloud.ru) + Evolution RAG MCP
**SLA:** <800ms (параллельные запросы)

```pseudocode
FUNCTION fetchContext(email: string, tenantId: TenantId) -> MemoryContext:

  IF email IS NULL OR email IS EMPTY THEN
    RETURN MemoryContext.empty()
  END IF

  // Check cache (TTL 10 min — баланс между freshness и latency)
  cacheKey = "memory:{tenantId}:{email}"
  cached = CACHE.get(cacheKey)
  IF cached IS NOT NULL THEN
    RETURN cached
  END IF

  // Параллельные запросы через MCP Adapters
  [crmResult, ragResult] = PARALLEL WITH TIMEOUT(700ms):
    - AmoCRMMCPAdapter.getContactContext(email, tenantId)
        CIRCUIT_BREAKER: if OPEN → return CRMResult.unavailable()
    - EvolutionRAGMCPAdapter.searchKB(email, tenantId, query="client context")
        CIRCUIT_BREAKER: if OPEN → return RAGResult.unavailable()

  // Собрать контекст
  ctx = MemoryContext(contactEmail: email)

  IF crmResult.isSuccess THEN
    ctx.crmData = CRMData(
      deals: crmResult.deals.filter(status: OPEN),
      contacts: crmResult.contacts,
      lastInteraction: crmResult.lastActivityDate,
      currentPlan: crmResult.customFields.plan,
      accountAge: DAYS_SINCE(crmResult.createdAt)
    )
  END IF

  IF ragResult.isSuccess THEN
    ctx.ragContext = ragResult.chunks.top(3).join("\n")
  END IF

  // Enrichment score: насколько полон контекст
  ctx.enrichmentScore = CALCULATE:
    score = 0.0
    IF ctx.crmData IS NOT NULL  THEN score += 0.5
    IF ctx.crmData.currentPlan  THEN score += 0.2
    IF ctx.crmData.accountAge   THEN score += 0.1
    IF ctx.ragContext IS NOT NULL THEN score += 0.2
    RETURN score

  CACHE.set(cacheKey, ctx, TTL=600)
  RETURN ctx

END FUNCTION
```

---

## PS-04: Dialog.receiveMessage() + Event Dispatch
**Aggregate:** Dialog (BC-01)
**Trigger:** Incoming message from any channel adapter

```pseudocode
FUNCTION receiveMessage(
  channelType: ChannelType,
  externalId: string,
  content: MessageContent,
  tenantId: TenantId
) -> Dialog:

  // 1. Find or create dialog
  dialog = DialogRepository.findOpenByExternalId(externalId, tenantId)
  IF dialog IS NULL THEN
    dialog = Dialog.create(
      tenantId: tenantId,
      channelType: channelType,
      externalChannelId: externalId,
      status: OPEN
    )
    EMIT DialogStarted(dialog.id, tenantId, channelType)
  END IF

  // 2. Create message
  message = Message(
    id: UUID.new(),
    direction: INBOUND,
    content: content,
    senderType: CLIENT,
    timestamp: NOW()
  )
  dialog.messages.append(message)
  dialog.updatedAt = NOW()

  // 3. Save
  DialogRepository.save(dialog)
  MessageRepository.save(message)

  // 4. Emit for PQL analysis (async — не блокирует ответ)
  EMIT MessageReceived(
    dialogId: dialog.id,
    messageId: message.id,
    tenantId: tenantId,
    content: content.text,
    contactEmail: dialog.contactEmail,
    channelType: channelType
  ) → Redis Stream "conversations.messages" (ASYNC, FIRE_AND_FORGET)

  // 5. Push to operator workspace (WebSocket)
  WS.broadcast(
    namespace: "tenant:{tenantId}",
    event: "message:new",
    data: { dialogId, message, pqlScore: dialog.pqlScore }
  )

  RETURN dialog

END FUNCTION
```

---

## PS-05: RevenueReport.generate()
**Aggregate:** RevenueReport (BC-03)
**Trigger:** Cron job — 1-е число каждого месяца, 09:00
**MCP Used:** amoCRM MCP для верификации сделок

```pseudocode
FUNCTION generateMonthlyReports() -> void:  // Worker/Cron

  activeTenants = TenantRepository.findAllActive()

  FOR each tenant IN activeTenants:
    TRY
      generateReportForTenant(tenant.id, PREVIOUS_MONTH())
    CATCH error:
      LOG.error("Report failed for tenant", tenant.id, error)
      EMIT ReportFailed(tenant.id, error) → notifications queue
    END TRY
  END FOR

END FUNCTION


FUNCTION generateReportForTenant(tenantId: TenantId, period: ReportPeriod) -> RevenueReport:

  // 1. Проверить не было ли уже сгенерировано
  existing = RevenueReportRepository.findByPeriod(tenantId, period)
  IF existing IS NOT NULL AND existing.status != DRAFT THEN
    RETURN existing
  END IF

  // 2. Собрать PQL детекции за период
  detections = PQLDetectionRepository.findByPeriod(tenantId, period)
  IF detections.isEmpty THEN
    LOG.info("No PQL detections for period", tenantId, period)
    RETURN NULL
  END IF

  // 3. Верифицировать закрытые сделки через amoCRM MCP
  attributions = []
  FOR each detection IN detections:
    IF detection.feedback == CORRECT OR detection.feedback IS NULL THEN
      TRY
        deal = AmoCRMMCPAdapter.findDealByDialogContext(
          tenantId: tenantId,
          contactEmail: detection.memoryCtx.contactEmail,
          afterDate: detection.createdAt,
          beforeDate: period.endDate
        )
        IF deal IS NOT NULL AND deal.status == WON THEN
          attributions.append(PQLAttribution(
            pqlDetectionId: detection.id,
            dialogId: detection.dialogId,
            dealId: deal.id,
            dealValue: Money(deal.value, 'RUB'),
            closedAt: deal.closedAt,
            timeToClose: DURATION(detection.createdAt, deal.closedAt),
            operatorId: detection.operatorId,
            confidence: CALCULATE_CONFIDENCE(detection, deal)
          ))
        END IF
      CATCH MCPError:
        LOG.warn("amoCRM MCP unavailable, skipping deal check", detection.id)
      END TRY
    END IF
  END FOR

  // 4. Вычислить summary
  summary = RevenueSummary(
    totalDialogs: DialogRepository.countByPeriod(tenantId, period),
    pqlDetected: detections.count(),
    pqlConvertedToDeals: attributions.count(),
    pqlConversionRate: SAFE_DIVIDE(attributions.count(), detections.count()) * 100,
    totalRevenue: Money(attributions.sum(a => a.dealValue.amount), 'RUB'),
    avgTimeToClose: attributions.avg(a => a.timeToClose),
    topOperators: RANK_OPERATORS(attributions)
  )

  // 5. Создать/обновить отчёт
  report = RevenueReport(
    tenantId: tenantId,
    period: period,
    status: DRAFT,
    attributions: attributions,
    summary: summary
  )
  RevenueReportRepository.save(report)

  // 6. Сгенерировать PDF через Puppeteer
  pdfUrl = PDFGenerator.render(
    template: "revenue-report-v1",
    data: { report, tenant: TenantRepository.findById(tenantId) }
  )
  report.pdfUrl = pdfUrl
  report.status = GENERATED
  RevenueReportRepository.save(report)

  // 7. Отправить
  EMIT ReportGenerated(
    reportId: report.id,
    tenantId: tenantId,
    pdfUrl: pdfUrl,
    summary: summary
  ) → notifications queue

  RETURN report

END FUNCTION
```

---

## PS-06: AmoCRMMCPAdapter.getContactContext()
**Part of:** BC-04 Integration Context
**Pattern:** Anti-Corruption Layer + Circuit Breaker
**MCP:** amoCRM MCP (Cloud.ru, 38★)

```pseudocode
CLASS AmoCRMMCPAdapter IMPLEMENTS CRMPort:

  circuitBreaker = CircuitBreaker(
    timeout: 2000ms,
    errorThreshold: 50%,
    resetAfter: 30s
  )

  FUNCTION getContactContext(email: string, tenantId: TenantId) -> CRMResult:

    // Получить tenant credentials (зашифровано в TenantSettings)
    creds = TenantSettingsService.getCRMCredentials(tenantId)
    IF creds IS NULL THEN
      RETURN CRMResult.notConfigured()
    END IF

    TRY
      // Вызов через Circuit Breaker
      rawResult = circuitBreaker.execute(() =>
        MCPClient.call(
          server: "amocrm-mcp.cloud.ru",
          tool: "get_contact_by_email",
          params: {
            email: email,
            apiKey: creds.apiKey,    // расшифровывается в памяти
            subdomain: creds.subdomain
          }
        )
      )

      // Anti-Corruption: маппинг amoCRM структуры → доменные типы
      RETURN CRMResult.success(
        contacts: rawResult.contacts.map(c => CRMContact(
          id: c.id,
          name: c.name,
          email: c.email,
          customFields: c.custom_fields_values
        )),
        deals: rawResult.leads.map(d => CRMDeal(
          id: d.id,
          status: MAP_STATUS(d.status_id),  // amoCRM status_id → DealStatus
          value: d.price,
          createdAt: UNIX_TO_DATETIME(d.created_at)
        )),
        lastActivityDate: UNIX_TO_DATETIME(rawResult.contacts[0]?.updated_at)
      )

    CATCH CircuitOpenError:
      LOG.warn("amoCRM MCP circuit open", tenantId)
      RETURN CRMResult.unavailable()

    CATCH MCPTimeoutError:
      METRIC.increment("mcp.amocrm.timeout")
      RETURN CRMResult.unavailable()

    CATCH MCPError as e:
      LOG.error("amoCRM MCP error", e, tenantId)
      RETURN CRMResult.error(e.message)
    END TRY

  END FUNCTION

END CLASS
```

---

## PS-07: PQL Feedback → ML Training Data
**Part of:** BC-02 PQL Intelligence
**Trigger:** Operator marks PQL as correct/incorrect in Workspace

```pseudocode
FUNCTION recordPQLFeedback(
  detectionId: UUID,
  operatorId: OperatorId,
  feedback: FeedbackType   // CORRECT | INCORRECT
) -> void:

  detection = PQLDetectionRepository.findById(detectionId)
  VALIDATE detection IS NOT NULL
  VALIDATE detection.feedback IS NULL  // не перезаписывать

  // Сохранить feedback
  detection.feedback = feedback
  PQLDetectionRepository.save(detection)

  // Сохранить как тренировочные данные
  message = MessageRepository.findById(detection.messageId)
  MLTrainingDataRepository.save(MLTrainingSample(
    tenantId: detection.tenantId,
    messageText: message.content,
    label: (feedback == CORRECT),  // true = is PQL
    signals: detection.signals,
    modelVersion: "v1-rules"
  ))

  // Обновить stats детектора
  detector = PQLDetectorRepository.findByTenantId(detection.tenantId)
  IF feedback == CORRECT THEN
    detector.stats.correct += 1
  END IF
  detector.stats.total += 1
  PQLDetectorRepository.save(detector)

  // Emit — триггер для retrain если достаточно данных
  EMIT PQLFeedbackRecorded(
    tenantId: detection.tenantId,
    totalSamples: MLTrainingDataRepository.countByTenant(detection.tenantId),
    accuracy: SAFE_DIVIDE(detector.stats.correct, detector.stats.total)
  ) → Redis Stream "pql.feedback"

  // В ML Pipeline worker: если totalSamples > 1000 → schedule retrain

END FUNCTION
```

---

## Pseudocode Index

| ID | Function | Aggregate/Service | SLA | Lines |
|----|----------|------------------|:----|:------|
| PS-01 | `PQLDetectorService.analyze()` | PQLDetector | <2с | Main detection pipeline |
| PS-02 | `RuleEngine.analyze()` | PQLDetector | <50ms | Rule matching + scoring |
| PS-03 | `MemoryAIService.fetchContext()` | PQLDetector | <800ms | CRM + RAG context fetch |
| PS-04 | `Dialog.receiveMessage()` | Dialog | <100ms | Message intake + event dispatch |
| PS-05 | `RevenueReport.generate()` | RevenueReport | <30s | Monthly report generation |
| PS-06 | `AmoCRMMCPAdapter.getContactContext()` | Integration | <700ms | MCP ACL + Circuit Breaker |
| PS-07 | `recordPQLFeedback()` | PQLDetector | <200ms | Feedback → ML training data |
