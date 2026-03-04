# Architecture: FR-02 — PQL Flag in Dialog
**Feature ID:** FR-02
**Version:** 1.0 | **Date:** 2026-03-04

---

## 1. Component Diagram (C4 Level 3)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Browser — Next.js 14 Client                                                │
│                                                                             │
│  ┌──────────────┐    pql:detected    ┌─────────────────────────────────┐   │
│  │  useDialogs  │◄──── WS event ─────│  Socket.io /chat namespace      │   │
│  │  (hook)      │                    └─────────────┬───────────────────┘   │
│  │  updates     │                                  │                       │
│  │  pqlScore/   │                                  │                       │
│  │  pqlTier     │                                  │                       │
│  └──────┬───────┘                                  │                       │
│         │ Dialog state                             │                       │
│         ▼                                          │                       │
│  ┌──────────────┐   GET /api/proxy/    ┌───────────┴──────────────────┐   │
│  │  DialogList  │   pql/detections/    │  RightPanel                  │   │
│  │  component   │   :dialogId  ───────►│  component                   │   │
│  │              │                      │  - PQL Score section          │   │
│  │  [HOT badge] │                      │  - Signal list (top 5)        │   │
│  │  [WARM badge]│                      │  - Loading / empty state      │   │
│  └──────────────┘                      └───────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
          │                                          │
          │ WebSocket /chat                          │ HTTP REST
          ▼                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Express Server (BC-01 + BC-02)                                             │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ws-handler.ts  (BC-01 infrastructure)                              │   │
│  │  on('client:message')                                               │   │
│  │    1. Save message to conversation.messages                         │   │
│  │    2. Emit message:new to tenant room                               │   │
│  │    3. Call analyzePQLInline(pqlDetector, nsp, event) ──────────┐   │   │
│  └──────────────────────────────────────────────────────────────┬─┘   │   │
│                                                                  │     │   │
│  ┌───────────────────────────────────────────────────────────────┼─┐   │   │
│  │  message-consumer.ts (BC-02 infrastructure)                   │ │   │   │
│  │  analyzePQLInline()                                           │ │   │   │
│  │    → pqlDetector.analyze(event) ──────────────────────────┐  │ │   │   │
│  │    → nsp.emit('pql:detected', payload) to tenant room      │  │ │   │   │
│  │    → notificationService.processNewPQLDetection(detection) │  │ │   │   │
│  └───────────────────────────────────────────────────────────┼─┘ │   │   │
│                                                               │   │   │   │
│  ┌────────────────────────────────────────────────────────────▼─┐ │   │   │
│  │  PQLDetectorService (BC-02 application/services)              │ │   │   │
│  │    1. Guard: senderType === CLIENT                            │ │   │   │
│  │    2. analyzeRules(content, DEFAULT_RULES)                    │ │   │   │
│  │    3. calculateTier(normalizedScore)                          │ │   │   │
│  │    4. detectionRepo.save(detection) ─────────────────────┐   │ │   │   │
│  │    5. dialogUpdater.updatePQLScore(dialogId, score, tier) │   │ │   │   │
│  └───────────────────────────────────────────────────────────┼──┘ │   │   │
│                                                               │    │   │   │
│  ┌────────────────────────────────────────────────────────────▼─┐  │   │   │
│  │  PgPQLDetectionRepository (BC-02 infrastructure)              │  │   │   │
│  │    INSERT INTO pql.detections (RLS enforced)                  │  │   │   │
│  │    findByDialogId (called from pql-routes.ts HTTP handler)    │  │   │   │
│  └───────────────────────────────────────────────────────────────┘  │   │   │
│                                                                      │   │   │
│  ┌───────────────────────────────────────────────────────────────────▼─┐ │   │
│  │  pql-routes.ts (BC-02 infrastructure/REST)                           │ │   │
│  │    GET /api/pql/detections/:dialogId → findByDialogId               │ │   │
│  │    GET /api/pql/detections           → findByTenantId (paginated)   │ │   │
│  └──────────────────────────────────────────────────────────────────────┘ │   │
└─────────────────────────────────────────────────────────────────────────────┘
          │                           │
          ▼                           ▼
  ┌───────────────┐         ┌──────────────────┐
  │  PostgreSQL   │         │  PostgreSQL       │
  │  pql.detections│        │  conversation.    │
  │  (RLS on)     │         │  dialogs          │
  └───────────────┘         │  (pql_score,      │
                            │   pql_tier cols)  │
                            └──────────────────┘
```

---

## 2. Cross-BC Dependencies

| From BC | To BC | Integration Type | Mechanism |
|---------|-------|-----------------|-----------|
| BC-01 Conversation | BC-02 PQL Intelligence | Direct function call (same process) | `ws-handler.ts` imports `analyzePQLInline` from `@pql/infrastructure/message-consumer` |
| BC-02 PQL Intelligence | BC-06 Notifications | Direct function call (same process) | `message-consumer.ts` imports `NotificationService` from `@notifications/application/services` |

Note: The BC-01 → BC-02 import (`@pql/infrastructure/message-consumer`) is a deliberate architectural compromise for the MVP. The pseudocode (PS-01) specifies Redis Streams for decoupling. The inline call is equivalent semantically (fire-and-forget with `.catch()`) and avoids Redis consumer lag in the MVP phase.

---

## 3. Data Flow — End to End

```
1. Client sends message via Socket.io  client:message
2. ws-handler saves message to conversation.messages
3. ws-handler emits message:new to tenant room (operators see message)
4. ws-handler calls analyzePQLInline() — non-blocking (.catch())
5. PQLDetectorService.analyze():
   a. Guard: skip if not CLIENT
   b. RuleEngine: regex match against 15 DEFAULT_RULES
   c. calculateTier(normalizedScore)
   d. PgPQLDetectionRepository.save() → INSERT pql.detections
   e. dialogUpdater.updatePQLScore() → UPDATE conversation.dialogs SET pql_score, pql_tier
6. message-consumer emits pql:detected to tenant room
7. Browser useDialogs hook receives pql:detected, updates dialog.pqlScore + pqlTier
8. DialogList re-renders: tier badge visible on dialog item
9. Operator opens dialog → RightPanel renders PQL Score section
10. RightPanel useEffect fires GET /api/pql/detections/:dialogId
11. pql-routes.ts handler calls PgPQLDetectionRepository.findByDialogId()
12. Signals returned, deduplicated, sorted by weight, top 5 rendered
```

---

## 4. Layer Architecture (BC-02)

```
BC-02 PQL Intelligence
├── domain/
│   ├── rule-engine.ts              — Pure function: analyzeRules()
│   ├── rule-engine.test.ts         — Unit tests (>= 95% coverage, FF-05)
│   └── value-objects/
│       ├── pql-score.ts            — PQLTier type + calculateTier()
│       └── rule-set.ts             — SignalRule, DEFAULT_RULES, MAX_POSSIBLE_WEIGHT
├── application/
│   └── services/
│       ├── pql-detector-service.ts — PQLDetectorService: orchestrates detection pipeline
│       ├── pql-detector-service.test.ts
│       ├── memory-ai-service.ts    — MemoryAIService (FR-03, separate feature)
│       ├── ml-model-service.ts     — MLModelService (FR-10, pluggable)
│       └── ml-training-service.ts  — ML training pipeline (FR-10)
└── infrastructure/
    ├── pql-routes.ts               — REST API (GET /api/pql/detections/*)
    ├── message-consumer.ts         — analyzePQLInline() + registerPQLConsumer()
    ├── feedback-routes.ts          — PQL feedback (separate feature)
    ├── memory-ai-routes.ts         — Memory AI REST (FR-03)
    ├── ml-routes.ts                — ML REST (FR-10)
    └── repositories/
        ├── pql-detection-repository.ts  — PgPQLDetectionRepository
        └── ml-model-repository.ts
```

Layer rules (enforced by ESLint FF-02):
- `domain/` must NOT import from `application/` or `infrastructure/`
- `application/` may import from `domain/` only
- `infrastructure/` may import from `application/` and `domain/`
- Cross-BC imports FORBIDDEN except `shared/`

---

## 5. Frontend Component Tree (FR-02 relevant)

```
WorkspacePage (app/(workspace)/page.tsx)
├── useSocket()          — Socket.io connection
├── useDialogs()         — Dialog list + pql:detected handler
├── DialogList           — Renders tier badges via pqlBadge()
└── RightPanel           — PQL Score section + signal list fetch
    └── useMemoryAI()    — CRM context (FR-03, co-located in panel)
```

---

## 6. ADR Compliance Summary

| ADR | Rule | FR-02 Implementation |
|-----|------|---------------------|
| ADR-002 | Never call external APIs directly from domain code | RuleEngine is pure regex, no external calls. amoCRM called only via MCP Adapter. |
| ADR-006 | Redis Streams for async events | MVP uses inline call (fire-and-forget .catch). Semantically equivalent. Streams migration planned for production scale. |
| ADR-007 | JWT + RLS on every DB query | tenant middleware sets `app.tenant_id`; pql.detections table has RLS enabled |
| ADR-009 | Rule-based v1, no LLM | RuleEngine is pure regex (DEFAULT_RULES). ML path available but disabled by default. |
