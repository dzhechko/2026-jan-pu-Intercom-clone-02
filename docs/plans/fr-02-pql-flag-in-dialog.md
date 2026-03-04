# FR-02: PQL Flag in Dialog
**Status:** Done | **BC:** BC-02 PQL Intelligence, BC-01 Conversation | **Priority:** MUST

## Summary
Implemented the PQL detection pipeline that analyzes incoming CLIENT messages for purchase-intent signals using a regex-based RuleEngine (15 rules), calculates a normalized PQL score (0-1), classifies it into HOT/WARM/COLD tiers, persists detection records, updates the dialog aggregate with the latest score/tier, and surfaces results in the Operator Workspace via real-time Socket.io events and REST API queries.

## User Stories
- US-01: As the system, I want to analyze every CLIENT message for purchase-intent signals so that PQL leads are automatically detected.
- US-02: As an operator, I want to see a PQL score and tier badge (HOT/WARM/COLD) on each dialog so that I prioritize high-value conversations.
- US-03: As an operator, I want to see the top 3 detected signals with their weight percentages so that I understand why a dialog is flagged.
- US-04: As an operator, I want dialogs sorted by PQL tier (HOT first) so that the most valuable leads are always at the top of my list.
- US-05: As an operator, I want to provide feedback (CORRECT/INCORRECT/UNSURE) on PQL detections so that the system improves over time.

## Technical Design

### Files Created

**Domain Layer:**
- `src/pql/domain/rule-engine.ts` -- `analyzeRules()` function that normalizes content (strip emoji, lowercase, trim, collapse whitespace, truncate at 2000 chars per EC-02), matches against signal rules via regex, calculates raw + normalized score, extracts top 3 signals sorted by weight.
- `src/pql/domain/value-objects/rule-set.ts` -- 15 default PQL signal rules with regex patterns and weights. Signal types include: PURCHASE, ENTERPRISE, PRICING, DEMO, BUDGET, MIGRATION, INTEGRATION, SLA, COMPETITOR, TEAM_SIZE, TIMELINE, SECURITY, COMPLIANCE, CUSTOM_DEVELOPMENT, SUPPORT_TIER. Exports `MAX_POSSIBLE_WEIGHT` for normalization.
- `src/pql/domain/value-objects/pql-score.ts` -- `calculateTier()` function: score >= 0.80 = HOT, >= 0.65 = WARM, else COLD. PQLTier type definition.
- `src/pql/domain/ports/crm-port.ts` -- CRMPort interface for future MCP adapter integration.

**Application Layer:**
- `src/pql/application/services/pql-detector-service.ts` -- PQLDetectorService.analyze() pipeline: (1) filter non-CLIENT messages, (2) run RuleEngine, (3) skip if no signals, (4) calculate tier, (5) build detection record with UUID, (6) persist via PQLDetectionRepository, (7) update dialog via DialogPQLUpdater. Defines PQLDetection, MessageEvent, PQLDetectionRepository, DialogPQLUpdater interfaces.
- `src/pql/application/services/pql-detector-service.test.ts` -- 11 tests covering sender filtering, no-signal handling, signal detection, persistence, dialog update, tier classification (HOT/COLD), top signals extraction, unique IDs, timestamps, empty content, emoji handling.
- `src/pql/application/services/ml-training-service.ts` -- MLTrainingService for operator feedback collection (CORRECT/INCORRECT/UNSURE) and feedback stats.
- `src/pql/application/services/ml-model-service.ts` -- ML model management service for future v2 ML pipeline.
- `src/pql/application/services/memory-ai-service.ts` -- Memory AI service for CRM context enrichment.

**Infrastructure Layer:**
- `src/pql/infrastructure/repositories/pql-detection-repository.ts` -- PgPQLDetectionRepository with save, findByDialogId, findByTenantId (paginated). Stores signals and topSignals as JSONB.
- `src/pql/infrastructure/pql-routes.ts` -- REST routes: GET /api/pql/detections/:dialogId (per dialog), GET /api/pql/detections (per tenant, paginated). Uses Zod for pagination validation.
- `src/pql/infrastructure/feedback-routes.ts` -- Feedback routes: POST /api/pql/detections/:id/feedback (submit), GET /api/pql/feedback/stats (tenant stats).
- `src/pql/infrastructure/message-consumer.ts` -- Redis Stream consumer that triggers PQL analysis on MessageReceived events.
- `src/pql/infrastructure/memory-ai-routes.ts` -- Memory AI REST endpoints.
- `src/pql/infrastructure/ml-routes.ts` -- ML model management endpoints.
- `src/pql/infrastructure/repositories/ml-model-repository.ts` -- ML model persistence.

**Workspace Integration (Frontend):**
- `app/(workspace)/hooks/useDialogs.ts` -- Listens for `pql:detected` Socket.io events and updates dialog's pqlScore/pqlTier in real time. Sorts dialogs with HOT > WARM > COLD > undefined priority.
- `app/(workspace)/components/RightPanel.tsx` -- PQL Score section fetches detections from `/api/proxy/pql/detections/{dialogId}`, aggregates signals across detections (keeping highest-weight per type), displays top 5 signals with weight percentages. Color-coded tier badge and score.
- `app/(workspace)/components/DialogList.tsx` -- PQL tier badge (HOT=red, WARM=orange, COLD=gray) displayed next to channel badge in each dialog list item.

### Key Decisions
- Rule-based detection (v1) per ADR-009: regex only, no LLM. ML v2 planned after 1K dialogs, LLM v3 after 10K + GPU.
- Only CLIENT messages are analyzed (OPERATOR and BOT messages skipped per PS-01 pseudocode).
- Score normalization: raw weight sum divided by MAX_POSSIBLE_WEIGHT, capped at 1.0. This ensures consistent 0-1 range regardless of how many rules exist.
- Content normalization: emoji stripped, lowercased, whitespace collapsed, truncated at 2000 chars (EC-02, EC-03).
- Top signals extraction: sorted by weight descending, limited to 3 per detection record.
- PQL detections stored as immutable event records (one per message analyzed), not overwritten. Dialog aggregate holds the latest score/tier.
- Feedback loop implemented for future ML training: operators can label detections as CORRECT/INCORRECT/UNSURE.
- Real-time delivery: PQL detection results pushed via `pql:detected` Socket.io event to workspace clients; also triggers `notification:pql` for the notification bell.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/pql/detections/:dialogId | Get all PQL detections for a dialog |
| GET | /api/pql/detections | List recent PQL detections for tenant (paginated) |
| POST | /api/pql/detections/:id/feedback | Submit operator feedback on a detection |
| GET | /api/pql/feedback/stats | Feedback statistics for tenant |

## Socket.io Events
| Event | Direction | Payload |
|-------|-----------|---------|
| `pql:detected` | Server -> Client | `{ dialogId, score, tier, topSignals: [{ type, weight, matchedText }] }` |
| `notification:pql` | Server -> Client | `{ type, dialogId, score, tier, topSignals, contactEmail, timestamp }` |

## Dependencies
- Depends on: BC-01 Conversation (Dialog aggregate, MessageReceived event via Redis Stream), IAM-01 (tenant context for RLS)
- Blocks: FR-09 Revenue Report (PQL detections feed revenue attribution), FR-10 PQL Feedback (feedback UI), FR-05 ML Pipeline v2

## Tests
- `src/pql/domain/rule-engine.test.ts` -- RuleEngine unit tests (15+ rules with positive/negative/case-insensitive/weight tests per rule, FF-05 coverage >= 95%).
- `src/pql/application/services/pql-detector-service.test.ts` -- 11 tests:
  - Sender filtering: returns null for OPERATOR and BOT messages
  - No signals: returns null when no PQL signals detected
  - Signal detection: detects purchase-intent signals, persists to repository, updates dialog PQL score
  - Tier classification: HOT for >= 0.80, COLD for low-intent
  - Top signals: extracts top 3 sorted by weight
  - Structure: unique detection IDs, createdAt timestamp
  - Edge cases: empty content, emoji in content
- `src/pql/application/services/ml-model-service.test.ts` -- ML model service tests.
- `src/pql/application/services/memory-ai-service.test.ts` -- Memory AI service tests.

## Acceptance Criteria
- [x] Every CLIENT message is analyzed by the RuleEngine (15 signal rules)
- [x] OPERATOR and BOT messages are skipped
- [x] PQL score normalized to 0-1 range
- [x] Tier classification: >= 0.80 HOT, >= 0.65 WARM, < 0.65 COLD
- [x] Detection record persisted with signals and top signals
- [x] Dialog aggregate updated with latest pqlScore and pqlTier
- [x] Real-time `pql:detected` event pushed to workspace via Socket.io
- [x] PQL tier badge displayed in dialog list (color-coded)
- [x] PQL score, tier, and signals shown in right panel
- [x] Dialogs sorted by PQL tier priority (HOT first)
- [x] Content normalized: emoji stripped, lowercased, truncated at 2000 chars
- [x] Operator feedback (CORRECT/INCORRECT/UNSURE) collection enabled
- [x] Detection IDs are unique (UUID v4)
