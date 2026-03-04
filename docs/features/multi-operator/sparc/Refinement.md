# FR-13: Multi-operator Support -- Refinement

## Edge Cases

### EC-01: Race Condition in Assignment
**Scenario:** Two operators click "assign-next" simultaneously for the same dialog.
**Current behavior:** Both calls query for unassigned dialogs. The first UPDATE succeeds, the second may also succeed (no DB-level lock on assignment).
**Risk:** LOW -- with max 10 operators and separate dialogs, collisions are rare.
**Mitigation (v2):** Use `SELECT ... FOR UPDATE SKIP LOCKED` to prevent double-assignment.

### EC-02: Operator Disconnects Without setOffline
**Scenario:** Network failure or browser crash prevents Socket.io disconnect event.
**Current behavior:** Operator remains in presence set indefinitely (stale presence).
**Risk:** MEDIUM -- stale operator receives assignments but never responds.
**Mitigation (v2):** Heartbeat mechanism with TTL on presence keys:
```
SETEX presence:heartbeat:{tenantId}:{operatorId} 30 "1"
```
Background worker cleans stale entries every 60s.

### EC-03: Admin Deactivates Last Admin
**Scenario:** Tenant has 2 admins. Admin A deactivates Admin B. Admin B was the only other admin.
**Current behavior:** Allowed. Only self-deactivation is blocked.
**Risk:** LOW -- tenant still has Admin A active.
**Edge case:** If Admin A's account is compromised, there is no second admin for recovery.
**Mitigation (v2):** Enforce minimum 1 active admin per tenant on deactivation.

### EC-04: All Operators at Max Capacity
**Scenario:** All online operators have >= maxConcurrentDialogs active dialogs.
**Current behavior:** findLeastLoadedOperator returns null. Dialog stays in queue.
**Risk:** LOW -- queue size endpoint exposes this to admins.
**Mitigation:** Queue size is visible via GET /api/assignment/queue. Admin dashboard can alert on growing queue.

### EC-05: Operator Deactivated While Holding Active Dialogs
**Scenario:** Admin deactivates an operator who has 3 ASSIGNED dialogs.
**Current behavior:** Dialogs remain ASSIGNED to the deactivated operator. No automatic reassignment.
**Risk:** MEDIUM -- those dialogs become orphaned.
**Mitigation (v2):** On deactivation, automatically reassign ASSIGNED dialogs to other online operators or return them to OPEN status.

### EC-06: Concurrent Role Change and Action
**Scenario:** Admin demotes operator to OPERATOR role while operator is performing an admin action.
**Current behavior:** JWT contains role at issuance time. Operator retains admin JWT until token expires (24h).
**Risk:** LOW -- token refresh on role change is a v2 feature.
**Mitigation (v2):** Emit `role:changed` Socket.io event; frontend forces token refresh.

### EC-07: Empty Tenant (No Operators Online)
**Scenario:** All operators are offline, new dialogs keep arriving.
**Current behavior:** Dialogs accumulate in OPEN/unassigned state. assignNextDialog returns null.
**Risk:** LOW -- expected behavior. Queue grows until operators come online.

---

## Risks and Mitigations

| Risk | Severity | Probability | Mitigation |
|------|----------|-------------|------------|
| Stale presence (EC-02) | Medium | Medium | v2: heartbeat + TTL |
| Race condition on assign (EC-01) | Low | Low | v2: SELECT FOR UPDATE SKIP LOCKED |
| Orphaned dialogs on deactivation (EC-05) | Medium | Low | v2: auto-reassign on deactivation |
| JWT stale role (EC-06) | Low | Low | v2: role:changed event + token refresh |
| Redis connection failure | Medium | Low | PresenceService degrades: all operators appear offline, assignment falls back to queue |
| PostgreSQL connection failure | Critical | Very Low | AssignmentService throws, routes return 500 |

---

## Performance Considerations

### Assignment Latency
- `findLeastLoadedOperator`: 1 Redis SMEMBERS + 1 SQL GROUP BY query
- Expected: < 10ms for 10 operators and < 100 active dialogs
- FF-01 (PQL < 2000ms) is not applicable here, but assignment should be < 100ms p95

### Presence Operations
- Redis SET operations (SADD, SREM, SISMEMBER): O(1) -- microsecond latency
- SMEMBERS: O(n) where n <= 10 -- negligible

### Stats Endpoint
- 2 SQL COUNT queries per request
- Consider caching in Redis with 10s TTL for high-traffic dashboards (v2)

---

## Testing Gaps

### Current Coverage (16 tests)
- AssignmentService: 16 unit tests with mocked Pool and PresenceService
- All core flows covered: assign-next, auto-assign, reassign, least-loaded, queue-size

### Missing Tests
1. **PresenceService unit tests** -- no dedicated test file exists. The Redis operations (SADD, SREM, SMEMBERS, SISMEMBER) are tested indirectly through AssignmentService mocks.
2. **Operator routes integration tests** -- no test file for operator-routes.ts. Admin authorization, self-protection, cross-tenant checks are untested at the HTTP layer.
3. **Assignment routes integration tests** -- no test file for assignment-routes.ts. Zod validation and HTTP status codes are untested.
4. **OperatorList component tests** -- no Jest/RTL tests for the React component.
5. **useOperators hook tests** -- no tests for the Socket.io subscription logic.
6. **RLS isolation integration test** -- tenant A operator should not see tenant B operators via the API.

### Recommended Test Priority
1. PresenceService unit tests (mocked Redis) -- HIGH
2. Operator routes integration tests (supertest) -- HIGH
3. RLS isolation test for operators -- CRITICAL (FF-03)
4. Assignment routes integration tests -- MEDIUM
5. Frontend component tests -- LOW (supplementary UI)

---

## Technical Debt

| Item | Severity | Description |
|------|----------|-------------|
| No heartbeat for presence | Medium | Stale presence on network failure (EC-02) |
| avgResponseTime placeholder | Low | Stats endpoint returns null for avg response time |
| Temp password on invite | Medium | No email delivery; temp password is discarded silently |
| No operator count limit enforcement | Low | Max 10 operators per tenant is documented but not enforced in code |
| findByEmail bypasses RLS | Low | Intentional for login flow, but documented clearly |
| AssignmentService imports from both BCs | Low | Accepted at composition root level; domain layer is clean |
| No CLOSED dialog auto-reassignment | Medium | Orphaned dialogs on operator deactivation (EC-05) |

---

## Future Enhancements

| Enhancement | Priority | Description |
|-------------|----------|-------------|
| Heartbeat presence | HIGH | TTL-based presence with background cleanup |
| Skill-based routing | MEDIUM | Route dialogs to operators with relevant expertise |
| Auto-reassign on deactivation | MEDIUM | Return orphaned dialogs to queue |
| Operator count enforcement | LOW | Reject invite when tenant reaches plan limit |
| Response time tracking | LOW | Calculate avg response time from message timestamps |
| Shift scheduling | LOW | Auto-offline operators based on schedule |
