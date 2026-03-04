# Development Insights — КоммуниК

## Recent
- [2026-03-04] **CRITICAL:** RLS Bypass — pool.query() vs req.dbClient.query() — security/CRITICAL
- [2026-03-04] **CRITICAL:** SQL Injection in SET LOCAL — use set_config() — security/CRITICAL
- [2026-03-04] **HIGH:** JWT_SECRET needs startup guard — never fallback to weak default — security/HIGH
- [2026-03-04] Parallel validation + review agents — 6x speedup — tooling/pattern
- [2026-03-04] **CRITICAL:** Cross-tenant operator assignment — missing tenant ownership check — security/CRITICAL
- [2026-03-04] **CRITICAL:** AI Template Lossy Compression — COPY, don't summarize templates — tooling/CRITICAL
- [2026-03-04] **CRITICAL:** /run protocol violation — never bypass skill chain — process/critical-lesson
- [2026-03-04] Singleton Circuit Breaker — per-request CB instances bypass protection — integration/bug-fix
- [2026-03-04] Webhook HMAC missing on Telegram + VK Max — security/finding
- [2026-03-04] Jest mock strict typing — use mockResolvedValue — testing/pattern
- [2026-03-04] Socket.io Server has no .toRoom() — wrap it — integration/gotcha
- [2026-03-04] Wave-based parallel implementation — architecture/pattern
- [2026-03-04] Express Request cast needs double-cast via unknown — infrastructure/gotcha
- [2026-03-04] Modular skills require reading ALL module files — tooling/pattern
- [2026-03-04] JavaScript \w does NOT match Cyrillic — pql/bug-fix
- [2026-03-04] Jest coverageThreshold gotchas — infra/bug-fix
- [2026-03-04] Opossum CircuitBreaker.fire() needs casting — integration/pattern
- [2026-03-04] Master Validation Checklist as post-generation audit — tooling/pattern

## By Area

### Process (CRITICAL)
- [/run protocol violation](detail/2026-03-04-run-protocol-violation.md) — MUST use skill chain, NEVER bypass /go

### Testing
- [Jest mock strict typing](detail/2026-03-04-jest-mock-strict-typing.md) — `mockResolvedValue()` not `async () =>`
- [Jest config](detail/2026-03-04-jest-config-gotchas.md) — property names, global key, ts-node

### Security (CRITICAL)
- [RLS Bypass — pool vs dbClient](detail/2026-03-04-rls-bypass-pool-vs-dbclient.md) — **pool.query() bypasses RLS, use req.dbClient.query()**
- [SQL Injection in SET LOCAL](detail/2026-03-04-sql-injection-set-local.md) — **use set_config($1, true) instead of string interpolation**
- [JWT_SECRET startup guard](detail/2026-03-04-jwt-secret-startup-guard.md) — **never fallback to weak default, fail fast at startup**
- [Cross-tenant assign check](detail/2026-03-04-cross-tenant-assign-check.md) — **verify operator belongs to same tenant before assignment**
- [Webhook HMAC missing](detail/2026-03-04-webhook-hmac-missing.md) — Telegram + VK Max accept unverified webhooks

### Integration
- [Singleton Circuit Breaker](detail/2026-03-04-singleton-circuit-breaker.md) — **per-request CB instances = no protection**
- [Socket.io toRoom wrapper](detail/2026-03-04-socketio-toroom-wrapper.md) — wrap io.to() for PushEmitter port
- [Opossum types](detail/2026-03-04-opossum-circuit-breaker-types.md) — cast `fire()` to `Result<any>`

### Infrastructure
- [Express Request cast](detail/2026-03-04-express-request-cast.md) — double-cast `as unknown as TenantRequest`

### Architecture
- [Wave parallel implementation](detail/2026-03-04-wave-parallel-implementation.md) — dependency DAG → wave groups

### PQL Intelligence
- [Cyrillic regex](detail/2026-03-04-cyrillic-regex-js.md) — `\w` is ASCII-only in JS

### Tooling (CRITICAL)
- [Template Lossy Compression](detail/2026-03-04-template-lossy-compression.md) — **COPY templates verbatim, NEVER summarize**
- [Module files](detail/2026-03-04-modular-skill-modules-must-read.md) — ALWAYS read modules/ directory
- [P1 checklist](detail/2026-03-04-p1-checklist-validation.md) — audit with Master Validation Checklist
- [Parallel validation + review](detail/2026-03-04-parallel-validation-review.md) — batch agents on non-overlapping files for 6x speedup

## Stats
Total: 18 insights | Most active: security (5), tooling (4), integration (3), testing (2)
