# DDD Strategic Design: КоммуниК
**Version:** 1.0 | **Date:** 2026-03-04

---

## Bounded Contexts Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                        КоммуниК Domain                              │
│                                                                     │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────┐  │
│  │  CONVERSATION    │    │  PQL INTELLIGENCE│    │   REVENUE    │  │
│  │  CONTEXT         │───▶│  CONTEXT         │───▶│  CONTEXT     │  │
│  │                  │    │                  │    │              │  │
│  │  Chat Widget     │    │  PQL Detector    │    │  Revenue     │  │
│  │  Telegram        │    │  Memory AI       │    │  Report      │  │
│  │  VK Max          │    │  Signal Rules    │    │  Attribution │  │
│  │  Operator WS     │    │  ML Pipeline     │    │  Dashboard   │  │
│  └──────────────────┘    └──────────────────┘    └──────────────┘  │
│           │                       │                      │         │
│           ▼                       ▼                      ▼         │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────┐  │
│  │  INTEGRATION     │    │  IDENTITY &      │    │  NOTIFICATION│  │
│  │  CONTEXT         │    │  ACCESS CONTEXT  │    │  CONTEXT     │  │
│  │                  │    │                  │    │              │  │
│  │  amoCRM MCP      │    │  Tenants         │    │  PQL Pulse   │  │
│  │  Мессенджер Max  │    │  Operators       │    │  Email       │  │
│  │  Grafana MCP     │    │  Permissions     │    │  Push        │  │
│  │  RAG MCP         │    │                  │    │              │  │
│  └──────────────────┘    └──────────────────┘    └──────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## BC-01: Conversation Context

**Ответственность:** Приём, хранение и маршрутизация сообщений всех каналов

| Элемент | Описание |
|---------|----------|
| **Ubiquitous Language** | Dialog, Message, Channel, Queue, Operator, Assignment |
| **Aggregates** | `Dialog` (root), `Message` |
| **Domain Events** | `DialogStarted`, `MessageReceived`, `DialogAssigned`, `DialogClosed` |
| **External Dependencies** | → PQL Intelligence (via event), → Integration (channel adapters) |
| **Team Owner** | Core team |
| **Classification** | Supporting Domain |

---

## BC-02: PQL Intelligence Context ⭐ CORE DOMAIN

**Ответственность:** Обнаружение PQL-сигналов, обогащение контекстом CRM, ML-pipeline

| Элемент | Описание |
|---------|----------|
| **Ubiquitous Language** | PQLSignal, PQLScore, RuleSet, Intent, Confidence, MemoryContext |
| **Aggregates** | `PQLDetector` (root), `SignalRule`, `MLModel` |
| **Domain Events** | `PQLDetected`, `PQLScoreUpdated`, `RuleSetChanged`, `ModelRetrained` |
| **External Dependencies** | ← Conversation (events), → amoCRM MCP (context fetch), → Evolution RAG MCP (KB) |
| **Anti-Corruption Layer** | amoCRM MCP Adapter — изолирует от изменений CRM API |
| **Team Owner** | Core team (highest priority) |
| **Classification** | **Core Domain** — главное конкурентное преимущество |

---

## BC-03: Revenue Context ⭐ CORE DOMAIN

**Ответственность:** Атрибуция выручки, Revenue Intelligence Report, Dashboard

| Элемент | Описание |
|---------|----------|
| **Ubiquitous Language** | RevenueEvent, Attribution, PQLDeal, RevenueReport, ROI |
| **Aggregates** | `RevenueReport` (root), `PQLAttribution` |
| **Domain Events** | `PQLDealClosed`, `RevenueAttributed`, `ReportGenerated` |
| **External Dependencies** | ← PQL Intelligence (events), → amoCRM MCP (deal verification) |
| **Team Owner** | Core team |
| **Classification** | **Core Domain** — уникальная ценность для клиента |

---

## BC-04: Integration Context (Supporting Domain)

**Ответственность:** Адаптеры к внешним системам через Cloud.ru MCP шаблоны

| Элемент | Описание |
|---------|----------|
| **Ubiquitous Language** | Connector, Adapter, Webhook, SyncEvent, MCPClient |
| **MCP Servers (Cloud.ru)** | amoCRM MCP · Мессенджер Max MCP · Grafana MCP · Postgres MCP · Evolution RAG MCP |
| **Pattern** | Anti-Corruption Layer для каждого MCP + Circuit Breaker |
| **Domain Events** | `CRMSynced`, `ChannelMessageReceived`, `IntegrationFailed` |
| **Team Owner** | Core team (generic subdomain) |
| **Classification** | Supporting Domain |

---

## BC-05: Identity & Access Context (Generic Subdomain)

**Ответственность:** Мультитенантность, операторы, роли

| Элемент | Описание |
|---------|----------|
| **Ubiquitous Language** | Tenant, Operator, Role, Permission, ApiKey |
| **Aggregates** | `Tenant` (root), `Operator` |
| **Domain Events** | `TenantCreated`, `OperatorInvited`, `PlanUpgraded` |
| **Team Owner** | Core team (standard auth patterns) |
| **Classification** | Generic Subdomain — стандартный паттерн |

---

## BC-06: Notification Context (Generic Subdomain)

**Ответственность:** PQL Pulse, email-уведомления, Revenue Report delivery

| Элемент | Описание |
|---------|----------|
| **Ubiquitous Language** | Notification, Channel, Template, Delivery |
| **Aggregates** | `NotificationJob` |
| **Domain Events** | `NotificationSent`, `NotificationFailed` |
| **External Dependencies** | Resend API · Push (Web Push API) |
| **Team Owner** | Core team |
| **Classification** | Generic Subdomain |

---

## Context Map (взаимодействия)

```
Conversation ──[Published Events]──▶ PQL Intelligence
                                          │
                           [amoCRM MCP]──▶│◀──[RAG MCP]
                                          │
                                    [Events]▼
                               Revenue Context
                                          │
                                    [amoCRM MCP]
                                          │
                                   [Reports]▼
                                Notification Context
                                          │
                                    [Resend/Push]▼
                                      Operator
```

### Relationship Types

| Relationship | Type | Description |
|-------------|------|-------------|
| Conversation → PQL Intelligence | **Published Language** | Domain events через Redis Streams |
| PQL Intelligence → Integration | **Customer-Supplier** | PQL потребляет MCP-адаптеры |
| Revenue → Integration | **Customer-Supplier** | Revenue verifies deals via amoCRM MCP |
| All → Identity | **Conformist** | Стандартный JWT tenant middleware |
| Notification ← всех | **Published Language** | События инициируют уведомления |

---

## MCP Architecture Layer (Cloud.ru AI Fabric)

```
КоммуниК Application
        │
        ▼
┌─────────────────────────────────────────────┐
│         MCP Client Layer (Node.js)          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │amoCRM    │  │Max Msg   │  │Postgres  │  │
│  │MCP Client│  │MCP Client│  │MCP Client│  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  │
│       │              │              │        │
│  ┌────┴─────┐  ┌────┴─────┐        │        │
│  │Grafana   │  │Evolut.   │        │        │
│  │MCP Client│  │RAG Client│        │        │
│  └──────────┘  └──────────┘        │        │
└─────────────────────────────────────────────┘
        │  (HTTP/SSE transport — MCP protocol)
        ▼
┌─────────────────────────────────────────────┐
│      Cloud.ru AI Fabric MCP Servers         │
│  amoCRM MCP (38★) · Max MCP (23★)           │
│  Postgres MCP (7★,133) · Grafana MCP (8★)   │
│  Evolution RAG MCP (1★,49)                  │
└─────────────────────────────────────────────┘
```

**Ключевое решение:** Готовые Cloud.ru MCP-шаблоны сокращают ~35% кастомной разработки интеграций. Anti-Corruption Layer изолирует доменную логику от деталей MCP-протокола.

---

## Domain Glossary (Ubiquitous Language)

| Term | Definition | Context |
|------|-----------|---------|
| **Dialog** | Сессия общения клиента с поддержкой по одному вопросу | Conversation |
| **PQL** | Product-Qualified Lead — клиент, готовый к апгрейду/покупке | PQL Intelligence |
| **PQL Signal** | Конкретная фраза/паттерн в диалоге, указывающий на намерение купить | PQL Intelligence |
| **PQL Score** | Числовое значение 0–1, отражающее уверенность в PQL-статусе | PQL Intelligence |
| **Memory AI** | Автоматическая подгрузка CRM-контекста клиента до ответа оператора | PQL Intelligence |
| **Revenue Attribution** | Связь между PQL-флагом и закрытой сделкой в CRM | Revenue |
| **Revenue Report** | Ежемесячный PDF-отчёт: сколько выручки принесла поддержка | Revenue |
| **Tenant** | Компания-клиент КоммуниК (SaaS-мультитенантность) | Identity |
| **Operator** | Сотрудник поддержки клиентской компании | Identity, Conversation |
| **MCP Adapter** | Anti-Corruption Layer обёртка над Cloud.ru MCP сервером | Integration |
