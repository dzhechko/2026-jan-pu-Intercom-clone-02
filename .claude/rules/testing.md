# Testing Rules — КоммуниК

## Test Strategy

| Level | What | Coverage Target |
|-------|------|:---------------:|
| Unit | Domain logic, value objects, rule engine | ≥ 95% (FF-05 for RuleEngine) |
| Integration | DB with RLS, Redis Streams, MCP adapters | Key flows |
| E2E | Critical user journeys (PQL detection, Revenue Report) | Happy path + top errors |

## Mandatory Tests

### RLS Isolation (FF-03) — CRITICAL
```typescript
describe('RLS Isolation', () => {
  it('tenant A cannot see tenant B dialogs')
  it('direct UUID access to other tenant returns empty')
})
```
Run in CI, blocks merge on failure.

### Circuit Breaker (FF-04)
```typescript
describe('MCPAdapter', () => {
  it('returns fallback when circuit OPEN')
  it('transitions to OPEN after 3 failures')
  it('timeout <= 3000ms')
})
```

### PQL RuleEngine (FF-05)
Each of 15+ rules must have:
- Positive match test
- Negative match test
- Case insensitive test
- Weight contribution test

Coverage: `jest --coverage --collectCoverageFrom="src/pql/rule-engine/**"` ≥ 95%

### Edge Cases (from docs/refinement.md)
- EC-01: Concurrent messages — deduplicated
- EC-02: Long messages >5000 chars — truncated
- EC-03: Unicode/emoji — normalized
- EC-04: Partial MCP data — graceful degradation
- EC-05: Missing email — no attribution

## BDD Scenarios
Reference: `docs/test-scenarios.feature`
- PQL Detection: 7 scenarios
- Memory AI: 3 scenarios
- Revenue Report: 4 scenarios
- Operator Workspace: 4 scenarios
- Multi-tenancy: 3 scenarios
- PQL Feedback: 3 scenarios

## Running Tests
```bash
npm test                          # all tests
npm test -- --testPathPattern=pql # specific BC
npm run fitness                   # fitness functions
npm run fitness:critical          # only CRITICAL fitness
npm run lint:arch                 # BC isolation check (FF-02)
```

## CI Pipeline
1. Type check: `tsc --noEmit`
2. Lint + arch check: `npm run lint && npm run lint:arch`
3. Unit tests with coverage
4. Integration tests (RLS, MCP)
5. Fitness functions (critical)
6. Build: `npm run build`

Blocks merge if any step fails.
