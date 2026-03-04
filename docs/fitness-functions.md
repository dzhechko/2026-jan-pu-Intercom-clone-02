# Fitness Functions: КоммуниК
**Version:** 1.0 | **Date:** 2026-03-04
**Purpose:** Автоматически верифицируемые архитектурные ограничения

---

## FF-01: PQL Detection Latency
**Category:** Performance | **Priority:** CRITICAL

```
RULE: time(MessageReceived → PQLDetected) < 2000ms
MEASURED: p95 latency по всем PQL-детекциям за последние 24ч
TARGET: < 2000ms
ALERT_THRESHOLD: > 2500ms → PagerDuty critical
MEASUREMENT: Redis Stream timestamp diff (MessageReceived.ts → PQLDetected.ts)

IMPLEMENTATION:
  metrics.histogram('pql.detection.latency_ms')
    .labels({ tenant_id, tier })
    .observe(detectionTime - messageTime)

  PromQL alert:
    histogram_quantile(0.95, rate(pql_detection_latency_ms_bucket[5m])) > 2000
```

---

## FF-02: Bounded Context Independence
**Category:** Architecture | **Priority:** HIGH

```
RULE: BC модули не импортируют напрямую из других BC
MEASURED: Static analysis (import paths)
TARGET: 0 прямых cross-BC импортов
ENFORCEMENT: ESLint rule + pre-commit hook

RULE DEFINITION:
  // .eslintrc
  "no-restricted-imports": [
    "error",
    {
      patterns: [
        "*/conversation/**" в pql/** → запрещено
        "*/pql/**" в conversation/** → запрещено
        "*/revenue/**" в pql/** → запрещено
        // Разрешены только domain events (shared/events/*)
      ]
    }
  ]

  EXCEPTION: shared/events/*.ts (domain event types — shared kernel)
```

---

## FF-03: Tenant Data Isolation (RLS Verification)
**Category:** Security | **Priority:** CRITICAL

```
RULE: Запрос с tenant_id=A никогда не возвращает записи tenant_id=B
MEASURED: Integration test suite (запускается в CI)
TARGET: 100% тестов проходят

TEST IMPLEMENTATION:
  describe("RLS Isolation") {
    it("tenant A cannot see tenant B dialogs") {
      setTenantContext("tenant-A")
      result = db.query("SELECT * FROM conversations.dialogs")
      expect(result.every(d => d.tenant_id === "tenant-A")).toBe(true)
      expect(result.none(d => d.tenant_id === "tenant-B")).toBe(true)
    }

    it("direct UUID access to other tenant dialog returns empty") {
      setTenantContext("tenant-A")
      result = db.query("SELECT * FROM conversations.dialogs WHERE id=$1",
                        [TENANT_B_DIALOG_UUID])
      expect(result).toBeEmpty()
    }
  }

CI: runs on every PR, blocks merge on failure
```

---

## FF-04: MCP Circuit Breaker Coverage
**Category:** Resilience | **Priority:** HIGH

```
RULE: Каждый MCP-адаптер имеет Circuit Breaker с timeout < 3000ms
MEASURED: Unit test coverage + runtime metrics
TARGET: 100% адаптеров покрыты + timeout соблюдается

VERIFICATION:
  Test: each MCPAdapter class must have circuitBreaker instance
  Test: circuitBreaker.timeout <= 3000
  Test: when MCP returns 503 → circuit transitions to OPEN after 3 failures
  Test: when circuit OPEN → adapter returns fallback (not throws)

RUNTIME METRIC:
  metrics.gauge('mcp.circuit_breaker.state')
    .labels({ adapter: 'amocrm' | 'max' | 'grafana' | 'rag' | 'postgres' })
    .set(state === 'OPEN' ? 1 : 0)

ALERT: any circuit OPEN > 5 minutes → Slack #alerts
```

---

## FF-05: PQL Rule Engine Test Coverage
**Category:** Quality | **Priority:** HIGH

```
RULE: RuleEngine покрыт тестами для всех 15+ правил
MEASURED: Jest coverage report
TARGET: ≥ 95% line coverage для src/pql/rule-engine/**

REQUIRED TESTS per rule:
  - positive match (rule fires correctly)
  - negative match (rule does NOT fire on unrelated text)
  - case insensitive match
  - weight contribution to final score

MEASUREMENT:
  jest --coverage --collectCoverageFrom="src/pql/rule-engine/**"
  ASSERT: lines >= 95, functions >= 100, branches >= 90

CI: blocks PR if coverage drops below threshold
```

---

## FF-06: Revenue Report PDF Generation SLA
**Category:** Performance | **Priority:** MEDIUM

```
RULE: PDF генерация для тенанта < 30 секунд
MEASURED: Worker execution time per tenant report
TARGET: < 30000ms для любого тенанта

IMPLEMENTATION:
  const start = Date.now()
  await PDFGenerator.render(...)
  const duration = Date.now() - start

  metrics.histogram('revenue.pdf_generation_ms').observe(duration)
  if (duration > 30000) {
    LOG.error('PDF generation exceeded SLA', { tenantId, duration })
    ALERT.send('revenue-report-slow', { tenantId, duration })
  }

ALERT_THRESHOLD: > 45000ms → PagerDuty warning
```

---

## FF-07: Aggregate Size Constraint
**Category:** Architecture | **Priority:** MEDIUM

```
RULE: Dialog aggregate не загружает более 100 messages в память
MEASURED: Static code analysis + runtime assertion
TARGET: 0 нарушений

RATIONALE: Предотвратить memory bloat при работе с длинными диалогами

IMPLEMENTATION:
  // Dialog.loadMessages() — pagination enforced
  ASSERT: pageSize <= 100
  ASSERT: Dialog.messages array never exceeds 100 in-memory

  Static analysis: grep for "messages.findAll()" without LIMIT → fail CI
  Runtime: if messages.length > 100 throw DomainException("use pagination")
```

---

## FF-08: Redis Stream Consumer Lag
**Category:** Performance | **Priority:** HIGH

```
RULE: PQL consumer lag (разница между produced и consumed) < 1000 сообщений
MEASURED: Redis XPENDING команда каждые 30 секунд
TARGET: pending_count < 1000

PromQL / custom metric:
  metrics.gauge('redis.stream.pql_lag')
    .set(await redis.xpending('conversations.messages', 'pql-group'))

ALERT: lag > 500 → Slack warning
ALERT: lag > 1000 → PagerDuty critical (PQL detection backlog)

RESPONSE PLAN:
  lag > 1000: горизонтальное масштабирование PQL consumer instances
```

---

## FF-09: amoCRM MCP Response Time
**Category:** Performance | **Priority:** MEDIUM

```
RULE: amoCRM MCP getContactContext() < 700ms p95
MEASURED: Adapter call latency
TARGET: p95 < 700ms

metrics.histogram('mcp.amocrm.response_ms').observe(responseTime)

PromQL:
  histogram_quantile(0.95, rate(mcp_amocrm_response_ms_bucket[5m])) > 700
  → alert: "amoCRM MCP degraded — Memory AI enrichment affected"
```

---

## FF-10: Data Residency Compliance
**Category:** Security/Compliance | **Priority:** CRITICAL

```
RULE: Все данные диалогов и персональные данные хранятся на российских VPS
MEASURED: Infrastructure audit (manual + automated)
TARGET: 0 данных на зарубежных серверах

AUTOMATED CHECKS:
  1. docker-compose.yml: все сервисы используют локальные volumes (не S3 зарубежный)
  2. .env validation: DATABASE_URL содержит только российские IP/hostnames
  3. amoCRM MCP: data flows через Cloud.ru (российская инфраструктура)
  4. Resend API: используется только для метаданных (email без PD)

MANUAL AUDIT: ежеквартально, отчёт в docs/compliance/

CRITICAL RULE: запрещено использовать OpenAI/Anthropic API для обработки
  production диалогов — только on-premise vLLM или Cloud.ru LLM
```

---

## Fitness Functions Summary

| ID | Rule | Category | Priority | Automated |
|----|------|----------|:--------:|:---------:|
| FF-01 | PQL Detection < 2000ms p95 | Performance | CRITICAL | ✅ Prometheus |
| FF-02 | BC Independence (no cross-imports) | Architecture | HIGH | ✅ ESLint CI |
| FF-03 | Tenant RLS Isolation 100% | Security | CRITICAL | ✅ Integration tests |
| FF-04 | MCP Circuit Breaker Coverage 100% | Resilience | HIGH | ✅ Unit tests |
| FF-05 | RuleEngine Coverage ≥95% | Quality | HIGH | ✅ Jest CI |
| FF-06 | PDF Generation < 30s | Performance | MEDIUM | ✅ Metrics |
| FF-07 | Aggregate Size ≤100 messages | Architecture | MEDIUM | ✅ Static analysis |
| FF-08 | Redis Stream Lag < 1000 | Performance | HIGH | ✅ Redis metrics |
| FF-09 | amoCRM MCP < 700ms p95 | Performance | MEDIUM | ✅ Prometheus |
| FF-10 | Data Residency (RU VPS only) | Compliance | CRITICAL | ⚠️ Partial |

**Automated:** 9/10 | **Manual audit required:** FF-10 (quarterly)
