---
name: testing-patterns
description: >
  КоммуниК testing patterns and strategies. BDD Gherkin scenario mappings, coverage targets
  from fitness functions, test organization by bounded context. Triggers: "test strategy",
  "how to test", "coverage requirements", "BDD scenarios".
version: "1.0"
maturity: production
---

# Testing Patterns — КоммуниК

## Coverage Targets (from Fitness Functions)

| Scope | Lines | Functions | Branches | Source |
|-------|-------|-----------|----------|--------|
| `src/pql/domain/` | >= 95% | 100% | >= 90% | FF-05 |
| Global | >= 50% | — | — | jest.config.ts |

## Test Organization

```
src/{bc}/domain/        → Unit tests (*.test.ts) — pure domain logic
tests/integration/      → Integration tests — DB, Redis, MCP
tests/fitness/          → Fitness function tests — architectural constraints
tests/e2e/              → End-to-end tests — API + WebSocket flows
```

## Mandatory Tests (block merge)

| Test | BC | What it verifies |
|------|-----|------------------|
| RuleEngine signals | pql | All 15 signal patterns match correctly |
| RuleEngine scoring | pql | Normalized score 0-1, top 3 sorting |
| RLS isolation | iam | Tenant A cannot see Tenant B data |
| Circuit Breaker | integration | MCP timeout → fallback, recovery after reset |
| Revenue Attribution | revenue | PQL flag → CRM deal → attribution link |

## BDD Gherkin Features (from `docs/test-scenarios.feature`)

| Feature | Scenarios | Key Steps |
|---------|-----------|-----------|
| PQL Detection | 6 | Given message → When analyzed → Then PQL signal detected |
| Memory AI | 4 | Given email → When CRM queried → Then context loaded |
| Chat Widget | 4 | Given widget → When message sent → Then delivered to operator |
| Revenue Report | 3 | Given PQL → When deal closed → Then attributed in report |
| Operator Workspace | 4 | Given PQL dialog → When operator opens → Then sidebar shows context |
| Tenant Isolation | 3 | Given tenant A → When querying → Then only tenant A data visible |

## Given/When/Then Step Mappings

### Given Steps
- `Given a message "{text}"` → `const message = "{text}"`
- `Given a dialog with tenant "{id}"` → `await createDialog(tenantId)`
- `Given amoCRM returns contact` → `mockMCP('get_contact_by_email', {...})`
- `Given PQL detector is configured` → `const rules = DEFAULT_RULES`

### When Steps
- `When PQL detector analyzes` → `const result = analyzeRules(message, rules)`
- `When Memory AI loads context` → `const ctx = await crmPort.getContactContext(email, tenantId)`
- `When revenue report generates` → `await revenueService.generateReport(tenantId, period)`

### Then Steps
- `Then PQL signal "{type}" detected` → `expect(result.signals.map(s => s.type)).toContain("{type}")`
- `Then PQL score >= {threshold}` → `expect(result.normalizedScore).toBeGreaterThanOrEqual({threshold})`
- `Then deal created in CRM` → `expect(mockCreateDeal).toHaveBeenCalled()`

## Test Naming Convention

```typescript
describe('{ClassName or Module}', () => {
  describe('{methodName}', () => {
    it('should {expected behavior} when {condition}', () => { ... })
    it('should throw {ErrorType} when {invalid condition}', () => { ... })
  })
})
```

## Performance Test Thresholds

| Metric | Target | Test Method |
|--------|--------|-------------|
| PQL detection latency | < 2000ms p95 | FF-01: measure 100 concurrent |
| Message delivery | < 500ms p95 | WebSocket round-trip |
| CRM context load | < 1000ms | MCP adapter with circuit breaker |
| Redis Stream lag | < 1000 messages | FF-08: stream monitoring |
