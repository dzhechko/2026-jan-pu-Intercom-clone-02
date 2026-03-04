# Development Insights — КоммуниК

## Recent
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

## Stats
Total: 14 insights | Most active: tooling (3), integration (3), security (2), testing (2)
