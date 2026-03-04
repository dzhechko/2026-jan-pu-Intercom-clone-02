# Harvest Report — Wave 2 (Post-Review Fixes)

**Date:** 2026-03-04
**Mode:** Quick (incremental)
**Source:** КоммуниК v1.0.0 — commits 709a9ca..df3989c
**Previous harvest:** 42 artifacts (docs/harvest-report.md)

---

## New Patterns Extracted (8 artifacts)

### Pattern 1: Parameterized SQL Interval
**Category:** Snippet | **Maturity:** 🔴 Alpha | **Reusability:** HIGH

Replace SQL string interpolation with parameterized intervals to prevent injection:
```sql
-- BEFORE (vulnerable):
WHERE created_at >= NOW() - INTERVAL '${days} days'

-- AFTER (safe):
WHERE created_at >= NOW() - make_interval(days => $2)
-- Pass [tenantId, days] as params
```
**Provenance:** analytics-service.ts fix, 2026-03-04

---

### Pattern 2: Admin Circuit Breaker (dual-breaker pattern)
**Category:** Pattern | **Maturity:** 🔴 Alpha | **Reusability:** HIGH

When a service has both high-frequency (message send) and low-frequency (admin setup) operations, use two separate circuit breakers to prevent admin operations from being blocked by message send failures:
```typescript
class ExternalService {
  private readonly sendBreaker: CircuitBreaker   // high-frequency
  private readonly adminBreaker: CircuitBreaker  // low-frequency

  constructor() {
    this.sendBreaker = new CircuitBreaker(this._send.bind(this), opts)
    this.adminBreaker = new CircuitBreaker(
      async (url: string, options?: RequestInit) => {
        const response = await fetch(url, options)
        return response.json()
      },
      opts,
    )
  }
}
```
**Provenance:** telegram-bot-service.ts, vkmax-mcp-service.ts, 2026-03-04

---

### Pattern 3: Webhook UUID Validation + RLS Context
**Category:** Pattern | **Maturity:** 🔴 Alpha | **Reusability:** HIGH

For unauthenticated webhook endpoints that bypass JWT middleware, validate tenant ID and set RLS context manually:
```typescript
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// In webhook handler:
const tenantId = req.query.tenantId as string
if (!tenantId || !UUID_REGEX.test(tenantId)) {
  return res.status(400).json({ error: 'Invalid tenantId' })
}
const client = await pool.connect()
await client.query('SELECT set_config($1, $2, false)', ['app.tenant_id', tenantId])
try {
  // ... process webhook with tenant-scoped client
} finally {
  client.release()
}
```
**Provenance:** telegram-routes.ts, vkmax-routes.ts, 2026-03-04

---

### Pattern 4: Tenant Ownership Check on Resource Access
**Category:** Rule | **Maturity:** 🔴 Alpha | **Reusability:** HIGH

Even with RLS enabled, add application-layer tenant ownership checks on direct UUID lookups. Return 404 (not 403) to avoid information leakage:
```typescript
const resource = await repo.findById(req.params.id)
if (!resource) return res.status(404).json({ error: 'Not found' })
if (resource.tenantId !== (req as TenantRequest).tenantId) {
  return res.status(404).json({ error: 'Not found' })
}
```
**Provenance:** revenue-routes.ts, attribution-routes.ts, 2026-03-04

---

### Pattern 5: Redis Service with Safe Defaults
**Category:** Pattern | **Maturity:** 🔴 Alpha | **Reusability:** HIGH

Wrap all Redis operations in try/catch with safe defaults to prevent Redis failures from crashing HTTP handlers:
```typescript
async getItems(key: string): Promise<string[]> {
  try {
    return await this.redis.smembers(key)
  } catch (err) {
    console.error('[service] Redis error:', err)
    return [] // safe default
  }
}
```
**Provenance:** presence-service.ts, 2026-03-04

---

### Pattern 6: Optional PoolClient for RLS-aware Repositories
**Category:** Pattern | **Maturity:** 🔴 Alpha | **Reusability:** HIGH

Repository methods accept an optional `PoolClient` to support both RLS-scoped (route handler) and unscoped (background job) usage:
```typescript
async findById(id: string, client?: PoolClient): Promise<Result<T | null, Error>> {
  const executor = client ?? this.pool
  const result = await executor.query('SELECT * FROM table WHERE id = $1', [id])
  return ok(result.rows[0] ?? null)
}
```
**Provenance:** operator-repository.ts, notification-repository.ts, 2026-03-04

---

### Pattern 7: ARIA-compliant Modal with Focus Trap
**Category:** Snippet | **Maturity:** 🔴 Alpha | **Reusability:** MEDIUM

React modal pattern with proper ARIA attributes and focus management:
```tsx
<div role="dialog" aria-modal="true" aria-labelledby="modal-title">
  <h2 id="modal-title">Title</h2>
  <button ref={closeRef} onKeyDown={handleFocusTrap}>Close</button>
</div>

// Auto-focus on open:
useEffect(() => { if (open) closeRef.current?.focus() }, [open])
```
**Provenance:** ShortcutHelp.tsx, 2026-03-04

---

### Pattern 8: Test Import from Source (not local copy)
**Category:** Rule | **Maturity:** 🔴 Alpha | **Reusability:** HIGH

Tests must import constants/types from source modules, never re-declare locally. Local copies become stale and tests pass against wrong data:
```typescript
// BAD — tests pass even if source changes:
const SHORTCUTS = [{ key: 'Ctrl+K', ... }]

// GOOD — tests validate actual source:
import { SHORTCUTS } from '../../src/module'
```
**Provenance:** keyboard-shortcuts.test.ts fix, 2026-03-04

---

## Summary

| Category | Count |
|----------|:-----:|
| Pattern | 5 |
| Rule | 2 |
| Snippet | 1 |
| **Total** | **8** |

**Combined with previous harvest:** 42 + 8 = **50 total artifacts**
