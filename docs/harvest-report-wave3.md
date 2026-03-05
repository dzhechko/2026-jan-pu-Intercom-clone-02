# Harvest Report — Wave 3 (Full Harvest)

**Date:** 2026-03-05
**Mode:** Full (4-phase pipeline with checkpoints)
**Source:** КоммуниК v1.0.0 — post-review, all 15 features complete
**Previous harvests:** 50 artifacts (wave 1: 42, wave 2: 8)

---

## Phase 1: Agent Review Summary

5 parallel extraction agents scanned the codebase:

| Agent | Candidates Found | NEW (after dedup) |
|-------|:----------------:|:-----------------:|
| extractor-patterns | 10 | 6 |
| extractor-commands | 17 | 4 |
| extractor-rules | 19 | 3 |
| extractor-templates | 26 | 1 |
| extractor-snippets | 24 | 1 |
| **Total** | **96** | **18** |

After dedup vs 50 existing: **18 unique NEW candidates**

---

## Phase 2: Classification

### Extract (14 artifacts)

| # | Artifact | Primary | Secondary | Confidence |
|---|----------|---------|-----------|------------|
| **Patterns (7)** |
| P-13 | Redis-Based Presence Tracking | Pattern | Snippet | HIGH |
| P-14 | Paginated Repository with Metadata | Pattern | Snippet | HIGH |
| P-15 | Upsert (ON CONFLICT DO UPDATE) | Pattern | — | HIGH |
| P-16 | Load-Balanced Assignment Queue | Pattern | — | MEDIUM |
| P-17 | JSONB Aggregate Storage | Pattern | — | MEDIUM |
| P-18 | Status Transition Aggregate | Pattern | — | HIGH |
| P-19 | Concurrent Dedup with Redis SETNX | Pattern | Rule | HIGH |
| **Commands (3)** |
| C-07 | Widget esbuild Bundling | Command | Template | HIGH |
| C-08 | assess-tests.sh (Ramsay Mode) | Command | — | HIGH |
| C-09 | assess-code.sh (Linus Mode) | Command | — | HIGH |
| **Rules (2)** |
| R-11 | Performance Budget as Fitness Functions | Rule | Pattern | HIGH |
| R-12 | Message Truncation for Analysis Pipelines | Rule | — | HIGH |
| **Templates (1)** |
| T-08 | Claude Code Skill Modular Structure | Template | — | HIGH |
| **Snippets (1)** |
| S-08 | Secret Validator (fail-fast startup) | Snippet | Rule | HIGH |

### Skip (4 items)

| # | Finding | Reason |
|---|---------|--------|
| 10 | fitness:critical runner | Overlaps with existing T-07 migration pattern |
| 14 | .env.example | Too project-specific |
| 17 | Attribution Confidence Scoring | Domain-specific (revenue) |
| 18 | Revenue Summary Factory | Domain-specific (revenue) |

---

## Phase 3: Decontextualized Artifacts

### P-13: Redis-Based Presence Tracking

**Category:** Pattern | **Maturity:** Alpha | **Reusability:** HIGH

**Intent:** Track online/offline status of entities (users, agents, operators) in real-time using Redis SET operations with graceful degradation on Redis failure.

**When to Use:**
- Real-time presence indicators (online/offline/away)
- Multi-tenant systems needing per-group presence tracking
- Systems where presence data is ephemeral and can be lost on restart

**When NOT to Use:**
- When you need persistent presence history (use DB instead)
- When Redis is not available in your stack
- When you need <10ms latency guarantees (network hop to Redis)

**Implementation:**
```typescript
import Redis from 'ioredis'

export class PresenceService {
  constructor(private readonly redis: Redis) {}

  async setOnline(entityId: string, groupId: string): Promise<void> {
    try {
      await this.redis.sadd(`presence:${groupId}`, entityId)
    } catch (err) {
      console.error('[presence] setOnline error', err)
    }
  }

  async setOffline(entityId: string, groupId: string): Promise<void> {
    try {
      await this.redis.srem(`presence:${groupId}`, entityId)
    } catch (err) {
      console.error('[presence] setOffline error', err)
    }
  }

  async getOnlineEntities(groupId: string): Promise<string[]> {
    try {
      return await this.redis.smembers(`presence:${groupId}`)
    } catch (err) {
      console.error('[presence] getOnline error', err)
      return [] // safe default
    }
  }

  async isOnline(entityId: string, groupId: string): Promise<boolean> {
    try {
      return (await this.redis.sismember(`presence:${groupId}`, entityId)) === 1
    } catch (err) {
      console.error('[presence] isOnline error', err)
      return false
    }
  }
}
```

**Variants:**
- Add TTL expiration: `SADD` + `EXPIRE` for auto-cleanup on disconnect
- Add PUBSUB notification: publish presence changes to subscribers
- Add `SCARD` for online count without loading full set

**Source:** КоммуниК, 2026-03-05 | `src/iam/application/services/presence-service.ts`

---

### P-14: Paginated Repository with Metadata

**Category:** Pattern | **Maturity:** Alpha | **Reusability:** HIGH

**Intent:** Return paginated query results with total count and `hasMore` flag in a single call, using `Promise.all` for parallel data+count queries.

**When to Use:**
- Any list endpoint with pagination
- Lazy-loading UIs that need "load more" indicators
- API responses that must include total count for page controls

**When NOT to Use:**
- Cursor-based pagination with no need for total count
- Infinite scroll without page indicators
- Very large tables where COUNT(*) is expensive (use approximate count)

**Implementation:**
```typescript
export interface Page<T> {
  items: T[]
  total: number
  hasMore: boolean
}

async findPaginated(
  parentId: string,
  limit = 50,
  offset = 0,
): Promise<Page<T>> {
  const [dataResult, countResult] = await Promise.all([
    this.pool.query(
      `SELECT * FROM {{TABLE}}
       WHERE {{PARENT_FK}} = $1
       ORDER BY created_at ASC
       LIMIT $2 OFFSET $3`,
      [parentId, limit, offset],
    ),
    this.pool.query(
      'SELECT COUNT(*)::int AS total FROM {{TABLE}} WHERE {{PARENT_FK}} = $1',
      [parentId],
    ),
  ])

  const total = countResult.rows[0].total as number
  return {
    items: dataResult.rows.map(rowToEntity),
    total,
    hasMore: offset + limit < total,
  }
}
```

**Gotchas:**
- `COUNT(*)::int` cast is needed in PostgreSQL — default is bigint string
- For tables >1M rows, consider `EXPLAIN ANALYZE` on the COUNT query
- `Promise.all` is safe here because both queries are read-only

**Source:** КоммуниК, 2026-03-05 | `src/conversation/infrastructure/repositories/message-repository.ts`

---

### P-15: Upsert Pattern (ON CONFLICT DO UPDATE)

**Category:** Pattern | **Maturity:** Alpha | **Reusability:** HIGH

**Intent:** Use PostgreSQL `ON CONFLICT ... DO UPDATE` for idempotent writes where the same entity may be submitted multiple times (feedback, ratings, preferences).

**When to Use:**
- User can revise their input (feedback, votes, reviews)
- Webhook handlers that may receive duplicate events
- Sync operations where source data overwrites existing records

**When NOT to Use:**
- When you need audit trail of every change (use append-only + soft delete)
- When conflicts should be errors, not overwrites
- With non-PostgreSQL databases (syntax differs)

**Implementation:**
```typescript
async upsert(
  entityId: string,
  userId: string,
  data: UpsertData,
): Promise<Entity> {
  const { rows } = await this.pool.query(
    `INSERT INTO {{TABLE}} (entity_id, user_id, value, comment)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (entity_id, user_id)
     DO UPDATE SET value = $3, comment = $4, updated_at = NOW()
     RETURNING *`,
    [entityId, userId, data.value, data.comment ?? null],
  )
  return mapRow(rows[0])
}
```

**Prerequisites:** Unique constraint on the conflict columns (e.g., `UNIQUE(entity_id, user_id)`)

**Source:** КоммуниК, 2026-03-05 | `src/pql/application/services/ml-training-service.ts`

---

### P-16: Load-Balanced Assignment Queue

**Category:** Pattern | **Maturity:** Alpha | **Reusability:** MEDIUM

**Intent:** Assign work items (tickets, chats, tasks) to the least-loaded online agent, respecting maximum concurrent limits.

**When to Use:**
- Support chat / ticket assignment systems
- Task distribution among workers
- Any queue where items must be assigned to available agents

**When NOT to Use:**
- When assignments should be skill-based (need routing rules)
- When work items have priority queues (need priority queue, not round-robin)
- When agents pull work themselves (use pull-based queue instead)

**Implementation:**
```typescript
async findLeastLoadedAgent(groupId: string): Promise<string | null> {
  const onlineAgents = await this.presenceService.getOnline(groupId)
  if (onlineAgents.length === 0) return null

  const loadMap = await this.getAgentLoad(groupId) // Map<agentId, activeCount>

  let bestAgent: string | null = null
  let bestLoad = Infinity

  for (const agentId of onlineAgents) {
    const load = loadMap.get(agentId) ?? 0
    if (load < this.maxConcurrent && load < bestLoad) {
      bestLoad = load
      bestAgent = agentId
    }
  }

  return bestAgent
}
```

**Variants:**
- Add skill-based routing: filter agents by required skills before load check
- Add priority weights: multiply load by agent priority factor
- Add sticky assignment: prefer previously assigned agent for returning items

**Source:** КоммуниК, 2026-03-05 | `src/conversation/application/services/assignment-service.ts`

---

### P-17: JSONB Aggregate Storage

**Category:** Pattern | **Maturity:** Alpha | **Reusability:** MEDIUM

**Intent:** Store complex aggregates with nested structures in PostgreSQL JSONB columns, enabling schema evolution without migrations while keeping relational indexing.

**When to Use:**
- Aggregates whose internal structure evolves frequently
- Reports or documents with flexible nested data
- Hybrid relational + document storage needs

**When NOT to Use:**
- When you need foreign key constraints on nested data
- When nested data needs complex SQL joins
- When data structure is stable and simple

**Implementation:**
```typescript
// Save: serialize nested objects to JSONB
await pool.query(
  `INSERT INTO {{TABLE}} (id, tenant_id, status, data, metadata)
   VALUES ($1, $2, $3, $4, $5)`,
  [id, tenantId, status, JSON.stringify(nestedData), JSON.stringify(metadata)]
)

// Read: handle both pre-parsed and string values
function hydrateJsonb<T>(value: T | string | null, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') return JSON.parse(value)
  return value
}

// Usage in row mapper:
const data = hydrateJsonb(row.data, [])
const metadata = hydrateJsonb(row.metadata, null)
```

**Source:** КоммуниК, 2026-03-05 | `src/revenue/infrastructure/repositories/revenue-report-repository.ts`

---

### P-18: Status Transition Aggregate

**Category:** Pattern | **Maturity:** Alpha | **Reusability:** HIGH

**Intent:** Define valid state transitions as pure functions on an aggregate, preventing invalid state changes at the domain layer.

**When to Use:**
- Order lifecycles (DRAFT → CONFIRMED → SHIPPED → DELIVERED)
- Workflow states (OPEN → ASSIGNED → IN_PROGRESS → DONE)
- Any finite-state domain entity

**When NOT to Use:**
- When states are unlimited or user-defined
- When state machine is complex enough for a dedicated FSM library

**Implementation:**
```typescript
export type EntityStatus = 'OPEN' | 'ASSIGNED' | 'CLOSED' | 'ARCHIVED'

export interface Entity {
  id: string
  status: EntityStatus
  // ... other fields
}

// Pure functions for state transition guards
export function canAssign(entity: Entity): boolean {
  return entity.status === 'OPEN'
}

export function canClose(entity: Entity): boolean {
  return entity.status !== 'CLOSED' && entity.status !== 'ARCHIVED'
}

export function canArchive(entity: Entity): boolean {
  return entity.status === 'CLOSED'
}

// Factory with default state
export function createEntity(params: CreateParams): Omit<Entity, 'id' | 'createdAt'> {
  return {
    ...params,
    status: 'OPEN', // always starts OPEN
    metadata: params.metadata ?? {},
  }
}
```

**Gotchas:**
- Keep transition guards as pure functions (no side effects, no DB calls)
- Throw domain exceptions on invalid transitions, not silent failures
- Consider adding a transition log for audit trails

**Source:** КоммуниК, 2026-03-05 | `src/conversation/domain/aggregates/dialog.ts`

---

### P-19: Concurrent Dedup with Redis SETNX Lock

**Category:** Pattern + Rule | **Maturity:** Alpha | **Reusability:** HIGH

**Intent:** Prevent duplicate processing when multiple events arrive within a short window (e.g., user sends 3 messages/sec and each triggers analysis).

**When to Use:**
- Event-driven systems with possible duplicate events
- Webhook handlers receiving retries
- Any pipeline where concurrent identical work should be deduplicated

**When NOT to Use:**
- When duplicates are acceptable (idempotent operations)
- When you have a message broker with built-in dedup (Kafka exactly-once)

**Implementation:**
```typescript
// Acquire lock (returns true if lock obtained)
const lockKey = `lock:${scope}:${entityId}`
const acquired = await redis.set(lockKey, '1', 'EX', ttlSeconds, 'NX')

if (!acquired) {
  // Another process is already handling this entity
  return null
}

try {
  // Process the event
  const result = await processEvent(event)
  return result
} finally {
  // Release lock (or let TTL expire)
  await redis.del(lockKey)
}
```

**Rule:** Always set a TTL on the lock to prevent deadlocks if the process crashes. Typical TTL: 5-30 seconds depending on processing time.

**Source:** КоммуниК, 2026-03-05 | `docs/refinement.md` EC-01

---

### C-07: Widget esbuild Bundling

**Category:** Command | **Maturity:** Alpha | **Reusability:** HIGH

**Intent:** Bundle a standalone UI widget (chat widget, feedback form, embedded component) into a single minified JS file for embedding on third-party sites.

**When to Use:**
- Embeddable chat widgets
- Third-party site integrations
- Any standalone JS component that must load from a single `<script>` tag

**Implementation:**
```json
{
  "scripts": {
    "widget:build": "esbuild {{WIDGET_ENTRY}} --bundle --minify --outfile={{OUTPUT_PATH}}"
  }
}
```

**Prerequisites:** `esbuild` in devDependencies

**Source:** КоммуниК, 2026-03-05 | `package.json`

---

### C-08: assess-tests.sh (Ramsay Mode)

**Category:** Command | **Maturity:** Alpha | **Reusability:** HIGH

**Intent:** Automated test quality assessment with opinionated critique: coverage %, edge case detection, naming clarity, execution speed, flakiness detection, test isolation checks.

**When to Use:**
- Code review automation
- CI quality gates
- Brutal honesty feedback on test suites

**Implementation:** Bash script scanning test directories for:
- Coverage threshold check (configurable, default 80%)
- Edge case patterns (null, empty, boundary)
- Test naming clarity
- Execution time measurement
- Flaky test detection (multiple runs)
- Test isolation validation

**Dependencies:** `bash`, `npm`, `bc`, `git`

**Source:** КоммуниК, 2026-03-05 | `.claude/skills/brutal-honesty-review/scripts/assess-tests.sh`

---

### C-09: assess-code.sh (Linus Mode)

**Category:** Command | **Maturity:** Alpha | **Reusability:** HIGH

**Intent:** Automated code quality assessment: correctness (TODO/FIXME/BUG), performance (O(n^2), sync I/O), error handling (empty catch), concurrency, testability, maintainability.

**When to Use:**
- Pre-merge code review automation
- Quality gate in CI pipeline
- Tech debt scanning

**Dependencies:** `bash`, `grep`

**Source:** КоммуниК, 2026-03-05 | `.claude/skills/brutal-honesty-review/scripts/assess-code.sh`

---

### R-11: Performance Budget as Fitness Functions

**Category:** Rule | **Maturity:** Alpha | **Reusability:** HIGH

**Rule:** Define measurable performance budgets as automated tests (fitness functions), not as documentation wishes. Each budget has: metric, threshold, measurement method, and enforcement level (block deploy / block merge / alert only).

**Why:** Documentation says "should be fast" but nobody checks. Fitness function tests catch regressions in CI.

**Implementation:**
```markdown
| Metric | Budget | Enforcement | Measurement |
|--------|--------|-------------|-------------|
| API response time | < 200ms p95 | Block deploy | Prometheus histogram |
| Background job | < 2000ms p95 | Block merge | Jest performance test |
| External API call | < 700ms p95 | Alert | Circuit breaker metrics |
| Page load | < 3s | Block merge | Lighthouse CI |
```

**Scope:** Universal | **Expiry:** Permanent

**Source:** КоммуниК, 2026-03-05 | `docs/fitness-functions.md`

---

### R-12: Message Truncation for Analysis Pipelines

**Category:** Rule | **Maturity:** Alpha | **Reusability:** HIGH

**Rule:** When processing user-generated text through analysis pipelines (NLP, regex, ML), truncate input to a safe maximum length BEFORE analysis. Log a warning when truncation occurs. Never let unbounded input reach CPU-intensive regex or ML models.

**Example:**
```typescript
const MAX_ANALYSIS_LENGTH = 2000

function prepareForAnalysis(content: string): string {
  if (content.length > MAX_ANALYSIS_LENGTH) {
    console.warn(`[analysis] Truncating message from ${content.length} to ${MAX_ANALYSIS_LENGTH} chars`)
    return content.slice(0, MAX_ANALYSIS_LENGTH)
  }
  return content
}
```

**Why:** Without truncation, a 50KB message can cause regex backtracking or ML timeout, blocking the entire pipeline.

**Scope:** Universal | **Expiry:** Permanent

**Source:** КоммуниК, 2026-03-05 | `docs/refinement.md` EC-02

---

### T-08: Claude Code Skill Modular Structure

**Category:** Template | **Maturity:** Alpha | **Reusability:** HIGH

**Intent:** Structure complex Claude Code skills as modular directories with orchestrator SKILL.md and numbered module files.

**Template:**
```
.claude/skills/{{SKILL_NAME}}/
  SKILL.md                    # Orchestrator with frontmatter (name, description, version)
  modules/
    01-{{phase1}}.md          # Input → Process → Output → Quality Gate
    02-{{phase2}}.md
    03-{{phase3}}.md
  references/
    {{ref1}}.md               # Static reference data
  templates/
    {{template1}}.md          # Output templates
```

**Parameters:**

| Placeholder | Description | Required |
|-------------|-------------|----------|
| `{{SKILL_NAME}}` | kebab-case skill identifier | YES |
| `{{phaseN}}` | Phase name (e.g., `agent-review`, `classify`) | YES |
| `{{refN}}` | Reference document name | NO |
| `{{templateN}}` | Output template name | NO |

**When to Use:** Skills with 3+ phases, external dependencies, or complex output formats.

**Source:** КоммуниК, 2026-03-05 | `.claude/skills/knowledge-extractor/`, `.claude/skills/cc-toolkit-generator-enhanced/`

---

### S-08: Secret Validator (Fail-Fast Startup)

**Category:** Snippet | **Maturity:** Alpha | **Reusability:** HIGH

**Language:** TypeScript | **Lines:** 22 | **Dependencies:** None

**Intent:** Validate required secrets at application startup, crashing immediately if missing or weak. Prevents accidental production deployment with default/weak secrets.

**Code:**
```typescript
export function getSecret(envVar: string, devDefault?: string): string {
  return process.env[envVar] ?? devDefault ?? ''
}

export function validateSecrets(
  secrets: Array<{ envVar: string; minLength?: number; devDefault?: string }>
): void {
  for (const { envVar, minLength = 32, devDefault } of secrets) {
    const value = process.env[envVar]
    if (!value) {
      console.error(`FATAL: ${envVar} environment variable is not set`)
      process.exit(1)
    }
    if (devDefault && value === devDefault) {
      console.warn(`WARNING: Using default ${envVar} — not safe for production`)
    }
    if (value.length < minLength) {
      console.warn(`WARNING: ${envVar} should be at least ${minLength} characters`)
    }
  }
}

// Usage at startup:
// validateSecrets([
//   { envVar: 'JWT_SECRET', minLength: 32, devDefault: 'dev-secret-change-me' },
//   { envVar: 'ENCRYPTION_KEY', minLength: 32 },
// ])
```

**When to Use:** Any service with secrets (JWT, encryption keys, API tokens).
**When NOT to Use:** Serverless functions where env vars are always injected by platform.

**Source:** КоммуниК, 2026-03-05 | `src/shared/utils/jwt-secret.ts`

---

## Phase 4: Integration

### Maturity Assignment

| Maturity | Count | Notes |
|----------|:-----:|-------|
| Alpha | 14 | First extraction, used in 1 project |
| Beta | 0 | Need 2+ project validation |
| Stable | 0 | Need 3+ project validation |

### Artifacts Written

| # | Artifact | Location | Status |
|---|----------|----------|--------|
| P-13..P-19 | 7 patterns | `docs/harvest-report-wave3.md` (this file) | NEW |
| C-07..C-09 | 3 commands | `docs/harvest-report-wave3.md` (this file) | NEW |
| R-11..R-12 | 2 rules | `docs/harvest-report-wave3.md` (this file) | NEW |
| T-08 | 1 template | `docs/harvest-report-wave3.md` (this file) | NEW |
| S-08 | 1 snippet | `docs/harvest-report-wave3.md` (this file) | NEW |

### Cumulative Toolkit Index

| Category | Wave 1 | Wave 2 | Wave 3 | Total |
|----------|:------:|:------:|:------:|:-----:|
| Patterns | 12 | 5 | 7 | **24** |
| Rules | 10 | 2 | 2 | **14** |
| Commands | 6 | 0 | 3 | **9** |
| Templates | 7 | 0 | 1 | **8** |
| Snippets | 7 | 1 | 1 | **9** |
| **Total** | **42** | **8** | **14** | **64** |

---

## Top 5 Most Valuable New Extractions

1. **Redis Presence Tracking** (P-13) — Universal real-time status, works for any multi-tenant app
2. **Paginated Repository with Metadata** (P-14) — Every CRUD app needs this
3. **Status Transition Aggregate** (P-18) — State machine pattern for DDD
4. **Concurrent Dedup with Redis SETNX** (P-19) — Critical for event-driven systems
5. **Secret Validator** (S-08) — Should be in every Node.js service

## Recommendations

- **Promote to Beta after next project:** P-13 (Presence), P-14 (Pagination), P-18 (Status Transitions), S-08 (Secret Validator)
- **Combine with existing:** P-19 (Dedup) pairs well with P-12 (Inline Async Processing)
- **Create standalone package:** assess-tests.sh + assess-code.sh → reusable QA toolkit
- **Next harvest trigger:** After next project uses 3+ patterns from this toolkit

---

Last harvest: 2026-03-05
Total toolkit artifacts: 64
