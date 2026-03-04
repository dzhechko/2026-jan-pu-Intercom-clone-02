# FR-13: Multi-operator Support -- Architecture

## System Context

FR-13 spans two Bounded Contexts:
- **BC-05 IAM:** Operator aggregate, PresenceService, operator management routes
- **BC-01 Conversation:** AssignmentService, assignment routes, Dialog assignment state

The two BCs communicate through shared infrastructure (Redis for presence, PostgreSQL for dialog state) without direct cross-BC imports. The AssignmentService in BC-01 depends on PresenceService from BC-05 via constructor injection -- this is an allowed cross-BC dependency since PresenceService is injected at the composition root (server.ts), not imported in domain code.

---

## Component Diagram

```
+-------------------------------------------------------+
|                    Frontend (Next.js)                   |
|                                                         |
|  OperatorList.tsx  <--  useOperators.ts                |
|       |                    |                            |
|       | fetch stats        | fetch operators            |
|       v                    v                            |
|  /api/proxy/operators/:id/stats                        |
|  /api/proxy/operators                                  |
|  /api/proxy/operators/online                           |
|                                                         |
|  Socket.io: operator:online / operator:offline          |
+-------------------------------------------------------+
                        |
                        | HTTP / WebSocket
                        v
+-------------------------------------------------------+
|               Backend (Express + Socket.io)             |
|                                                         |
|  +-------------------+    +-------------------------+  |
|  | BC-05 IAM         |    | BC-01 Conversation      |  |
|  |                   |    |                         |  |
|  | operator-routes   |    | assignment-routes       |  |
|  |   GET /operators  |    |   POST /dialogs/:id/    |  |
|  |   GET /online     |    |        assign           |  |
|  |   PATCH /:id/role |    |   POST /dialogs/:id/    |  |
|  |   DELETE /:id     |    |        assign-auto      |  |
|  |   GET /:id/stats  |    |   POST /dialogs/        |  |
|  |                   |    |        assign-next      |  |
|  | PresenceService   |    |   GET /assignment/queue |  |
|  |   (Redis SETs)    |    |                         |  |
|  |                   |    | AssignmentService       |  |
|  | OperatorRepository|    |   (Pool + Presence)     |  |
|  |   (PostgreSQL)    |    |                         |  |
|  +-------------------+    +-------------------------+  |
|                                                         |
+-------------------------------------------------------+
          |                           |
          v                           v
+------------------+        +------------------+
|   PostgreSQL 16  |        |     Redis 7      |
|                  |        |                  |
| iam.operators    |        | presence:{tid}   |
|   (RLS enabled)  |        |   SET of opIds   |
|                  |        |                  |
| conversations.   |        |                  |
|   dialogs        |        |                  |
|   (RLS enabled)  |        |                  |
+------------------+        +------------------+
```

---

## Data Flow: Auto-Assignment

```
1. New dialog created (status: OPEN, operator_id: NULL)
2. Frontend or system calls POST /api/dialogs/:id/assign-auto
3. AssignmentService.autoAssign(dialogId, tenantId):
   a. DialogRepository.findById(dialogId) -- verify status is OPEN
   b. PresenceService.getOnlineOperators(tenantId)
      -> Redis SMEMBERS presence:{tenantId}
   c. Pool.query: SELECT operator_id, COUNT(*) FROM dialogs
      WHERE status='ASSIGNED' GROUP BY operator_id
   d. Filter operators below maxConcurrentDialogs
   e. Select operator with minimum active_count
   f. DialogRepository.assignOperator(dialogId, operatorId)
      -> UPDATE dialogs SET operator_id=$1, status='ASSIGNED'
4. Return { dialog, operatorId } to caller
```

## Data Flow: Operator Goes Online

```
1. Operator authenticates and connects via Socket.io
2. Server calls PresenceService.setOnline(operatorId, tenantId)
   -> Redis SADD presence:{tenantId} operatorId
3. Server emits Socket.io event: operator:online { operatorId }
4. useOperators hook receives event:
   a. Adds operatorId to onlineIds Set
   b. Updates operators state: op.isOnline = true
5. OperatorList re-renders with updated presence
```

## Data Flow: Operator Deactivation

```
1. Admin calls DELETE /api/operators/:id
2. operator-routes handler:
   a. Verify req.role === 'ADMIN'
   b. Verify not self-deactivation
   c. Verify operator belongs to same tenant
   d. OperatorRepository.updateStatus(id, 'DISABLED')
   e. PresenceService.setOffline(id, tenantId)
      -> Redis SREM presence:{tenantId} operatorId
3. Return { id, status: 'DISABLED' }
4. Deactivated operator's session will fail JWT verification on next request
   (findByEmail filters status != 'DISABLED')
```

---

## Cross-BC Boundary

The AssignmentService (BC-01) depends on PresenceService (BC-05). This dependency is managed through constructor injection at the composition root, not through direct module imports in the domain layer. The PresenceService interface is stable (4 methods: setOnline, setOffline, getOnlineOperators, isOnline).

```
server.ts (composition root):
  const presenceService = new PresenceService(redis)
  const assignmentService = new AssignmentService(pool, presenceService)
  const assignmentRouter = createAssignmentRouter(pool, assignmentService)
  const operatorRouter = createOperatorRouter(pool, redis)
```

This satisfies FF-02 (no cross-BC imports) because the dependency is wired at infrastructure level, not at domain level.

---

## Security Architecture

### Tenant Isolation (FF-03)

| Layer | Mechanism |
|-------|-----------|
| Database | RLS on `iam.operators` and `conversations.dialogs` -- `tenant_id = current_setting('app.tenant_id')::UUID` |
| API Routes | Tenant middleware sets `app.tenant_id` GUC before queries |
| Operator Routes | Explicit `tenantId` check: `operatorResult.value.tenantId !== tenantReq.tenantId` returns 404 |
| Presence | Redis key is scoped: `presence:{tenantId}` -- operators from tenant A are never in tenant B's set |

### Authorization

| Operation | Required Role | Self-Protection |
|-----------|---------------|-----------------|
| List operators | Any authenticated | -- |
| List online | Any authenticated | -- |
| Get stats | Any authenticated | Cross-tenant returns 404 |
| Change role | ADMIN | Cannot change own role |
| Deactivate | ADMIN | Cannot deactivate self |
| Manual assign | Any authenticated | -- |
| Auto assign | Any authenticated | -- |

### Input Validation

| Endpoint | Schema | Library |
|----------|--------|---------|
| POST /dialogs/:id/assign | ManualAssignSchema: `{ operatorId: z.string().uuid() }` | Zod |
| PATCH /operators/:id/role | UpdateRoleSchema: `{ role: z.enum(['ADMIN','OPERATOR']) }` | Zod |

---

## Technology Choices

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Presence store | Redis SET | O(1) SADD/SREM, O(n) SMEMBERS -- perfect for small team (<=10) |
| Assignment algorithm | Least-loaded (not round-robin) | Naturally balances even with operators going on/offline |
| Deactivation | Soft-delete (DISABLED status) | Preserves dialog history and audit trail |
| Presence TTL | None (v1) | Relies on Socket.io connect/disconnect; heartbeat planned for v2 |
| Max concurrent limit | Constructor parameter | Allows per-instance configuration; tenant-level config planned for v2 |

---

## Fitness Function Compliance

| FF | Requirement | Status |
|----|-------------|--------|
| FF-02 | No cross-BC imports | PASS -- PresenceService injected via composition root |
| FF-03 | Tenant RLS isolation | PASS -- RLS on operators and dialogs; explicit tenantId checks in routes |
| FF-04 | Circuit Breaker on MCP | N/A -- FR-13 does not use MCP adapters |
| FF-05 | RuleEngine coverage >= 95% | N/A -- FR-13 is not RuleEngine |
| FF-08 | Redis Stream lag < 1000 | N/A -- uses Redis SETs, not Streams |
