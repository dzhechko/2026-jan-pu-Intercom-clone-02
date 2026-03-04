# Cross-Tenant Operator Assignment Check Missing

**Date:** 2026-03-04 | **Area:** security | **Type:** CRITICAL finding

## Problem
FR-13 (Multi-operator) review found that `POST /api/dialogs/:id/assign`
does not verify that the target `operatorId` belongs to the same tenant.

A crafted request with a valid JWT for Tenant A could assign a dialog to
an operator belonging to Tenant B if the attacker knows the operator UUID.

## Why RLS Doesn't Catch This
RLS is set on the `dialogs` table (only shows tenant A's dialogs), but
the `operatorId` is just a UUID value written into the row. RLS doesn't
validate that the operatorId references a row in `iam.operators` that
also belongs to the same tenant.

## Solution
Before assignment, verify operator belongs to current tenant:

```typescript
const operator = await operatorRepo.findById(operatorId);
if (!operator || operator.tenantId !== tenantId) {
  return res.status(403).json({ error: 'Operator not in your tenant' });
}
```

## Severity
CRITICAL — data isolation breach vector. Should be fixed before production.

## Affected
- `src/conversation/infrastructure/assignment-routes.ts` — POST /api/dialogs/:id/assign
- `src/conversation/application/services/assignment-service.ts` — assignToOperator()
