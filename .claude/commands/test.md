# /test $ARGUMENTS — Test Generation & Execution

## Role
Generate and run tests for КоммуниК components.

## Input
`$ARGUMENTS` — scope: "all", "pql", "conversation", "revenue", BC name, or specific file path

## Process

### 1. Determine Scope

| Argument | Action |
|----------|--------|
| `all` | Run full test suite |
| `pql` | Tests for BC-02 PQL Intelligence |
| `conversation` | Tests for BC-01 Conversation |
| `revenue` | Tests for BC-03 Revenue |
| `integration` | Tests for BC-04 MCP Adapters |
| `iam` | Tests for BC-05 Identity |
| `fitness` | Run Fitness Functions only |
| `{file-path}` | Tests for specific file |

### 2. Generate Tests (if missing)

Reference docs:
- `docs/test-scenarios.feature` — BDD scenarios
- `docs/pseudocode.md` — algorithm edge cases
- `docs/refinement.md` — edge cases (EC-01..EC-05)
- `docs/fitness-functions.md` — fitness function tests

Test patterns:
```typescript
// Unit test for domain logic
describe('PQLDetector', () => {
  it('should detect Enterprise signal', () => { ... })
  it('should not trigger on operator messages', () => { ... })
  it('should handle concurrent messages (EC-01)', () => { ... })
})

// Integration test for RLS (FF-03)
describe('RLS Isolation', () => {
  it('tenant A cannot see tenant B dialogs', () => { ... })
})

// MCP Adapter test with Circuit Breaker (FF-04)
describe('AmoCRMMCPAdapter', () => {
  it('returns fallback when circuit is OPEN', () => { ... })
})
```

### 3. Run Tests

```bash
# Specific BC
npm test -- --testPathPattern="src/{bc}/"

# All tests
npm test

# With coverage (FF-05: RuleEngine ≥95%)
npm test -- --coverage --collectCoverageFrom="src/pql/rule-engine/**"

# Fitness functions
npm run fitness
```

### 4. Report

Show: passed/failed/skipped counts, coverage if applicable, failing test details.
