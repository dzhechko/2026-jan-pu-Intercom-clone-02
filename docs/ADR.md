# Architecture Decision Records: КоммуниК
**Version:** 1.0 | **Date:** 2026-03-04

---

## ADR-001: Distributed Monolith в Monorepo
**Status:** Accepted | **Deciders:** Core team

### Context
Команда 2–3 человека, нужна скорость разработки и простота деплоя, но с чёткими модульными границами для будущего масштабирования.

### Decision
Distributed Monolith — единый deployable artifact с внутренними модульными границами (BC как отдельные папки/пакеты), общая БД с разделёнными схемами per-BC.

### Consequences
- ✅ Один Docker Compose, простой деплой на VPS
- ✅ Нет network overhead между BC
- ✅ Shared Postgres — без распределённых транзакций
- ✅ Чёткие модульные границы — готово к декомпозиции при росте
- ⚠️ При масштабировании (>20 разработчиков) потребуется декомпозиция на сервисы

---

## ADR-002: Cloud.ru MCP Servers как Integration Layer
**Status:** Accepted | **Deciders:** Core team

### Context
Нужны интеграции с amoCRM, Мессенджер Max, Grafana, PostgreSQL. Можно писать custom REST/API клиенты или использовать готовые MCP-шаблоны Cloud.ru AI Fabric.

### Decision
Использовать готовые Cloud.ru MCP серверы через MCP Client Layer с Anti-Corruption Layer поверх:
- amoCRM MCP (38★) — CRM интеграция
- Мессенджер Max MCP (23★) — VK Max канал
- Postgres MCP (7★, 133 uses) — AI analytics layer
- Grafana MCP (8★, 85 uses) — monitoring
- Evolution RAG MCP (1★, 49 uses) — knowledge base

### Alternatives Considered
| Option | Pros | Cons |
|--------|------|------|
| Custom REST adapters | Полный контроль | +3–4 недели разработки |
| Direct MCP без ACL | Быстро | Coupling к деталям протокола |
| **Cloud.ru MCP + ACL** | Production-ready, ~35% меньше кода | Зависимость от Cloud.ru uptime |

### Consequences
- ✅ ~35% меньше кастомного кода интеграций
- ✅ Проверенные production-ready коннекторы
- ✅ Стандартный MCP протокол — легко заменить адаптер
- ⚠️ Зависимость от Cloud.ru AI Fabric uptime → Circuit Breaker обязателен (ADR-008)

---

## ADR-003: MiniMax M2.5 / GLM-5 (MoE) + Mistral Small on-premise
**Status:** Accepted | **Deciders:** Core team

### Context
Нужен LLM для PQL-обнаружения (v2+) и Memory AI enrichment. Данные клиентов — персональные переписки, нельзя отправлять на OpenAI/Anthropic.

### Decision
On-premise inference через vLLM:
- GLM-5 / MiniMax M2.5 MoE для reasoning (10–44B active / 230–744B total)
- Mistral Small 24B для validation
- Деплой на GPU-узле VPS HOSTKEY или Cloud.ru Evolution

**Progressive Enhancement:**
- v1 (М1–3): rule-based, без GPU
- v2 (М4+): fine-tuned BERT/E5 на CPU
- v3 (М9+): full LLM inference на GPU

### Consequences
- ✅ 152-ФЗ compliance — данные не покидают российский контур
- ✅ Нет per-token costs при масштабировании
- ✅ v1 запускается без GPU (rule-based)
- ⚠️ GPU сервер ~₽30–50K/мес для v3

---

## ADR-004: PostgreSQL 16 как единая БД с schema-per-BC
**Status:** Accepted | **Deciders:** Core team

### Context
Нужна надёжная реляционная БД с поддержкой JSON для гибких данных диалогов.

### Decision
PostgreSQL 16 с отдельными схемами:
- `conversations` — диалоги, сообщения
- `pql` — детекции, правила, ML данные
- `revenue` — отчёты, атрибуции
- `integrations` — sync state, webhook logs
- `iam` — тенанты, операторы
- `notifications` — jobs, delivery log

Row-Level Security на tenant_id для изоляции данных.

### Consequences
- ✅ ACID транзакции, простой backup
- ✅ JSONB для гибких CRM-данных
- ✅ RLS — изоляция без application-level фильтров
- ✅ Postgres MCP как out-of-the-box analytics layer для AI

---

## ADR-005: WebSocket (Socket.io) для real-time Operator Workspace
**Status:** Accepted | **Deciders:** Core team

### Context
Operator Workspace требует real-time: новые сообщения, PQL-флаги, назначения — без polling.

### Decision
Socket.io поверх Node.js с Redis adapter для multi-instance. Namespace per tenant для изоляции.

### Consequences
- ✅ <500ms latency p95 для сообщений
- ✅ PQL Pulse доставка real-time
- ✅ Redis уже в стеке (ADR-006)
- ⚠️ Redis required — добавляем в Docker Compose

---

## ADR-006: Redis Streams для Event-Driven между BC
**Status:** Accepted | **Deciders:** Core team

### Context
PQL-обнаружение не должно блокировать доставку сообщения оператору. Нужен async event bus.

### Decision
Redis Streams (lightweight, нет Kafka overhead для v1):
- `MessageReceived` event → PQL Detector subscribes
- `PQLDetected` event → Websocket push + Revenue

### Alternatives Considered
| Option | Reasoning |
|--------|-----------|
| Kafka | Overkill для v1, сложный деплой |
| RabbitMQ | Избыточно для внутренних событий |
| **Redis Streams** | Redis уже в стеке, прост в использовании |
| In-process events | Не работает при horizontal scaling |

### Consequences
- ✅ Message delivery не зависит от PQL latency
- ✅ Redis уже используется для WS (ADR-005)
- ✅ Простой upgrade до Kafka при масштабировании

---

## ADR-007: JWT + Row-Level Security для мультитенантности
**Status:** Accepted | **Deciders:** Core team

### Context
SaaS продукт — каждый клиент изолирован, данные не смешиваются.

### Decision
JWT с `tenant_id` claim. Row-level security в PostgreSQL через `SET app.tenant_id`. Middleware инжектирует tenant в каждый запрос.

### Consequences
- ✅ Изоляция данных на уровне БД — не зависит от application bugs
- ✅ Простая реализация, стандартный паттерн
- ⚠️ При миграции на микросервисы нужен API Gateway

---

## ADR-008: Anti-Corruption Layer + Circuit Breaker для каждого MCP
**Status:** Accepted | **Deciders:** Core team

### Context
MCP-протокол и API внешних систем (amoCRM, Max) могут меняться. Доменная логика не должна зависеть от деталей транспорта.

### Decision
Каждый MCP-клиент оборачивается в интерфейс с доменными типами. Circuit Breaker (opossum) на каждом адаптере с fallback.

```typescript
// Domain port (BC-02 PQL Intelligence)
interface CRMPort {
  getContactContext(email: string): Promise<ContactContext>
  createDeal(pql: PQLSignal): Promise<DealId>
}

// Adapter (BC-04 Integration)
class AmoCRMMCPAdapter implements CRMPort {
  // wraps Cloud.ru amoCRM MCP calls
  // Circuit Breaker: failover <30 сек
}
```

### Consequences
- ✅ Доменная логика не зависит от MCP-деталей
- ✅ Легко заменить MCP на custom adapter
- ✅ Circuit Breaker предотвращает cascade failures

---

## ADR-009: Rule-Based PQL v1 → ML v2 → LLM v3 (Progressive Enhancement)
**Status:** Accepted | **Deciders:** Core team

### Context
ML-модель требует данных для обучения. В v1 данных нет. LLM inference требует GPU.

### Decision
Прогрессивное улучшение PQL accuracy:

| Phase | Tech | Accuracy | Trigger |
|-------|------|:--------:|---------|
| v1 (М1–3) | 15+ rule-based (regex + keywords) | ≥65% | Launch |
| v2 (М4+) | Fine-tune BERT/E5 на реальных данных | ≥75% | >1K диалогов |
| v3 (М9+) | GLM-5 Intent Detection via vLLM | ≥85% | >10K диалогов + GPU |

### Consequences
- ✅ Можно запустить v1 без GPU и ML-инфраструктуры
- ✅ Реальные данные > синтетики для обучения
- ✅ Каждый уровень улучшает предыдущий — нет ребилда

---

## ADR-010: Puppeteer для Revenue Intelligence Report PDF
**Status:** Accepted | **Deciders:** Core team

### Context
Revenue Report — ключевой retention-механизм. Должен выглядеть профессионально, с брендингом.

### Decision
Puppeteer (headless Chrome) для рендера HTML/React-шаблона в PDF. Генерация по крону 1-го числа месяца.

### Consequences
- ✅ Полный контроль над дизайном (React + Tailwind)
- ✅ Кастомный брендинг клиента (COULD HAVE)
- ⚠️ Puppeteer ~512MB RAM — учесть в VPS конфигурации

---

## ADR-011: Next.js 14 (App Router) для Operator Workspace + Admin
**Status:** Accepted | **Deciders:** Core team

### Context
Нужен быстрый фронтенд с real-time для Operator WS и SSR для Admin Dashboard.

### Decision
Next.js 14 App Router + Tailwind CSS + shadcn/ui:
- Operator Workspace — Client Components + Socket.io
- Admin Dashboard — Server Components + PostgreSQL direct
- Chat Widget — отдельный vanilla JS bundle (iframe/embed)

### Consequences
- ✅ Единый стек для WS + Dashboard
- ✅ Server Components для быстрой загрузки Dashboard
- ✅ shadcn/ui — production-ready компоненты

---

## ADR-012: Docker Compose + VPS HOSTKEY для деплоя
**Status:** Accepted | **Deciders:** Core team

### Context
Команда маленькая, Kubernetes — overkill для v1. Нужна простота и воспроизводимость.

### Decision
Docker Compose с сервисами: `app` (Next.js+Node), `postgres`, `redis`, `vllm` (GPU, отдельный сервер при необходимости). Деплой: SSH + `docker compose pull && docker compose up -d`.

### Services
```yaml
services:
  app:         # Next.js 14 + Node.js API + Socket.io
  postgres:    # PostgreSQL 16
  redis:       # Redis 7 (Streams + Sessions)
  worker:      # Cron jobs (Revenue Reports)
  # vllm:      # GPU inference — опционально с M4+
```

### Consequences
- ✅ `docker compose up` — вся система за 1 команду
- ✅ Простой rollback: `docker compose pull previous-tag`
- ✅ Coolify как опциональный orchestrator поверх
- ⚠️ При >5K concurrent users — миграция на K8s
