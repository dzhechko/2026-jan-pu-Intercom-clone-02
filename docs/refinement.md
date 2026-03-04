# Refinement: КоммуниК
**Version:** 1.0 | **Date:** 2026-03-04
**Purpose:** Технические риски, edge cases, открытые вопросы, решения

---

## R-01: Технические риски и митигация

| ID | Риск | Вероятность | Impact | Митигация |
|----|------|:-----------:|:------:|-----------|
| TR-01 | amoCRM MCP недоступен → Memory AI не работает | Средняя | Средний | Circuit Breaker + fallback без контекста (FR-01 работает без enrichment) |
| TR-02 | Telegram Bot API rate limit (30 msg/sec per bot) | Низкая | Высокий | Queue + backoff; при масштабировании — несколько Bot tokens |
| TR-03 | PQL v1 accuracy ниже 65% на реальных данных | Средняя | Средний | A/B test правил первые 2 недели; оператор feedback для быстрой итерации |
| TR-04 | Puppeteer memory leak при генерации PDF | Низкая | Средний | Изолировать в отдельный процесс; restart worker после N reports |
| TR-05 | PostgreSQL RLS не применяется если middleware пропущен | Низкая | Критический | Integration test FF-03 в CI; audit middleware применения |
| TR-06 | Redis Stream overflow при высокой нагрузке | Низкая | Высокий | MAXLEN на stream (retain last 10K); FF-08 monitoring |
| TR-07 | amoCRM API schema change → ACL поломан | Средняя | Средний | Версионирование MCP endpoints; smoke tests после deploy |
| TR-08 | vLLM GPU node недоступен (v3+) | Средняя | Средний | v1/v2 работают без GPU; graceful degradation |

---

## R-02: Edge Cases — PQL Detection

### EC-01: Одновременные сообщения (race condition)
```
Проблема: клиент отправляет 3 сообщения за 1 секунду
Каждое MessageReceived триггерит analyze() параллельно
Возможен дублирующийся PQL_Detected

Решение:
  - Dialog-level lock через Redis SETNX на анализ (TTL 5s)
  - Дедупликация в PQLDetectionRepository:
    IF detection EXISTS for (dialogId, messageId) → skip
  - PQL Pulse throttle: 1 уведомление per dialog per 30 мин
```

### EC-02: Очень длинные сообщения (>5000 символов)
```
Проблема: performance RuleEngine на больших текстах
Решение:
  - Анализировать только первые 2000 символов
  - Если message.content.length > 5000 → slice + LOG.warn
  - Fitness Function FF-07 предотвращает загрузку >100 messages
```

### EC-03: Unicode и эмодзи в сообщениях
```
Проблема: /команда/i regex может не матчить если эмодзи рядом
Решение:
  - Нормализовать текст: strip emoji, trim, normalize whitespace
  - Добавить тест для Unicode в RuleEngine test suite
```

### EC-04: amoCRM MCP возвращает частичные данные
```
Проблема: MCP ответил, но deals = null (timeout на upstream)
Решение:
  - Validate each field individually
  - Partial MemoryContext с enrichmentScore 0.3 (лучше, чем 0)
  - НЕ падать — деградировать gracefully
```

### EC-05: Revenue Attribution без email у клиента
```
Проблема: диалог создан без contactEmail → amoCRM lookup невозможен
Решение:
  - Оператор может вручную привязать CRM-контакт (UI в v1.1)
  - В v1: attribution только для диалогов с email
  - Report показывает "X диалогов без атрибуции (нет email)"
```

---

## R-03: Security Hardening

### SH-01: API Keys хранение (TenantSettings.crmIntegration)
```
Проблема: amoCRM API key нельзя хранить в открытом виде в PostgreSQL

Решение:
  - Шифрование: AES-256-GCM через Node.js crypto (Web Crypto API)
  - Ключ шифрования: из переменной окружения ENCRYPTION_KEY (не в БД)
  - В памяти: расшифровывается только при MCP запросе, immediately zeroed
  - В логах: НИКОГДА не логировать apiKey (даже частично)

Implementation:
  src/shared/utils/encryption.ts:
    encrypt(plaintext: string, key: Buffer): EncryptedValue
    decrypt(encrypted: EncryptedValue, key: Buffer): string
```

### SH-02: PII в диалогах
```
Проблема: клиенты могут отправлять персональные данные (паспорт, карты)

v1: Rate limit + Operator awareness (UI badge "possible PII")
v2 (M4+): SpaCy NER для маскировки PII до сохранения в БД
НИКОГДА не отправлять raw диалоги в зарубежные LLM API
```

### SH-03: Rate Limiting
```
API endpoints:
  /api/dialogs: 100 req/min per operator
  /api/pql/feedback: 300 req/min per operator
  WebSocket: 50 events/sec per tenant namespace
  Chat Widget: 10 msg/min per session (anti-spam)

Implementation: express-rate-limit + Redis store
```

### SH-04: Webhook Verification
```
Telegram Bot webhooks: HMAC-SHA256 signature verification
amoCRM webhooks: shared secret in header
Max MCP webhooks: MCP protocol authentication

REJECT любой webhook без верификации → HTTP 401
```

---

## R-04: Performance Optimizations

### PO-01: PQL Analysis — Parallel execution
```
Текущий порядок в PS-01:
  PARALLEL: [RuleEngine.analyze(), MemoryAIService.fetchContext()]
  
Дополнительно:
  - MemoryAIService results: Redis cache TTL=600s
  - RuleSet: in-memory cache TTL=300s (detector per tenant)
  - Compiled regex: кешируются при старте (не re-compile на каждый запрос)
```

### PO-02: Database Query Optimization
```
Обязательные индексы (уже в tactical-design.md):
  conversations.dialogs: (tenant_id, status)
  conversations.dialogs: (tenant_id, pql_tier) WHERE pql_tier IS NOT NULL
  pql.detections: (tenant_id, tier, created_at DESC)
  revenue.attributions: (tenant_id, report_id)
  notifications.jobs: (status, created_at) WHERE status = 'PENDING'

EXPLAIN ANALYZE на все запросы Workspace Queue перед релизом
```

### PO-03: Socket.io Namespace Optimization
```
Проблема: broadcast ко всем операторам тенанта при каждом сообщении

Решение:
  - Namespace per tenant: io.of(`/tenant-${tenantId}`)
  - Room per operator: socket.join(`operator-${operatorId}`)
  - PQL Pulse: только назначенному оператору (targeted emit)
  - Новое сообщение: в room очереди (все операторы тенанта)
```

---

## R-05: MVP Scope Guard (что НЕ делаем в v1)

```
❌ Email marketing automation (другой продукт)
❌ Voice/video support (нет спроса на старте)
❌ White-label reselling (слишком рано)
❌ Bitrix24 интеграция (FR-18, COULD HAVE — только если клиент требует)
❌ AI Auto-Reply (FR-16, COULD HAVE — после валидации core)
❌ Grafana MCP dashboard (FR-17, COULD HAVE — enterprise feature)
❌ Multi-language UI (только RU в v1)
❌ Mobile app (Web responsive достаточно)
❌ Full-text search по диалогам (простой фильтр достаточно)
❌ LLM inference (только rule-based PQL в v1)
```

---

## R-06: Open Questions (требуют решения до реализации)

| ID | Вопрос | Дедлайн | Ответственный |
|----|--------|:-------:|--------------|
| OQ-01 | Как amoCRM MCP обрабатывает tenant с разными поддоменами? (один tenant = один поддомен или несколько?) | До M1 Sprint 2 | Tech lead |
| OQ-02 | Мессенджер Max MCP поддерживает получение входящих сообщений через polling или webhook? | До M1 | Tech lead |
| OQ-03 | Telegram Business API vs Bot API — что использовать для корпоративных клиентов? | До M1 Sprint 3 | Product |
| OQ-04 | Revenue Attribution confidence: как считать если между PQL-флагом и закрытием сделки > 90 дней? | До M3 | Product |
| OQ-05 | Нужен ли offline PDF для Revenue Report или только email + web view? | До M2 | Product |

---

## R-07: Technology Versions (зафиксировать)

```yaml
Runtime:
  node: "20.x LTS"
  typescript: "5.4.x"

Frontend:
  next: "14.2.x"
  tailwindcss: "3.4.x"
  socket.io-client: "4.7.x"
  "@shadcn/ui": latest compatible

Backend:
  express: "4.19.x"
  socket.io: "4.7.x"
  pg: "8.11.x"            # node-postgres
  ioredis: "5.3.x"
  opossum: "8.1.x"        # Circuit Breaker
  puppeteer: "22.x"
  jsonwebtoken: "9.0.x"
  zod: "3.22.x"           # validation

Testing:
  jest: "29.x"
  supertest: "6.x"

Infrastructure:
  postgres: "16-alpine"
  redis: "7-alpine"
  nginx: "1.25-alpine"
```
