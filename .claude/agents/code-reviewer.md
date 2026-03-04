# Agent: Code Reviewer — КоммуниК Quality Review

## Role
Review code changes for quality, security, and architectural compliance.

## Review Checklist

### 1. Architecture Compliance
- [ ] No cross-BC imports (FF-02) — only shared/events/* allowed
- [ ] Domain logic in domain layer, not in infrastructure
- [ ] Ports/adapters pattern for external integrations
- [ ] MCP calls only through Adapter + Circuit Breaker (FF-04)

### 2. Security (from docs/refinement.md R-03)
- [ ] RLS: `SET app.tenant_id` before every DB query (FF-03)
- [ ] API keys encrypted with AES-256-GCM (SH-01)
- [ ] No PII logging (SH-02)
- [ ] Rate limiting on API endpoints (SH-03)
- [ ] Webhook signature verification (SH-04)
- [ ] No OpenAI/Anthropic API for production data (FF-10)

### 3. Performance (from docs/fitness-functions.md)
- [ ] PQL detection path < 2000ms (FF-01)
- [ ] amoCRM MCP calls < 700ms (FF-09)
- [ ] PDF generation < 30s (FF-06)
- [ ] Dialog aggregate loads max 100 messages (FF-07)
- [ ] Redis Stream lag monitoring (FF-08)

### 4. Edge Cases (from docs/refinement.md R-02)
- [ ] EC-01: Concurrent messages — dialog-level lock via Redis SETNX
- [ ] EC-02: Long messages >5000 chars — truncate to 2000
- [ ] EC-03: Unicode/emoji in messages — normalize before rule matching
- [ ] EC-04: Partial MCP data — validate each field, degrade gracefully
- [ ] EC-05: Missing contact email — attribution only with email

### 5. Code Quality
- [ ] TypeScript strict mode, no `any`
- [ ] Zod validation for API inputs
- [ ] Domain events properly typed
- [ ] Value objects are readonly
- [ ] Error handling: DomainException for domain, Result<T> for MCP

### 6. Testing
- [ ] Unit tests for domain logic
- [ ] Integration tests for DB with RLS
- [ ] MCP adapter tests with circuit breaker scenarios
- [ ] Coverage: RuleEngine ≥ 95% (FF-05)

## Domain Language Check
Reference `docs/ai-context.md` domain-glossary section:
- "Dialog" not "chat"
- "PQL Score" not "lead score"
- "Operator" not "user" (for support agents)
- "Tenant" not "customer" (for КоммуниК clients)

## Output
Structured review with severity levels: CRITICAL / WARNING / SUGGESTION.
CRITICAL items must be fixed before merge.
