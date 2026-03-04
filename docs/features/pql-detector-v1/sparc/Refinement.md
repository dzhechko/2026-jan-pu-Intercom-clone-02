# Refinement: FR-01 PQL Detector v1 (Rule-Based)

**Feature ID:** FR-01
**Bounded Context:** BC-02 PQL Intelligence
**Reference:** docs/refinement.md
**Status:** Implemented
**Version:** 1.0 | **Date:** 2026-03-04

---

## 1. Edge Cases

| ID | Scenario | Behavior | Implementation |
|----|----------|----------|---------------|
| EC-01 | Concurrent messages on same dialog | Each message analyzed independently; latest score overwrites dialog.pql_score | DialogPQLUpdater.updatePQLScore() is idempotent — last write wins |
| EC-02 | Long message > 5,000 chars | Truncated to first 2,000 chars before analysis | `content.slice(0, 2000)` in analyzeRules() |
| EC-03 | Emoji in message text | Stripped before matching; does not interfere with word detection | `/[\u{1F600}-\u{1F9FF}]/gu` regex in normalizeContent() |
| EC-04 | Empty message content | Returns null immediately; no persistence, no DB write | Empty string guard at top of analyzeRules() |
| EC-05 | OPERATOR or BOT sender type | Skipped entirely; no analysis performed | senderType guard in PQLDetectorService.analyze() |
| EC-06 | All-caps message ("ENTERPRISE ТАРИФ") | Detected correctly — case-insensitive | `.toLowerCase()` in normalizeContent() |
| EC-07 | Mixed Cyrillic + Latin in same message | Both detected — all patterns include both scripts | Example: "enterprise корпоратив" matches R02 on "enterprise" |
| EC-08 | Invalid pql:analyze payload (missing fields) | Silently skipped — non-blocking | `if (!messageId || !dialogId ...)` guard in consumer |
| EC-09 | Detection repository save fails | Error logged; pql:detected NOT broadcast (crash fails silently in consumer try/catch) | `console.error('[pql-consumer] analysis error', err)` |
| EC-10 | DialogPQLUpdater.updatePQLScore fails | Error propagates out of service; detection is already saved (partial state possible) | No rollback mechanism in v1 |
| EC-11 | Message with only whitespace | Empty after trim → zero result, null returned | normalizeContent().trim() → empty |
| EC-12 | Message with only emoji | Empty after emoji strip → zero result, null returned | Strip emoji → then guard catches empty |

---

## 2. Risks

| ID | Risk | Probability | Impact | Mitigation |
|----|------|-------------|--------|------------|
| R01 | False positives — word "тест" triggers TRIAL in QA/test conversations | MEDIUM | LOW (operator sees incorrect PQL flag) | v2: per-tenant rule tuning; operator feedback (FR-10 PS-07) |
| R02 | False negatives — English-only variants not covered ("pricing" present but "price" not) | MEDIUM | MEDIUM | Current patterns use partial matches (e.g., `/оплат/i` catches оплата/оплатить) |
| R03 | Score inflation — same semantic intent split across rules accumulates too much weight | LOW | LOW | MAX_POSSIBLE_WEIGHT cap at top-5 prevents runaway scores |
| R04 | Partial DB write — detection saved but dialog not updated | LOW | LOW | Both writes in-process; partial state visible briefly. v2: wrap in transaction |
| R05 | Missing HOT detections if Socket.io event delivery fails | LOW | MEDIUM | Event is fire-and-forget; missed events lost. v2: Redis Streams guarantees delivery |
| R06 | Detection race condition — two concurrent messages, second write overwrites first score | LOW | LOW | Last-write-wins is acceptable for score denormalization |
| R07 | ML service predict() throws uncaught exception | LOW | HIGH | Wrapped in if(mlModelService) check; errors in ML path not currently caught in v1 |

---

## 3. Known Limitations (v1)

1. **No CRM context boost:** PS-01 pseudocode describes a context boost step (+0.10 for free plan users, -0.05 for open deals). This is NOT implemented in v1. The `memoryContext` parameter is omitted from the rule engine path. Impact: scores may be slightly under-calibrated for high-value targets.

2. **Redis Streams not used:** ADR-006 specifies Redis Streams for async event delivery. v1 uses Socket.io internal events. Risk: if the Socket.io connection drops between message save and PQL analysis, the detection event is lost. Acceptable at MVP scale.

3. **No per-tenant rule customization:** All tenants share DEFAULT_RULES. The PQLDetector aggregate in tactical design includes a `ruleSet` field per tenant — this is not yet exposed via API.

4. **No deduplication:** If the same message fires pql:analyze twice (e.g., duplicate Socket.io event), two detection records are created and dialog score is updated twice. v2 should add idempotency key on message_id.

5. **Emoji coverage:** Only the range U+1F600–U+1F9FF is stripped. Other Unicode ranges (Dingbats U+2700, Enclosed U+2460, etc.) are not stripped. These rarely interfere with word matching but edge cases exist.

---

## 4. Testing Strategy

### 4.1 Unit Tests (FF-05: >= 95% coverage)

**File:** `src/pql/domain/rule-engine.test.ts`

| Test | Purpose | Status |
|------|---------|--------|
| Detects ENTERPRISE signal | Positive match R02 | Implemented |
| Detects PURCHASE signals | Positive match R06 | Implemented |
| Detects 3+ weak signals | Multi-signal positive | Implemented |
| Non-PQL message → zero | Negative match | Implemented |
| Empty content → zero | EC-04 guard | Implemented |
| Case insensitive | EC-06 | Implemented |
| Score in [0, 1] | Normalization bounds | Implemented |
| Top-3 sorted by weight | Sort order | Implemented |
| Long message truncation | EC-02 | Implemented |
| Emoji in message | EC-03 | Implemented |
| Custom rules injection | Extensibility | Implemented |

**File:** `src/pql/application/services/pql-detector-service.test.ts`

| Test | Purpose | Status |
|------|---------|--------|
| OPERATOR message → null | EC-05 sender guard | Implemented |
| BOT message → null | EC-05 sender guard | Implemented |
| Non-PQL content → null | Zero signal guard | Implemented |
| Detects signals in purchase message | Happy path | Implemented |
| Persists detection to repo | Repository integration | Implemented |
| Updates dialog PQL score | DialogPQLUpdater | Implemented |
| HOT tier classification | Score >= 0.80 | Implemented |
| COLD tier classification | Score < 0.65 | Implemented |
| Top-3 signals sorted | Sort order | Implemented |
| Unique detection ID per message | UUID generation | Implemented |
| createdAt timestamp | Timestamp accuracy | Implemented |
| Empty content → null | EC-04 via service | Implemented |
| Emoji content | EC-03 via service | Implemented |

### 4.2 Integration Tests (Recommended, not yet implemented)

| Test | Purpose |
|------|---------|
| RLS: tenant A cannot read tenant B detections | FF-03 isolation |
| RLS: direct UUID access to other tenant detection | FF-03 direct access |
| findByDialogId returns correct records | Repository query |
| findByTenantId respects pagination | Pagination |
| pql.detections INSERT and RETURNING * | Full round-trip |

### 4.3 Performance Tests (Recommended)

| Test | Target |
|------|--------|
| analyzeRules() on 2000-char message | < 5 ms |
| Full analyze() pipeline (no DB) | < 50 ms |
| 100 concurrent analyze() calls | < 2000 ms p95 (FF-01) |

---

## 5. BDD Scenarios

Reference: `docs/test-scenarios.feature`

### Scenario 1: HOT tier detection
```gherkin
Given a client message "Хотим оформить договор на enterprise тариф и обсудить бюджет"
When PQL Detector analyzes the message
Then detection.tier = "HOT"
And detection.score >= 0.80
And "PURCHASE" is in topSignals
```

### Scenario 2: Operator message skip
```gherkin
Given a message with senderType = "OPERATOR"
When PQL Detector analyzes the message
Then analysis returns null
And no detection is persisted
```

### Scenario 3: Multi-signal WARM detection
```gherkin
Given a client message "Хотели бы посмотреть демо и узнать про интеграцию с API"
When PQL Detector analyzes the message
Then detection.tier = "WARM" or "COLD"
And "DEMO" is in signals
And "TECHNICAL" is in signals
```

### Scenario 4: Emoji stripping
```gherkin
Given a client message "🔥 Нужен Enterprise тариф! 🚀"
When PQL Detector analyzes the message
Then "ENTERPRISE" is in detection.signals
And "PRICING" is in detection.signals
```

### Scenario 5: Empty message
```gherkin
Given a client message with empty content
When PQL Detector analyzes the message
Then analysis returns null
And no detection is persisted
```

---

## 6. Future Improvements (v2)

| Priority | Improvement | Rationale |
|----------|-------------|-----------|
| HIGH | Transaction wrapping for save+update | Prevent partial state (EC-10) |
| HIGH | Deduplication by message_id | Prevent duplicate detections on retry |
| MEDIUM | Redis Streams migration (ADR-006) | Guaranteed delivery vs fire-and-forget |
| MEDIUM | Per-tenant rule customization API | Allow tenants to tune false positive rate |
| MEDIUM | Broader emoji range coverage | Address EC-12 edge cases |
| LOW | Partial regex match position tracking | Improve ML training feature extraction |
