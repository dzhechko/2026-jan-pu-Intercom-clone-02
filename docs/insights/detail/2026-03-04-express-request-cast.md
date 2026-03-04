# Express Request Cast Needs Double-Cast

**Date:** 2026-03-04 | **Area:** infrastructure | **Type:** gotcha

## Problem
When extending Express `Request` with custom properties (e.g., `TenantRequest` with `tenantId` and `operatorId`), direct casting fails:

```typescript
const tenantReq = req as TenantRequest  // TS2352
```

Error: "Conversion may be a mistake because neither type sufficiently overlaps."

## Solution
Use double-cast via `unknown`:

```typescript
const tenantReq = req as unknown as TenantRequest
```

## Better Alternative
Type the route handler generics properly:

```typescript
router.get<{ email: string }>('/contact/:email', (req, res) => {
  // req.params.email is typed
})
```

Or use declaration merging to extend Express types globally.

## Affected
`src/pql/infrastructure/memory-ai-routes.ts` — two occurrences fixed with double-cast.
