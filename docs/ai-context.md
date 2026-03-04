# .ai-context: КоммуниК
**For:** Claude Code / AI-assisted development
**Version:** 1.0 | **Date:** 2026-03-04

---

## README.md (ai-context index)

```
.ai-context/
├── README.md                    ← этот файл
├── architecture-summary.md      ← архитектура за 1 страницу
├── key-decisions.md             ← 5 критических ADR
├── domain-glossary.md           ← ubiquitous language
├── bounded-contexts.md          ← BC карта + ответственности
├── coding-standards.md          ← соглашения команды
├── fitness-rules.md             ← what NOT to break
└── pseudocode-index.md          ← где найти алгоритмы
```

**Инструкция для Claude Code:**
> Перед реализацией любой фичи прочитай .ai-context/key-decisions.md и
> .ai-context/fitness-rules.md чтобы не нарушить архитектурные ограничения.

---

## architecture-summary.md

```markdown
# Architecture Summary: КоммуниК

## Что строим
Revenue Intelligence платформа для PLG/SaaS — поддержка как Revenue Center.
Автоматически находит горячих лидов (PQL) в диалогах поддержки.

## Архитектурный паттерн
Distributed Monolith в Monorepo.
Единый Docker Compose deployment на VPS HOSTKEY.

## Стек
- Frontend: Next.js 14 (App Router) + Tailwind + shadcn/ui
- Backend: Node.js + Express + Socket.io
- Database: PostgreSQL 16 (schema-per-BC + RLS)
- Cache/Events: Redis 7 (Streams для async events + Sessions)
- AI: MiniMax M2.5 MoE / GLM-5 via vLLM (on-premise, 152-ФЗ)
- MCP: Cloud.ru AI Fabric (amoCRM, Max, Postgres, Grafana, RAG)
- Deploy: Docker Compose → VPS → Coolify (optional)

## Bounded Contexts (6)
BC-01 Conversation   — приём сообщений всех каналов
BC-02 PQL Intelligence ⭐ CORE — детекция лидов, Memory AI
BC-03 Revenue ⭐ CORE  — атрибуция выручки, Revenue Report
BC-04 Integration     — MCP адаптеры (Cloud.ru AI Fabric)
BC-05 Identity & Access — мультитенантность, операторы
BC-06 Notifications   — PQL Pulse, email, push

## Event Flow (главный)
MessageReceived → [Redis Stream] → PQLDetector →
  [amoCRM MCP + RAG MCP] → PQLDetected →
  [WS push + Revenue Attribution + Notification]

## MCP Layer (Cloud.ru AI Fabric)
amoCRM MCP (38★)   → Memory AI + deal creation + revenue attribution
Мессенджер Max MCP (23★) → VK Max channel
Postgres MCP (7★)  → AI analytics
Grafana MCP (8★)   → monitoring
Evolution RAG MCP  → PQL knowledge base
```

---

## key-decisions.md

```markdown
# Key Architectural Decisions

## 1. Cloud.ru MCP = Integration Layer (ADR-002)
НИКОГДА не вызывать внешние API напрямую из доменного кода.
Всегда через MCP Adapter + Anti-Corruption Layer:
  src/integration/adapters/AmoCRMMCPAdapter.ts  (implements CRMPort)
  src/integration/adapters/MaxMCPAdapter.ts     (implements ChannelPort)

## 2. Rule-Based PQL v1 → ML v2 → LLM v3 (ADR-009)
v1 (сейчас): src/pql/rule-engine/ — ТОЛЬКО regex + keywords, БЕЗ LLM
v2 (>1K диалогов): добавить MLPredictor поверх RuleEngine
v3 (>10K + GPU): GLM-5 via vLLM — НЕ раньше M4

## 3. Redis Streams для async events (ADR-006)
MessageReceived НЕ ждёт PQL-детекцию.
ВСЕГДА fire-and-forget в Redis Stream → оператор получает сообщение немедленно.
PQL-флаг появляется асинхронно через WS push.

## 4. JWT + RLS для мультитенантности (ADR-007)
ВСЕГДА устанавливать SET app.tenant_id перед DB запросом.
НИКОГДА не передавать tenant_id как параметр фильтра — это делает RLS.
Middleware: src/shared/middleware/tenant.middleware.ts

## 5. Data Residency (ADR-003 + FF-10)
ЗАПРЕЩЕНО: OpenAI API / Anthropic API для production данных.
ЗАПРЕЩЕНО: любые зарубежные БД или S3 для хранения диалогов.
РАЗРЕШЕНО: on-premise vLLM + Cloud.ru AI Fabric + VPS HOSTKEY.
```

---

## domain-glossary.md

```markdown
# Domain Glossary (Ubiquitous Language)

| Term | Definition |
|------|-----------|
| **Dialog** | Сессия общения клиента с поддержкой по одному вопросу |
| **PQL** | Product-Qualified Lead — клиент с признаками готовности к покупке |
| **PQL Signal** | Конкретная фраза/паттерн = признак намерения купить |
| **PQL Score** | Число 0–1: уверенность что это лид. ≥0.80=HOT, ≥0.65=WARM |
| **PQL Tier** | HOT 🔥 / WARM / COLD — категория лида |
| **Memory AI** | Авто-подгрузка CRM-контекста до первого ответа оператора |
| **Memory Context** | Структура: CRM данные + RAG chunks + enrichment score |
| **Revenue Attribution** | Связь PQL-флага с закрытой сделкой в CRM |
| **Revenue Report** | Ежемесячный PDF: сколько выручки принесла поддержка |
| **Rule Set** | Набор regex-паттернов тенанта для PQL-детекции |
| **Enrichment Score** | 0–1: полнота CRM-контекста (0=нет данных, 1=полный) |
| **Tenant** | Компания-клиент КоммуниК |
| **Operator** | Сотрудник поддержки клиентской компании |
| **MCP Adapter** | ACL-обёртка над Cloud.ru MCP сервером |
| **Circuit Breaker** | Паттерн отказоустойчивости для MCP-запросов |
| **PQL Pulse** | Real-time push уведомление оператору о новом PQL |

## Anti-patterns (не использовать в коде)
❌ "chat" вместо "dialog"
❌ "lead score" вместо "pql score"
❌ "user" вместо "operator" или "client" (уточнять контекст)
❌ "integration" для доменной логики (только для BC-04 адаптеров)
```

---

## bounded-contexts.md

```markdown
# Bounded Contexts Quick Reference

## BC-01: Conversation
Папка: src/conversation/
Агрегаты: Dialog, Message
Ответственность: приём сообщений, маршрутизация, WS push операторам
Публикует: MessageReceived, DialogStarted, DialogClosed

## BC-02: PQL Intelligence ⭐ CORE
Папка: src/pql/
Агрегаты: PQLDetector, SignalRule
Ответственность: детекция PQL, Memory AI, ML pipeline
Потребляет: MessageReceived
Публикует: PQLDetected, PQLFeedbackRecorded

## BC-03: Revenue ⭐ CORE
Папка: src/revenue/
Агрегаты: RevenueReport, PQLAttribution
Ответственность: атрибуция выручки, PDF генерация, cron отчёты
Потребляет: PQLDetected (→ attribution), DialogClosed
Публикует: ReportGenerated, RevenueAttributed

## BC-04: Integration
Папка: src/integration/
Содержит: MCP Adapters с ACL + Circuit Breakers
НЕ содержит доменной логики — только трансляция протоколов

## BC-05: Identity & Access
Папка: src/iam/
Агрегаты: Tenant, Operator
Используется всеми BC через shared JWT middleware

## BC-06: Notifications
Папка: src/notifications/
Агрегаты: NotificationJob
Потребляет: PQLDetected, ReportGenerated, OperatorInvited

## ПРАВИЛО: Cross-BC коммуникация
✅ Через Domain Events (Redis Streams) — async
✅ Через Port interfaces (sync, из BC-02 в BC-04)
❌ Прямой импорт классов из другого BC — ЗАПРЕЩЕНО (FF-02)
```

---

## coding-standards.md

```markdown
# Coding Standards: КоммуниК

## Структура файлов (per BC)
src/{bc-name}/
  domain/
    aggregates/     ← Aggregate classes
    events/         ← Domain Event types
    ports/          ← Interface definitions (CRMPort, etc)
    value-objects/  ← Value Object classes
  application/
    services/       ← Application Services (use cases)
    handlers/       ← Event Handlers (Redis Stream consumers)
  infrastructure/
    repositories/   ← DB implementations
    adapters/       ← MCP Adapters (BC-04 only)

## Именование
- Aggregate: PascalCase, noun (Dialog, PQLDetector)
- Domain Event: PascalCase, past tense (MessageReceived, PQLDetected)
- Application Service: PascalCase + "Service" (PQLDetectorService)
- Port interface: PascalCase + "Port" (CRMPort, RAGPort)
- MCP Adapter: PascalCase + "MCPAdapter" (AmoCRMMCPAdapter)

## Git Commits (ADR)
feat(pql): add ML predictor v2 for bert fine-tune
fix(conversation): handle telegram empty message content
refactor(integration): extract circuit breaker to base adapter class
test(revenue): add attribution edge cases for draft reports
chore(docker): update vllm image to 0.4.2

## TypeScript
- strict: true в tsconfig
- Явные типы для domain events
- Запрещены: any, as any, @ts-ignore без комментария
- Value Objects: readonly fields, no setters

## Error Handling
- Domain errors: throw DomainException(code, message)
- MCP errors: catch → Circuit Breaker → return Result<T, Error>
- Никогда не пробрасывать MCP errors в доменный слой
```

---

## fitness-rules.md

```markdown
# Fitness Rules — что НЕЛЬЗЯ сломать

## CRITICAL (блокируют деплой)
FF-01: PQL detection latency < 2000ms p95
FF-03: Tenant RLS isolation 100%
FF-10: Data residency — только российские VPS

## HIGH (блокируют merge PR)
FF-02: No cross-BC imports (ESLint)
FF-04: Circuit Breaker на каждом MCP адаптере
FF-05: RuleEngine coverage ≥ 95%
FF-08: Redis Stream lag < 1000

## MEDIUM (warning в CI)
FF-06: PDF generation < 30s
FF-07: Aggregate size ≤ 100 messages
FF-09: amoCRM MCP < 700ms p95

## Запуск проверок
npm run fitness          # все fitness functions
npm run fitness:critical # только CRITICAL
npm run lint:arch        # BC isolation check
```

---

## pseudocode-index.md

```markdown
# Pseudocode Index

| PS-ID | Функция | Файл реализации | SLA |
|-------|---------|-----------------|-----|
| PS-01 | PQLDetectorService.analyze() | src/pql/application/services/PQLDetectorService.ts | <2с |
| PS-02 | RuleEngine.analyze() | src/pql/domain/RuleEngine.ts | <50ms |
| PS-03 | MemoryAIService.fetchContext() | src/pql/application/services/MemoryAIService.ts | <800ms |
| PS-04 | Dialog.receiveMessage() | src/conversation/domain/aggregates/Dialog.ts | <100ms |
| PS-05 | RevenueReport.generate() | src/revenue/application/services/RevenueReportService.ts | <30s |
| PS-06 | AmoCRMMCPAdapter | src/integration/adapters/AmoCRMMCPAdapter.ts | <700ms |
| PS-07 | recordPQLFeedback() | src/pql/application/services/PQLFeedbackService.ts | <200ms |

Полный pseudocode: docs/pseudocode/pseudocode.md
```
