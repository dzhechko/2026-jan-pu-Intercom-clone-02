# КоммуниК Project — Extracted Rules, Constraints & Lessons

## Summary
Scanned 25 insight documents, 12 ADRs, test suites, and architectural documentation.
**Total Rules Extracted:** 28
**Categories:** Security (8) | Architecture (6) | Testing (4) | TypeScript/JS (5) | Process (3) | Infrastructure (2)

---

## SECURITY RULES

### S-01: RLS Bypass — pool.query() vs req.dbClient.query()
- **Rule:** NEVER use `pool.query()` in repositories or handlers. ALWAYS use the request-scoped client.
- **Why:** `SET LOCAL app.tenant_id` runs on connection A, but `pool.query()` executes on connection B (from shared pool), meaning RLS sees no tenant context and returns all tenants' data.
- **Source:** `docs/insights/detail/2026-03-04-rls-bypass-pool-vs-dbclient.md`
- **Type:** Constraint
- **Scope:** PostgreSQL + Express applications with RLS
- **Expiry:** Permanent
- **Pattern to Follow:** Pass `dbClient` from middleware through service layer to repository, or use repository factory pattern that accepts the scoped client per request.
- **Test Evidence:** FF-03 (Tenant Data Isolation) integration tests verify this at CI time.

### S-02: SQL Injection in SET LOCAL — Use set_config() Instead
- **Rule:** NEVER use string interpolation in SQL context-setting. Use `set_config($1, true)` instead of `` SET LOCAL ``.
- **Why:** Even with Zod validation, defense-in-depth requires parameterized queries at every layer. String interpolation is a SQL injection vector.
- **Source:** `docs/insights/detail/2026-03-04-sql-injection-set-local.md`
- **Code Pattern:**
  ```typescript
  // WRONG
  await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`)

  // CORRECT
  await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId])
  ```
- **Type:** Constraint
- **Scope:** PostgreSQL, all server-side code
- **Expiry:** Permanent
- **Affected Files:** shared/middleware/tenant.middleware.ts, conversation/infrastructure/ws-handler.ts, route handlers

### S-03: Cross-Tenant Operator Assignment — Add Verification
- **Rule:** Before assigning a dialog to an operatorId, verify the operator belongs to the current tenant.
- **Why:** RLS is set on dialogs but doesn't validate that operatorId references a row in the operators table with matching tenant_id. This allows a tenant A JWT to assign dialogs to operators from tenant B.
- **Source:** `docs/insights/detail/2026-03-04-cross-tenant-assign-check.md`
- **Code Pattern:**
  ```typescript
  const operator = await operatorRepo.findById(operatorId)
  if (!operator || operator.tenantId !== tenantId) {
    return res.status(403).json({ error: 'Operator not in your tenant' })
  }
  ```
- **Type:** Constraint
- **Scope:** Any multi-tenant SaaS system with foreign key relationships across tenant boundaries
- **Severity:** CRITICAL — data isolation breach vector
- **Expiry:** Permanent
- **Affected:** conversation/infrastructure/assignment-routes.ts, conversation/application/services/assignment-service.ts

### S-04: Webhook HMAC Verification Missing
- **Rule:** Every webhook endpoint MUST verify the request signature using HMAC-SHA256 (Telegram) or shared secret header (VK Max). Return HTTP 401 for invalid signatures.
- **Why:** If webhook URLs are discovered via URL scanning, attackers can inject fake messages into the system.
- **Source:** `docs/insights/detail/2026-03-04-webhook-hmac-missing.md`
- **Code Pattern:**
  ```typescript
  app.post('/webhooks/telegram', (req, res) => {
    const secret = req.headers['x-telegram-bot-api-secret-token']
    if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Invalid signature' })
    }
  })
  ```
- **Type:** Constraint
- **Scope:** Message broker/webhook integrations
- **Severity:** HIGH — injection attack vector
- **Expiry:** Permanent
- **Affected:** integration/infrastructure/telegram-routes.ts, integration/infrastructure/vkmax-routes.ts

### S-05: JWT_SECRET Needs Startup Guard — Never Use Defaults
- **Rule:** Security-critical env vars (JWT_SECRET, ENCRYPTION_KEY) MUST fail fast at startup if missing or weak. Never use a fallback default.
- **Why:** Fallbacks create split-brain scenarios: token signing uses weak default, verification fails silently.
- **Source:** `docs/insights/detail/2026-03-04-jwt-secret-startup-guard.md`
- **Code Pattern:**
  ```typescript
  // In server.ts BEFORE route registration
  const JWT_SECRET = process.env.JWT_SECRET
  if (!JWT_SECRET || JWT_SECRET.length < 32) {
    console.error('FATAL: JWT_SECRET must be set and at least 32 chars')
    process.exit(1)
  }
  ```
- **Type:** Constraint
- **Scope:** Node.js/Express applications with security-critical env vars
- **Severity:** HIGH — silent security failure
- **Expiry:** Permanent
- **Related:** security.md rule "Security env vars MUST fail at startup, NEVER use defaults"

### S-06: Data Residency — Never Send Production Data to Foreign LLM APIs
- **Rule:** FORBIDDEN to send dialog content (customer messages, PII) to OpenAI, Anthropic, or any foreign LLM API for production data. ONLY on-premise vLLM or Cloud.ru MCP.
- **Why:** 152-ФЗ compliance (Russian data residency law) + customer trust + contractual obligations.
- **Source:** `CLAUDE.md` (ADR-003, FF-10)
- **Type:** Constraint
- **Scope:** Russian SaaS with PII or regulated data
- **Severity:** CRITICAL — compliance breach
- **Expiry:** Permanent (legal requirement)
- **Applies to:** All model inference for PQL detection, Memory AI, content analysis

### S-07: Circuit Breaker on Every MCP Adapter
- **Rule:** Every MCP adapter MUST use opossum Circuit Breaker with <3000ms timeout. NEVER call MCP directly from domain code.
- **Why:** MCP uptime faults should not cascade into domain failures. Circuit Breaker enables graceful degradation.
- **Source:** `CLAUDE.md` (ADR-008, FF-04)
- **Code Pattern:** Wrap MCP calls in Circuit Breaker with fallback behavior
- **Type:** Constraint
- **Scope:** Any system integrating external APIs/services
- **Severity:** HIGH — prevents cascade failures
- **Expiry:** Permanent

### S-08: Rate Limiting Rules (SH-03)
- **Rule:** Apply rate limits per endpoint and per tenant:
  - `/api/dialogs` — 100 req/min per operator
  - `/api/pql/feedback` — 300 req/min per operator
  - WebSocket — 50 events/sec per tenant namespace
  - Chat Widget — 10 msg/min per session (anti-spam)
- **Implementation:** express-rate-limit + Redis store
- **Source:** `CLAUDE.md` security rules (SH-03)
- **Type:** Constraint
- **Scope:** SaaS platforms with public APIs
- **Severity:** MEDIUM — spam/abuse prevention
- **Expiry:** Permanent

---

## ARCHITECTURE RULES

### A-01: Never Bypass Anti-Corruption Layer (MCP Adapters)
- **Rule:** Domain code MUST NOT call MCP protocol directly. All external API calls go through BC-04 (Integration) adapters.
- **Why:** Decouples domain from transport details. Adapter changes don't break business logic.
- **Source:** `CLAUDE.md` (ADR-002, ADR-008)
- **Type:** Constraint
- **Scope:** DDD systems with external integrations
- **Expiry:** Permanent
- **Pattern:** Define domain Port interface (e.g., CRMPort), implement as MCPAdapter in Integration BC, inject as dependency

### A-02: Singleton MCP Service Instances
- **Rule:** MCP service instances (e.g., VKMaxMCPService, TelegramBotService) MUST be created once at server startup and injected as singletons. NOT instantiated per-request.
- **Why:** Per-request instantiation creates a new Circuit Breaker for each call, meaning breaker state is never shared and the protection (FF-04) is bypassed.
- **Source:** `docs/insights/detail/2026-03-04-singleton-circuit-breaker.md`
- **Code Pattern:**
  ```typescript
  // In server.ts
  const vkmaxService = VKMaxMCPService.fromEnv()
  app.use('/api/vkmax', vkmaxRoutes(vkmaxService))
  ```
- **Type:** Constraint
- **Scope:** Node.js + Circuit Breaker libraries
- **Severity:** HIGH — breaks FF-04 fitness function
- **Expiry:** Permanent
- **Affected:** integration/services/vkmax-mcp-service.ts, integration/services/telegram-bot-service.ts

### A-03: No Cross-BC Imports (FF-02)
- **Rule:** Bounded Context modules MUST NOT import directly from other BCs. Use shared domain events only (shared/events/*).
- **Why:** Maintains modularity, enables future microservice decomposition.
- **Implementation:** ESLint no-restricted-imports rule + pre-commit hook
- **Source:** `CLAUDE.md` (FF-02)
- **Type:** Constraint
- **Scope:** DDD distributed monoliths
- **Severity:** HIGH — blocks enforcement at CI
- **Expiry:** Permanent

### A-04: Redis Streams for Event-Driven Communication (ADR-006)
- **Rule:** Async communication between BCs MUST use Redis Streams, NOT in-process events or polling.
- **Why:** Enables horizontal scaling. Single source of truth for event sequence. Easy monitoring.
- **Pattern:** `MessageReceived → [Redis Stream] → PQL Detector → PQLDetected → [WS push + Revenue]`
- **Source:** `CLAUDE.md` (ADR-006)
- **Type:** Constraint
- **Scope:** Event-driven distributed monoliths
- **Expiry:** Permanent

### A-05: Express Request Type Casting Requires Double-Cast
- **Rule:** When casting Express Request to custom types (e.g., TenantRequest), use `req as unknown as TenantRequest` (double-cast), NOT direct `req as TenantRequest`.
- **Why:** TypeScript struct compatibility check fails on direct cast. Unknown bypasses the check.
- **Source:** `docs/insights/detail/2026-03-04-express-request-cast.md`
- **Code Pattern:**
  ```typescript
  const tenantReq = req as unknown as TenantRequest
  ```
- **Better Alternative:** Type route handler generics properly or use declaration merging to extend Express types globally.
- **Type:** Gotcha (not a hard constraint, but a common pattern)
- **Scope:** TypeScript + Express
- **Expiry:** Permanent

### A-06: Opossum CircuitBreaker.fire() Return Type Needs Casting
- **Rule:** `CircuitBreaker.fire()` returns `Promise<unknown>`. When the wrapped function returns `Result<T>`, cast the result: `await this.breaker.fire({...}) as Result<any>`.
- **Why:** @types/opossum doesn't have generic overload for the wrapped function's return type.
- **Source:** `docs/insights/detail/2026-03-04-opossum-circuit-breaker-types.md`
- **Safe because:** You control the wrapped `callMCP` method.
- **Recommendation:** Create a `TypedCircuitBreaker<TInput, TOutput>` wrapper if many MCP adapters exist.
- **Type:** Pattern (codifies workaround for library limitation)
- **Scope:** opossum + TypeScript
- **Expiry:** Until @types/opossum adds generic overload

---

## TESTING RULES

### T-01: Jest Mock Strict Typing — Use mockResolvedValue
- **Rule:** With TypeScript strict mode, NEVER use `jest.fn(async () => value)`. Use `.mockResolvedValue()` or `.mockImplementation()` instead.
- **Why:** `jest.fn(async () => ...)` narrows the type to `Mock<Promise<T>, [], unknown>` (no params) which conflicts with interface parameter types.
- **Source:** `docs/insights/detail/2026-03-04-jest-mock-strict-typing.md`
- **Code Pattern:**
  ```typescript
  // WRONG
  const repo: jest.Mocked<MyRepo> = {
    findById: jest.fn(async () => null),  // TS2322
  }

  // CORRECT
  const repo: jest.Mocked<MyRepo> = {
    findById: jest.fn().mockResolvedValue(null),
  }
  ```
- **Type:** Constraint
- **Scope:** Jest + TypeScript strict mode
- **Expiry:** Permanent

### T-02: Jest coverageThreshold Property Name is Singular
- **Rule:** Jest config property is `coverageThreshold` (singular), NOT `coverageThresholds` (plural). Silent failure if misspelled.
- **Why:** Typo results in no coverage enforcement.
- **Source:** `docs/insights/detail/2026-03-04-jest-config-gotchas.md`
- **Type:** Gotcha
- **Scope:** Jest
- **Expiry:** Permanent

### T-03: Per-Directory Coverage Requires Global Key
- **Rule:** Jest coverageThreshold for per-directory thresholds MUST include a `global` key even if you only care about specific directories.
- **Why:** Jest requires `global` key to validate thresholds structure.
- **Code Pattern:**
  ```typescript
  coverageThreshold: {
    global: { lines: 50 },
    'src/pql/domain/': { lines: 95 }
  }
  ```
- **Source:** `docs/insights/detail/2026-03-04-jest-config-gotchas.md`
- **Type:** Gotcha
- **Scope:** Jest configuration
- **Expiry:** Permanent

### T-04: Run Master Validation Checklist After Toolkit Generation
- **Rule:** After code generation from templates, walk through the Master Validation Checklist and verify EVERY artifact exists.
- **Why:** AI compression anti-pattern: templates get summarized instead of copied verbatim, causing artifact loss.
- **Source:** `docs/insights/detail/2026-03-04-p1-checklist-validation.md`
- **Checklist:** 27 items covering Mandatory (P0), Conditional, Enterprise, Automation, and Pipeline-Specific artifacts
- **Type:** Pattern (defensive quality gate)
- **Scope:** AI-assisted code generation
- **Expiry:** Permanent (until AI models improve at preserving structure)

---

## JAVASCRIPT/TYPESCRIPT RULES

### L-01: JavaScript \w Does NOT Match Cyrillic Characters
- **Rule:** In JavaScript regex, `\w` matches `[a-zA-Z0-9_]` ONLY. For Cyrillic, use explicit ranges `[а-яёА-ЯЁ]` or Unicode property escapes `\p{L}` with `/u` flag.
- **Why:** `\w` is ASCII-only by ECMAScript spec.
- **Source:** `docs/insights/detail/2026-03-04-cyrillic-regex-js.md`
- **Code Example:**
  ```typescript
  // WRONG — doesn't match Cyrillic
  /платн\w+ верси/i

  // CORRECT
  /платн[а-яё]+ верси/i
  // OR
  /платн\p{L}+ верси/u
  ```
- **Type:** Constraint
- **Scope:** JavaScript/TypeScript + international text (Cyrillic, Arabic, Chinese, etc.)
- **Expiry:** Permanent
- **Project Exception:** КоммуниК DEFAULT_RULES already use explicit Cyrillic ranges, so this only affected custom test rules.

### L-02: Socket.io Server Has No .toRoom() — Wrap It
- **Rule:** Socket.io Server doesn't have `.toRoom()` method. When using Socket.io as a PushEmitter, wrap it with an adapter that provides the expected interface.
- **Why:** Domain ports shouldn't depend on infrastructure API shapes. Hexagonal architecture.
- **Source:** `docs/insights/detail/2026-03-04-socketio-toroom-wrapper.md`
- **Code Pattern:**
  ```typescript
  interface PushEmitter {
    toRoom(room: string): { emit(event: string, payload: unknown): void }
  }

  const notificationService = new NotificationService({
    pushEmitter: { toRoom: (room: string) => io.to(room) },
  })
  ```
- **Type:** Pattern (infrastructure adapter)
- **Scope:** Node.js + Socket.io + Hexagonal Architecture
- **Expiry:** Permanent

### L-03: TypeScript Requires @types/opossum Package
- **Rule:** Must install both `opossum` AND `@types/opossum` as dependencies. Types are a separate package.
- **Why:** opossum doesn't include TypeScript definitions out-of-the-box.
- **Source:** `docs/insights/detail/2026-03-04-opossum-circuit-breaker-types.md`
- **Type:** Gotcha
- **Scope:** TypeScript + opossum
- **Expiry:** Until opossum adds native TypeScript support

### L-04: AI Template Lossy Compression — Anti-Pattern
- **Rule:** When instructing AI to generate files from templates, use explicit anti-compression guards: "COPY, DO NOT SUMMARIZE" + validation checklist.
- **Why:** AI naturally compresses (summarizes) detailed templates into "gist" versions, losing structural details.
- **Source:** `docs/insights/detail/2026-03-04-template-lossy-compression.md`
- **Defense Layers:**
  1. Per-item anti-compression instruction in module
  2. Validation checklist after generation (verify output line count, key sections)
  3. Global anti-compression rule in SKILL.md
- **Type:** Pattern (critical for prompt engineering with AI)
- **Scope:** AI-assisted code generation (Claude, GPT, etc.)
- **Expiry:** Permanent (or until LLMs improve at instruction-following)

---

## PROCESS RULES

### P-01: Never Bypass Skill Chain — /next → /go → /plan|/feature
- **Rule:** Feature development MUST follow the prescribed skill chain. FORBIDDEN to launch raw agents in parallel waves or skip phases. One feature = one commit + push.
- **Why:** Skipping phases results in:
  - Missing documentation (`docs/plans/` files)
  - Batch commits instead of per-feature commits
  - No GitHub pushes until end-of-session
  - No complexity scoring via `/go`
  - No validation phase
- **Source:** `docs/insights/detail/2026-03-04-run-protocol-violation.md`
- **Mandatory Language:** Rules MUST use blocking language (MUST/FORBIDDEN/NEVER/CRITICAL), not descriptive language. "Soft" phrasing like "Run /next to get..." is interpreted as optional.
- **Type:** Process constraint
- **Scope:** Claude Code project with feature lifecycle
- **Severity:** HIGH — breaks project workflow
- **Expiry:** Permanent
- **Added To:** CLAUDE.md "MANDATORY Development Rules" section

### P-02: Process Commands Must Use Blocking Language
- **Rule:** Process/workflow documentation MUST use hard constraints (MUST/FORBIDDEN/NEVER/CRITICAL) instead of soft language (recommended, should, try).
- **Why:** Soft phrasing is interpreted as optional by both humans and AI agents. Hard phrasing is treated as non-negotiable.
- **Source:** `docs/insights/detail/2026-03-04-run-protocol-violation.md`
- **Example:**
  - BAD: "Run /next to get progress"
  - GOOD: "MUST execute /next skill before /go. FORBIDDEN to skip this step."
- **Type:** Constraint (meta-rule for documentation)
- **Scope:** Process documentation, command specifications
- **Expiry:** Permanent

### P-03: Parallel Validation + Review Agents — Efficient Feature Audit
- **Rule:** When auditing multiple features, launch validation and review agents in parallel batches (3 agents at a time) instead of sequentially.
- **Why:** 6x speedup (30 min → 5 min for 6 features) because agents work on non-overlapping files.
- **Pattern:**
  1. Batch 1: Launch validation agents for 3 features (parallel)
  2. Batch 2: Launch review agents for 3 features (parallel, concurrent with batch 1)
  3. Wait for batch 1 → launch review agents for newly validated features
  4. Wait for all → commit
- **Source:** `docs/insights/detail/2026-03-04-parallel-validation-review.md`
- **Type:** Pattern (optimization)
- **Scope:** Claude Code with multi-agent swarms
- **Expiry:** Permanent
- **Constraint:** Agents must work on non-overlapping files (no conflicts).

---

## INFRASTRUCTURE RULES

### I-01: Wave-Based Parallel Feature Implementation (For Speed)
- **Rule:** When implementing many features with dependency chains, group into "waves" based on dependency DAG and run waves in parallel. Use only when documentation is NOT required.
- **Why:** Max parallelism (e.g., 4 agents simultaneously) reduces wall-clock time from sequential execution.
- **Source:** `docs/insights/detail/2026-03-04-wave-parallel-implementation.md`
- **Example Wave Structure:**
  ```
  Wave 1 (no deps):     IAM-01 + FR-04                    — parallel
  Wave 2 (depends W1):  FR-07                             — sequential
  Wave 3 (depends W2):  FR-02 + FR-03 + FR-05             — parallel
  Wave 4 (depends W2):  FR-11 + FR-09 + FR-13 + FR-14     — parallel
  Wave 5 (depends W3):  FR-06 + FR-08 + FR-10 + FR-12     — parallel
  ```
- **Caveat:** Bypasses documentation lifecycle. Use only for:
  - Hackathons / rapid prototyping
  - When explicitly told "speed over process"
  - NEVER as default
- **Type:** Pattern (speed optimization)
- **Scope:** Multi-feature development with parallelization
- **Severity:** LOW — trade-off optimization
- **Expiry:** Permanent (for context)

### I-02: Modular Skills Require Reading ALL Module Files
- **Rule:** When a skill has a `modules/` directory, read ALL numbered module files (01-*.md, 02-*.md, etc.), NOT just SKILL.md. SKILL.md is only the orchestrator.
- **Why:** Actual generation logic and artifact specs live in modules. Skipping module files results in missing artifacts (e.g., feature-roadmap.json, hooks, commands).
- **Source:** `docs/insights/detail/2026-03-04-modular-skill-modules-must-read.md`
- **CRITICAL:** cc-toolkit-generator-enhanced has 9 modules (6 core pipeline + 3 extensions). Missing these caused 10+ artifacts to be omitted.
- **Type:** Constraint
- **Scope:** Modular skill systems
- **Severity:** CRITICAL — missing critical artifacts
- **Expiry:** Permanent

---

## SUMMARY TABLE

| Rule ID | Category | Type | Scope | Severity | Universally Applicable? |
|---------|----------|------|-------|----------|------------------------|
| S-01 | Security | Constraint | PostgreSQL + RLS | CRITICAL | Yes (RLS systems) |
| S-02 | Security | Constraint | SQL | CRITICAL | Yes (all SQL) |
| S-03 | Security | Constraint | Multi-tenant SaaS | CRITICAL | Yes (FK relationships) |
| S-04 | Security | Constraint | Webhooks | HIGH | Yes (webhook systems) |
| S-05 | Security | Constraint | Node.js/Env vars | HIGH | Yes (security) |
| S-06 | Security | Constraint | Data residency | CRITICAL | Regional only (RU) |
| S-07 | Security | Constraint | External APIs | HIGH | Yes (integration) |
| S-08 | Security | Constraint | SaaS APIs | MEDIUM | Yes (public APIs) |
| A-01 | Architecture | Constraint | DDD systems | HIGH | Yes (DDD) |
| A-02 | Architecture | Constraint | Circuit Breaker | HIGH | Yes (CB pattern) |
| A-03 | Architecture | Constraint | Distributed monolith | HIGH | Yes (modular systems) |
| A-04 | Architecture | Constraint | Event-driven | HIGH | Yes (async systems) |
| A-05 | Architecture | Gotcha | TypeScript + Express | LOW | Yes (TypeScript) |
| A-06 | Architecture | Pattern | opossum | LOW | Library-specific |
| T-01 | Testing | Constraint | Jest + TS strict | HIGH | Yes (Jest) |
| T-02 | Testing | Gotcha | Jest config | LOW | Jest only |
| T-03 | Testing | Gotcha | Jest config | LOW | Jest only |
| T-04 | Testing | Pattern | AI generation | HIGH | AI-assisted projects |
| L-01 | Language | Constraint | JS regex + i18n | HIGH | Yes (non-ASCII) |
| L-02 | Language | Pattern | Node.js + Socket.io | LOW | Library-specific |
| L-03 | Language | Gotcha | TS + opossum | LOW | Library-specific |
| L-04 | Language | Pattern | Prompt engineering | HIGH | AI-assisted projects |
| P-01 | Process | Constraint | Workflow | HIGH | Yes (feature dev) |
| P-02 | Process | Constraint | Documentation | HIGH | Yes (process docs) |
| P-03 | Process | Pattern | Multi-agent swarms | LOW | Optimization only |
| I-01 | Infrastructure | Pattern | Parallelization | LOW | Optimization only |
| I-02 | Infrastructure | Constraint | Modular skills | CRITICAL | Skill systems |

---

## LESSONS LEARNED BY DOMAIN

### DDD / Architecture
1. **Singleton pattern required for stateful services** (A-02) — Circuit Breaker state must be global
2. **RLS is not enough for foreign keys** (S-03) — need explicit verification at assignment time
3. **Anti-corruption layer is non-negotiable** (A-01) — domain types never depend on infrastructure
4. **Event streaming is better than polling** (A-04) — use Redis Streams over in-process events

### Security
1. **Defense in depth on RLS** (S-01, S-02) — use both DB RLS AND application validation
2. **Fail fast on security config** (S-05) — no fallbacks, no weak defaults
3. **Validate foreign keys belong to tenant** (S-03) — RLS doesn't catch this automatically
4. **Sign all webhooks** (S-04) — obscurity is not security
5. **Never send PII to foreign APIs** (S-06) — compliance + trust + contractual obligations

### Testing
1. **Jest configuration has gotchas** (T-02, T-03) — verify property names and structure
2. **TypeScript strict mode + mocking requires special patterns** (T-01) — use mockResolvedValue
3. **Validation checklists catch AI compression** (T-04) — run them every time after generation

### Internationalization (i18n)
1. **JavaScript regex has ASCII bias** (L-01) — explicit character ranges for non-Latin scripts
2. **Regex `/u` flag enables Unicode property escapes** (L-01) — `\p{L}` for any letter

### Prompt Engineering / AI
1. **Lossy compression is a real risk** (L-04) — use explicit anti-compression guards in prompts
2. **Modular documentation must be fully read** (I-02) — don't skip module files
3. **Validation checklists are essential QA** (T-04) — run after every generation

### DevOps / Infrastructure
1. **Stateful services must be singletons** (A-02) — per-request instantiation breaks state
2. **Parallel agents need non-overlapping files** (P-03) — no race conditions on writes
3. **Process documentation needs blocking language** (P-02) — soft language is ignored

---

## RULES THAT GENERALIZE BEYOND КоммуниК

**Universally Applicable (to any DDD/SaaS):**
- S-01, S-02, S-03, S-04, S-05, S-07, S-08 (Security)
- A-01, A-03, A-04 (Architecture)
- T-01 (Jest + TypeScript)
- L-01 (Regex + i18n)
- P-01, P-02 (Process)

**Framework/Library Specific:**
- A-02 (opossum circuit breaker)
- A-05, A-06 (Express/opossum)
- L-02, L-03 (Socket.io/opossum)
- T-02, T-03 (Jest)

**Language Specific:**
- L-01 (JavaScript)
- S-02, L-04 (SQL injection)

**Organizational/Process Specific:**
- T-04 (AI-assisted projects)
- I-01 (Wave-based parallelization)
- I-02 (Modular skill systems)
