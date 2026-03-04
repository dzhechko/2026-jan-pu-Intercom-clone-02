# Harvest Report: КоммуниК (Intercom Clone)

**Date:** 2026-03-04
**Source Project:** КоммуниК — Revenue Intelligence Platform
**Mode:** Full (4-phase pipeline)

## Summary

| Metric | Value |
|--------|-------|
| Agents deployed | 5 (patterns, commands, rules, templates, snippets) |
| Raw candidates found | 52 |
| After dedup + exclusion | 18 |
| Artifacts extracted | 18 |
| Artifacts skipped | 34 |
| New artifacts | 18 |
| Updated artifacts | 0 |

## Extracted Artifacts

### Snippets (3)

| # | Name | Maturity | Description |
|---|------|----------|-------------|
| 1 | Result Type (Ok/Err) | Alpha | Discriminated union for railway-oriented error handling. `Result<T, E> = {ok: true, value: T} \| {ok: false, error: E}` with `ok()` and `err()` constructors. |
| 2 | DomainException | Alpha | Base exception class with error codes for domain rule violations. Decouples error identification from HTTP status mapping. |
| 3 | AES-256-GCM Encrypt/Decrypt | Alpha | Authenticated encryption using Node.js crypto. Random IV + auth tag stored with ciphertext. Key from env var, never persisted. |

### Patterns (6)

| # | Name | Maturity | Description |
|---|------|----------|-------------|
| 4 | Tenant Isolation (JWT + RLS) | Alpha | Express middleware extracting JWT claims → setting PostgreSQL RLS context. Defense-in-depth multi-tenancy. |
| 5 | Circuit Breaker + ACL Adapter | Alpha | Opossum circuit breaker wrapping external API calls. Anti-Corruption Layer translates external types → domain types. |
| 6 | Rule Engine (regex + scoring) | Alpha | Generic content analyzer: regex patterns with weights → normalized score (0-1) + top-N signals. Works for classification, moderation, intent detection. |
| 7 | Port/Adapter (Hexagonal) | Alpha | Domain defines interface (Port), infrastructure implements (Adapter). Enables testing with mocks, swapping implementations. |
| 8 | Domain Events Shared Kernel | Alpha | Strongly-typed domain events as discriminated union. Base interface: eventId, occurredAt, tenantId. Cross-BC communication contract. |
| 9 | Progressive LLM Enhancement | Alpha | AI features in phases: v1=rules (no GPU) → v2=fine-tuned model (CPU) → v3=full LLM (GPU). Each phase works independently. |

### Templates (3)

| # | Name | Maturity | Description |
|---|------|----------|-------------|
| 10 | Multi-Stage Dockerfile (Node.js) | Alpha | 3-stage build: deps → build → production. Non-root user, minimal image, separated build/runtime dependencies. |
| 11 | Docker Compose + Health Checks | Alpha | Multi-service orchestration: app + worker + postgres + redis + nginx. Health checks on all services, dependency ordering, internal networks. |
| 12 | Nginx Reverse Proxy + WS | Alpha | Rate limiting zones, WebSocket upgrade headers, static asset caching, location-based routing, health endpoint bypass. |

### Snippets (continued)

| # | Name | Maturity | Description |
|---|------|----------|-------------|
| 13 | SQL Migration Runner | Alpha | Node.js script: tracks migrations in DB table, executes .sql files in order, transactional rollback on failure. Zero dependencies beyond `pg`. |

### Hooks (1)

| # | Name | Maturity | Description |
|---|------|----------|-------------|
| 14 | SessionStart Sprint Context | Alpha | Python hook reads feature-roadmap.json + git log + TODO count. Injects sprint progress at session start. Timeout ≤10s. |

### Rules (4)

| # | Name | Maturity | Description |
|---|------|----------|-------------|
| 15 | JS regex `\w` is ASCII-only | Alpha | `\w` does NOT match Cyrillic/Unicode. Use `[а-яёА-ЯЁ]` or `\p{L}` with `/u` flag for non-ASCII. |
| 16 | Jest coverageThreshold is silent | Alpha | Wrong property name (`coverageThresholds`) = no coverage enforcement. Also: `global` key required even for per-directory thresholds. |
| 17 | Read ALL module files for modular skills | Alpha | SKILL.md is orchestrator only. Actual generation specs live in numbered module files. Skipping modules = missing entire artifact categories. |
| 18 | ACL + Circuit Breaker for external APIs | Alpha | Never call external APIs from domain. Always wrap in adapter with ACL (type translation) + Circuit Breaker (fault tolerance). |

## Skipped Items (top reasons)

| Reason | Count |
|--------|-------|
| Duplicate (same finding from multiple agents) | 15 |
| Domain-specific (Russian PQL signals, KommuniQ naming) | 8 |
| Standard config defaults (postcss, tailwind base) | 4 |
| Project-specific commands (/start, /run tied to roadmap) | 4 |
| Framework workaround with expiry (Puppeteer memory) | 2 |
| Too narrow scope (amoCRM status mapping) | 1 |

## Toolkit Status

Total artifacts extracted: 18
- Snippets: 4
- Patterns: 6
- Templates: 3
- Rules: 4
- Hooks: 1
- Skills: 0
- Commands: 0

All maturity: Alpha (first extraction, untested outside source project)

## Recommendations

1. **Result Type + DomainException** → Promote to Beta after use in 1 more project. These are universal TypeScript patterns.
2. **Tenant Isolation (JWT+RLS)** → Strong candidate for a reusable skill with `SKILL.md`. Applicable to any multi-tenant SaaS.
3. **Circuit Breaker + ACL** → Create a template adapter generator for external API integrations.
4. **Migration Runner** → Extract as standalone npm package or template. Zero project dependencies.
5. **Progressive LLM Enhancement** → Document as architectural decision template (ADR format) for AI feature roadmaps.
6. **Docker templates** → Parameterize with `{{PLACEHOLDERS}}` for project-agnostic scaffold generation.

## Next Harvest

Run after: M1 milestone completion (4 weeks)
Focus on: Integration patterns (MCP, WebSocket), Testing patterns (fixture factories, E2E)
