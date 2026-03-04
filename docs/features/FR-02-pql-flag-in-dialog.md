# FR-02: PQL Flag in Dialog
**Status:** Done | **BC:** BC-02 PQL Intelligence, BC-01 Conversation | **Priority:** MUST | **Milestone:** M1

## Summary
Implemented the PQL detection pipeline that analyzes incoming client messages for purchase-intent signals using a regex-based RuleEngine (15 rules), calculates a normalized PQL score (0-1), classifies results into HOT/WARM/COLD tiers, and surfaces findings in the Operator Workspace via real-time Socket.io events and REST API queries. Operator feedback (CORRECT/INCORRECT/UNSURE) enables future ML training iterations.

## Files Created/Modified

| File | Role |
|------|------|
| `src/pql/domain/rule-engine.ts` | RuleEngine analyzeRules() function normalizes content, detects PQL signals via regex, calculates raw + normalized score (0-1), extracts top 3 signals |
| `src/pql/domain/value-objects/rule-set.ts` | 15 default PQL signal rules (PURCHASE, ENTERPRISE, PRICING, DEMO, BUDGET, MIGRATION, INTEGRATION, SLA, COMPETITOR, TEAM_SIZE, TIMELINE, SECURITY, COMPLIANCE, CUSTOM_DEVELOPMENT, SUPPORT_TIER) with weights and regex patterns |
| `src/pql/domain/value-objects/pql-score.ts` | PQLScore value object with calculateTier() function: score >= 0.80 = HOT, >= 0.65 = WARM, else COLD |
| `src/pql/domain/ports/crm-port.ts` | CRMPort interface for future MCP adapter integration |
| `src/pql/application/services/pql-detector-service.ts` | Orchestrates PQL analysis pipeline: filters CLIENT messages, runs RuleEngine, calculates tier, persists detection, updates dialog PQL score |
| `src/pql/application/services/ml-training-service.ts` | Collects operator feedback (CORRECT/INCORRECT/UNSURE) and computes feedback statistics for future ML v2 training |
| `src/pql/application/services/ml-model-service.ts` | ML model lifecycle management service for future v2 ML pipeline |
| `src/pql/application/services/memory-ai-service.ts` | Memory AI service for CRM context enrichment |
| `src/pql/infrastructure/repositories/pql-detection-repository.ts` | PgPQLDetectionRepository: save, findByDialogId, findByTenantId (paginated). Stores signals and topSignals as JSONB |
| `src/pql/infrastructure/pql-routes.ts` | REST API routes: GET /api/pql/detections/:dialogId and GET /api/pql/detections (paginated) |
| `src/pql/infrastructure/feedback-routes.ts` | Feedback REST API: POST /api/pql/detections/:id/feedback and GET /api/pql/feedback/stats |
| `src/pql/infrastructure/message-consumer.ts` | Redis Stream consumer triggers PQL analysis on MessageReceived events |
| `src/pql/infrastructure/memory-ai-routes.ts` | Memory AI REST API endpoints |
| `src/pql/infrastructure/ml-routes.ts` | ML model management REST API endpoints |
| `src/pql/infrastructure/repositories/ml-model-repository.ts` | ML model persistence |
| `app/(workspace)/hooks/useDialogs.ts` | Listens for pql:detected Socket.io events, updates dialog pqlScore/pqlTier in real time, sorts dialogs HOT > WARM > COLD |
| `app/(workspace)/components/RightPanel.tsx` | Fetches detections from /api/proxy/pql/detections/:dialogId, aggregates signals (highest-weight per type), displays top 5 signals with weight percentages, color-coded tier badge |
| `app/(workspace)/components/DialogList.tsx` | Displays PQL tier badge next to channel badge in dialog list (HOT=red, WARM=orange, COLD=gray) |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/pql/detections/:dialogId` | Get all PQL detections for a specific dialog |
| GET | `/api/pql/detections` | List recent PQL detections for authenticated tenant (paginated: limit=1-100, offset) |
| POST | `/api/pql/detections/:id/feedback` | Submit operator feedback on a detection (label: CORRECT/INCORRECT/UNSURE, comment: optional string) |
| GET | `/api/pql/feedback/stats` | Get feedback statistics for authenticated tenant |

## Socket.io Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `pql:detected` | Server → Client | `{ dialogId, score, tier, topSignals: [{ type, weight, matchedText }] }` |
| `notification:pql` | Server → Client | `{ type, dialogId, score, tier, topSignals, contactEmail, timestamp }` |

## Key Decisions

1. **Rule-based detection (v1):** Only regex patterns, no LLM. Per ADR-009, ML v2 planned after 1K dialogs, LLM v3 after 10K dialogs + GPU.
2. **Client-only analysis:** Only CLIENT messages are analyzed (OPERATOR and BOT messages skipped per pseudocode PS-01).
3. **Score normalization:** Raw weight sum divided by MAX_POSSIBLE_WEIGHT, capped at 1.0, ensures consistent 0-1 range regardless of rule count.
4. **Content normalization:** Emoji stripped, lowercased, whitespace collapsed, truncated at 2000 chars (per edge cases EC-02, EC-03).
5. **Top signals extraction:** Sorted by weight descending, limited to 3 per detection record for UI clarity.
6. **Immutable detection records:** PQL detections stored as event records (one per analyzed message), never overwritten. Dialog aggregate holds latest score/tier.
7. **Real-time delivery:** PQL results pushed via `pql:detected` Socket.io event to workspace clients; also triggers `notification:pql` for notification bell.
8. **Feedback loop:** Operators can label detections CORRECT/INCORRECT/UNSURE to enable future ML training iterations.

## Tests

| File | Test Count | Coverage |
|------|-----------|----------|
| `src/pql/domain/rule-engine.test.ts` | 50+ | ≥ 95% (FF-05 compliance) |
| `src/pql/application/services/pql-detector-service.test.ts` | 11 | Sender filtering, no-signal handling, signal detection, persistence, dialog update, tier classification, top signals extraction, unique IDs, timestamps, empty content, emoji handling |
| `src/pql/application/services/ml-model-service.test.ts` | 5+ | ML model lifecycle |
| `src/pql/application/services/memory-ai-service.test.ts` | 5+ | Memory AI context enrichment |

## Acceptance Criteria

- [x] Every CLIENT message is analyzed by the RuleEngine (15 signal rules)
- [x] OPERATOR and BOT messages are skipped
- [x] PQL score normalized to 0-1 range
- [x] Tier classification: >= 0.80 HOT, >= 0.65 WARM, < 0.65 COLD
- [x] Detection record persisted with signals and top signals (JSONB)
- [x] Dialog aggregate updated with latest pqlScore and pqlTier
- [x] Real-time `pql:detected` event pushed to workspace via Socket.io
- [x] PQL tier badge displayed in dialog list (color-coded: red/orange/gray)
- [x] PQL score, tier, and signals shown in right panel
- [x] Dialogs sorted by PQL tier priority (HOT first)
- [x] Content normalized: emoji stripped, lowercased, truncated at 2000 chars
- [x] Operator feedback (CORRECT/INCORRECT/UNSURE) collection enabled via REST API
- [x] Detection IDs are unique (UUID v4)
- [x] Feedback statistics endpoint returns aggregated metrics per tenant
