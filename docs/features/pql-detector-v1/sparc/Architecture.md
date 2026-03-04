# Architecture: FR-01 PQL Detector v1 (Rule-Based)

**Feature ID:** FR-01
**Bounded Context:** BC-02 PQL Intelligence
**Status:** Implemented
**Version:** 1.0 | **Date:** 2026-03-04

---

## 1. C4 Level 3 — Component Diagram (BC-02)

```
┌───────────────────────────────────────────────────────────────────┐
│                    BC-02: PQL Intelligence Context                 │
│                                                                    │
│  ┌────────────────────┐      ┌──────────────────────────────────┐  │
│  │  PQL Message       │      │  PQL Detector Service            │  │
│  │  Consumer          │─────▶│                                  │  │
│  │                    │      │  analyze(MessageEvent)           │  │
│  │  (infrastructure)  │      │                                  │  │
│  │  Listens:          │      │  ┌───────────────────────────┐   │  │
│  │  pql:analyze       │      │  │    RuleEngine             │   │  │
│  │  (Socket.io)       │      │  │                           │   │  │
│  └────────────────────┘      │  │  analyzeRules(           │   │  │
│                              │  │    content, DEFAULT_RULES)│   │  │
│                              │  │                           │   │  │
│                              │  │  - normalizeContent()     │   │  │
│                              │  │  - regex matching         │   │  │
│                              │  │  - weight accumulation    │   │  │
│                              │  │  - score normalization    │   │  │
│                              │  └───────────────────────────┘   │  │
│                              │                                  │  │
│                              │  ┌───────────────────────────┐   │  │
│                              │  │  PQL Score Value Object   │   │  │
│                              │  │  calculateTier(score)     │   │  │
│                              │  │  HOT/WARM/COLD            │   │  │
│                              │  └───────────────────────────┘   │  │
│                              └──────────────────────────────────┘  │
│                                       │          │                  │
│                                       ▼          ▼                  │
│  ┌────────────────────┐   ┌───────────────┐  ┌────────────────┐    │
│  │  PQL Routes        │   │  PQL Detection│  │  Dialog PQL    │    │
│  │  (REST API)        │   │  Repository   │  │  Updater       │    │
│  │  GET /detections   │   │  (PostgreSQL) │  │  (port →       │    │
│  │  GET /:dialogId    │   │               │  │   BC-01)       │    │
│  └────────────────────┘   └───────────────┘  └────────────────┘    │
│           │                       │                   │             │
└───────────┼───────────────────────┼───────────────────┼─────────────┘
            │                       │                   │
            ▼                       ▼                   ▼
     HTTP Clients            pql.detections        conversations.dialogs
     (Operator UI)           (PostgreSQL 16)       (PostgreSQL 16, BC-01)
```

---

## 2. Layer Map

```
BC-02 PQL Intelligence
│
├── domain/                              [Pure domain logic — no I/O]
│   ├── rule-engine.ts                   analyzeRules() function
│   └── value-objects/
│       ├── rule-set.ts                  DEFAULT_RULES[], SignalRule, SignalMatch, MAX_POSSIBLE_WEIGHT
│       └── pql-score.ts                 PQLTier, PQLScore, calculateTier()
│
├── application/
│   └── services/
│       ├── pql-detector-service.ts      PQLDetectorService.analyze() — orchestrates detection
│       │                                Ports: PQLDetectionRepository, DialogPQLUpdater
│       ├── ml-model-service.ts          Optional v2 hook (falls back to rule-v1)
│       └── memory-ai-service.ts         FR-03 (not part of FR-01 rule-engine path)
│
└── infrastructure/
    ├── pql-routes.ts                    Express REST router (GET /detections, GET /:dialogId)
    ├── message-consumer.ts              Socket.io consumer: pql:analyze → analyze() → pql:detected
    └── repositories/
        └── pql-detection-repository.ts  PgPQLDetectionRepository: INSERT + SELECT
```

---

## 3. Event Flow (FR-01 Detection Pipeline)

```
[Client sends message in chat widget]
          │
          ▼
[BC-01: ws-handler saves message to DB]
          │
          │ Socket.io internal event "pql:analyze"
          │ (fire-and-forget, async — does NOT block chat response)
          ▼
[PQL Message Consumer]
  - validates payload fields
  - calls pqlDetector.analyze(event)
          │
          ▼
[PQLDetectorService.analyze()]
  - guards: senderType !== 'CLIENT' → return null
  - if ML service absent or returns null → use rule-v1
          │
          ▼
[RuleEngine.analyzeRules()]
  - normalizeContent(): strip emoji, lowercase, truncate 2000
  - iterate DEFAULT_RULES[15]: regex.match() per rule
  - accumulate matched signals + totalWeight
  - normalizedScore = min(totalWeight / 2.25, 1.0)
  - sort top-3 by weight
          │
          ▼
[calculateTier(score)]
  → HOT / WARM / COLD
          │
          ▼
[PQLDetectionRepository.save()]
  - INSERT INTO pql.detections
  - RLS enforced via app.tenant_id session variable
          │
          ▼
[DialogPQLUpdater.updatePQLScore()]
  - updates conversations.dialogs.pql_score, pql_tier
  - denormalized for fast operator inbox sort
          │
          ▼
[chatNamespace.to('tenant:X').emit('pql:detected')]
  - broadcasts to all operators in tenant namespace
  - payload: { detectionId, dialogId, score, tier, topSignals }
          │
          ▼
[NotificationService.processNewPQLDetection()]   [optional FR-11]
  - PQL Pulse push + email for HOT tier
```

---

## 4. Cross-BC Dependencies

| Dependency | Direction | Mechanism | Purpose |
|------------|-----------|-----------|---------|
| BC-01 Conversation | inbound | Socket.io event `pql:analyze` | Triggers detection after message save |
| BC-01 Conversation | outbound | `DialogPQLUpdater` port | Updates dialog's pql_score / pql_tier |
| BC-06 Notifications | outbound | `NotificationService` (optional) | Sends PQL Pulse for HOT detections |
| BC-05 IAM | inbound | JWT middleware + `TenantRequest` | Authenticates REST API requests |

**Isolation rule (FF-02):** BC-02 never imports from BC-01, BC-03, or BC-06 directly.
Cross-BC communication is through:
- Events (Socket.io internal events)
- Ports (interfaces injected at bootstrap)
- Shared types (`shared/events/*`, `shared/middleware/*`)

---

## 5. ADR Compliance

| ADR | Decision | Compliance Status |
|-----|----------|------------------|
| ADR-009 | Rule-based v1, NO LLM | COMPLIANT — pure regex, no external AI calls |
| ADR-007 | JWT + RLS | COMPLIANT — all DB queries run under app.tenant_id RLS |
| ADR-006 | Redis Streams for async events | PARTIALLY — v1 uses Socket.io internal events instead of Redis Streams; acceptable for MVP scale |
| ADR-002 | Never call external APIs from domain | COMPLIANT — domain layer has zero I/O; adapters injected via ports |
| ADR-003 | Data residency (Russian VPS) | COMPLIANT — no foreign API calls in v1 |

**Note on ADR-006:** The pseudocode (PS-01) specifies Redis Stream `conversations.messages`. The implemented v1 uses Socket.io internal `pql:analyze` event. This is an acceptable MVP deviation — Redis Streams can be introduced in v2 without changing domain logic. The fire-and-forget async pattern is preserved.

---

## 6. Fitness Function Compliance

### FF-01: PQL Detection < 2,000 ms p95

The detection pipeline in v1 consists entirely of in-process operations:
- Content normalization: O(n) string operations, < 1 ms
- Regex matching on 15 rules against 2,000-char string: < 5 ms
- DB INSERT to pql.detections: ~5-20 ms on local PostgreSQL
- DB UPDATE to conversations.dialogs: ~5-20 ms

Total synchronous path: < 50 ms (well within 2,000 ms SLA).
The rule engine's self-documented SLA is < 50 ms per analysis.

### FF-03: Tenant RLS Isolation 100%

All repository queries run under PostgreSQL Row-Level Security:
- `PgPQLDetectionRepository.save()` — INSERT with tenant_id; RLS policy enforces isolation
- `findByDialogId()` — SELECT with RLS, no explicit tenant_id filter
- `findByTenantId()` — SELECT with explicit WHERE + RLS (double protection)
- REST routes extract `tenantId` from `TenantRequest` (JWT middleware)

### FF-05: RuleEngine Coverage >= 95%

Test file: `src/pql/domain/rule-engine.test.ts`
Coverage target: all branches in `analyzeRules()` and `normalizeContent()`

Tests implemented:
- Positive match per signal type (ENTERPRISE, PURCHASE, multi-signal)
- Negative match (no signals, empty content)
- Case insensitivity
- Score normalization bounds (0–1)
- Top-3 sort order
- Long message truncation (EC-02)
- Emoji handling (EC-03)
- Custom rule injection

### FF-02: No Cross-BC Imports (ESLint)

BC-02 imports are restricted to:
- `@pql/*` — own BC
- `@shared/*` — shared kernel
- No imports from `@conversation/*`, `@revenue/*`, `@integration/*`, `@notifications/*`, `@iam/*`

---

## 7. Deployment Context

```
Docker Compose (VPS HOSTKEY)
│
├── api (Node.js/Express + Socket.io)
│   └── BC-02 code runs in-process
│       ├── PQLDetectorService initialized at bootstrap
│       ├── PqlRouter mounted at /api/pql
│       └── PQLConsumer registered on /chat namespace
│
├── postgres (PostgreSQL 16-alpine)
│   └── schema: pql.detections
│
└── redis (Redis 7-alpine)
    └── [not yet used for PQL in v1 — ADR-006 deviation]
```
