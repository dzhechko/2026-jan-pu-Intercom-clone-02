# Архитектура КоммуниК

## Обзор

КоммуниК -- Revenue Intelligence Platform, превращающая службу поддержки PLG/SaaS компаний из центра затрат в источник выручки. Автоматически обнаруживает Product-Qualified Leads (PQL) в диалогах поддержки и атрибутирует выручку.

**Паттерн:** Distributed Monolith (монорепо)
**Деплой:** Docker Compose на VPS HOSTKEY (Россия, 152-ФЗ)

## Технологический стек

```
Frontend:  Next.js 14.2.x + Tailwind 3.4.x + shadcn/ui + Socket.io-client 4.7.x
Backend:   Express 4.19.x + Socket.io 4.7.x + TypeScript 5.4.x
Database:  PostgreSQL 16-alpine + Row-Level Security
Cache:     Redis 7-alpine (кеш, streams, presence)
Proxy:     Nginx 1.25-alpine (SSL, rate limiting, WebSocket proxy)
AI:        Rule-based PQL v1 → ML v2 → GLM-5/vLLM v3 (on-premise)
MCP:       Cloud.ru AI Fabric (amoCRM, Max, Postgres, Grafana, RAG)
Testing:   Jest 29.x + Supertest 6.x (319 тестов, 16 сьютов)
```

## 6 Bounded Contexts

### BC-01: Conversation (Диалоги)

**Ответственность:** Прием сообщений, маршрутизация, WebSocket взаимодействие.

- Прием сообщений из всех каналов (виджет, Telegram, VK Max)
- Создание и управление диалогами
- Назначение диалогов операторам
- WebSocket для обновлений в реальном времени

**Ключевые агрегаты:** `Dialog`, `Message`
**События:** `MessageReceived`, `DialogCreated`, `DialogAssigned`, `DialogClosed`

### BC-02: PQL Intelligence (Ключевой)

**Ответственность:** Обнаружение PQL, Memory AI, ML пайплайн.

- Rule Engine с 15+ стандартными сигналами
- PQL Score расчет (0-1, пороги: HOT >= 0.80, WARM >= 0.65)
- Memory AI -- загрузка CRM контекста через amoCRM MCP
- Обратная связь от операторов для улучшения точности

**Ключевые агрегаты:** `PQLDetector`, `RuleEngine`
**Значимые объекты:** `PQLScore`, `PQLSignal`, `MemoryContext`
**События:** `PQLDetected`, `PQLFeedbackReceived`

### BC-03: Revenue (Ключевой)

**Ответственность:** Атрибуция выручки, Revenue Report, дашборд.

- Связка PQL-флага с закрытой CRM сделкой
- Revenue Intelligence Report (выручка через поддержку)
- Аналитический дашборд с графиками и метриками
- Экспорт отчетов

**Ключевые агрегаты:** `RevenueAttribution`, `RevenueReport`
**События:** `RevenueAttributed`, `ReportGenerated`

### BC-04: Integration (MCP слой)

**Ответственность:** MCP адаптеры с ACL и Circuit Breaker.

- amoCRM MCP адаптер (Memory AI, создание сделок, синхронизация)
- Мессенджер Max MCP адаптер (канал VK Max)
- Postgres MCP адаптер (AI аналитика)
- Grafana MCP адаптер (мониторинг)
- Evolution RAG MCP адаптер (база знаний, авто-ответы)

**Паттерны:** Circuit Breaker (opossum), ACL, Timeout <= 3000ms

### BC-05: Identity & Access (IAM)

**Ответственность:** Мульти-тенантность, JWT, RLS.

- Регистрация и аутентификация
- JWT токены с tenant_id и role
- Row-Level Security middleware
- Управление операторами и ролями

**Ключевые агрегаты:** `Tenant`, `Operator`

### BC-06: Notifications

**Ответственность:** PQL Pulse, email, push-уведомления.

- WebSocket уведомления в реальном времени
- Email уведомления через Resend (только метаданные, без PII)
- Telegram уведомления в рабочие группы
- Тихие часы, минимальный тир для отправки

## Event Flow

Основной поток обработки событий:

```
Клиент отправляет сообщение
        |
        v
[MessageReceived] → Redis Stream (fire-and-forget)
        |
        v
    PQL Detector (Consumer Group: pql-workers)
        |
        +--→ Rule Engine (15+ правил, параллельно)
        |
        +--→ Memory AI (amoCRM MCP, параллельно)
        |
        v
  PQL Score расчет
        |
   [PQLDetected] → Redis Stream
        |
        +--→ WebSocket Push (оператору в реальном времени)
        |
        +--→ Revenue Attribution (связка с CRM сделкой)
        |
        +--→ Notification (PQL Pulse: email/Telegram)
```

**Важно:** `MessageReceived` НЕ ждет завершения PQL детекции. Это асинхронная fire-and-forget обработка через Redis Streams.

## Архитектурные решения (ADR)

| ADR | Решение | Суть |
|-----|---------|------|
| ADR-001 | Distributed Monolith | Монорепо с логическими BC, единый деплой |
| ADR-002 | Cloud.ru MCP = Integration Layer | Никогда не вызывать внешние API из доменного кода |
| ADR-003 | Data Residency | Только российские VPS, запрет иностранных LLM API |
| ADR-004 | PostgreSQL + RLS | Мульти-тенантность через RLS, не отдельные БД |
| ADR-005 | Socket.io для реалтайма | WebSocket с fallback на polling |
| ADR-006 | Redis Streams | Асинхронная обработка событий, Consumer Groups |
| ADR-007 | JWT + RLS middleware | `SET app.tenant_id` перед каждым запросом к БД |
| ADR-008 | Circuit Breaker на MCP | opossum, timeout 3s, fallback при открытом circuit |
| ADR-009 | PQL v1 Rule-based | Сначала regex, ML после 1K диалогов, LLM после 10K |
| ADR-010 | shadcn/ui | Кастомизируемые компоненты, Tailwind |
| ADR-011 | Resend для email | Только метаданные, PII не покидает VPS |
| ADR-012 | Docker Compose деплой | Прямой деплой на VPS, без Kubernetes |

## MCP интеграция

Все внешние интеграции проходят через Cloud.ru AI Fabric:

```
Domain Code → Port Interface → MCP Adapter (ACL) → Cloud.ru MCP Server
                                    |
                              Circuit Breaker
                              Timeout <= 3s
                              Fallback on failure
```

| MCP сервер | Назначение | Приоритет |
|------------|-----------|-----------|
| amoCRM MCP | Memory AI, сделки, атрибуция | MUST |
| Мессенджер Max MCP | Канал VK Max | SHOULD |
| Postgres MCP | AI аналитика | SHOULD |
| Grafana MCP | Мониторинг | COULD |
| Evolution RAG MCP | База знаний, авто-ответы | COULD |

## Fitness Functions

### Критические (блокируют деплой)

| FF | Метрика | Порог | Описание |
|----|---------|-------|----------|
| FF-01 | PQL detection latency | < 2000ms p95 | Детекция не должна замедлять обработку |
| FF-03 | Tenant RLS isolation | 100% | Тенант A никогда не видит данные тенанта B |
| FF-10 | Data residency | Russian VPS only | Запрет иностранных LLM API для prod данных |

### Высокие (блокируют merge)

| FF | Метрика | Порог |
|----|---------|-------|
| FF-02 | Cross-BC imports | 0 нарушений |
| FF-04 | Circuit Breaker coverage | 100% MCP адаптеров |
| FF-05 | RuleEngine test coverage | >= 95% |
| FF-08 | Redis Stream lag | < 1000 сообщений |

## Безопасность

### Аутентификация и авторизация

- JWT токены содержат `tenant_id` и `role`
- Middleware автоматически устанавливает `SET app.tenant_id` для RLS
- Две роли: ADMIN (полный доступ) и OPERATOR (диалоги + PQL feedback)

### Шифрование

- API ключи (amoCRM, Telegram) зашифрованы AES-256-GCM
- Ключ шифрования -- переменная окружения `ENCRYPTION_KEY`
- Расшифровка только в момент MCP запроса, затем очистка памяти

### Rate Limiting

```
/api/dialogs:        100 req/min на оператора
/api/pql/feedback:   300 req/min на оператора
WebSocket:           50 events/sec на tenant namespace
Chat Widget:         10 msg/min на сессию (анти-спам)
```

### Webhook верификация

- Telegram: HMAC-SHA256 подпись
- amoCRM: shared secret в заголовке
- VK Max MCP: MCP protocol auth
- Неверифицированные запросы отклоняются HTTP 401

## Структура кода

```
src/
├── conversation/          # BC-01
│   ├── domain/
│   │   ├── aggregates/    # Dialog, Message
│   │   ├── events/        # MessageReceived, DialogCreated
│   │   ├── ports/         # ChannelPort
│   │   └── value-objects/ # MessageContent, Channel
│   ├── application/
│   │   ├── services/      # DialogService
│   │   └── handlers/      # MessageReceivedHandler
│   └── infrastructure/
│       └── repositories/  # DialogRepository
├── pql/                   # BC-02
│   ├── domain/
│   │   ├── aggregates/    # PQLDetector, RuleEngine
│   │   ├── events/        # PQLDetected
│   │   ├── ports/         # CRMPort, RAGPort
│   │   └── value-objects/ # PQLScore, PQLSignal, MemoryContext
│   ├── application/
│   │   ├── services/      # PQLDetectorService
│   │   └── handlers/      # PQLDetectionHandler
│   └── infrastructure/
│       └── repositories/  # PQLRepository
├── revenue/               # BC-03
├── integration/           # BC-04 (MCP adapters)
├── iam/                   # BC-05
├── notifications/         # BC-06
└── shared/                # Shared Kernel (events, middleware, utils)
```
