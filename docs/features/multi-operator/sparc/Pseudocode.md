# FR-13: Multi-operator Support -- Pseudocode

## Algorithm 1: Least-Loaded Operator Selection

```
FUNCTION findLeastLoadedOperator(tenantId: string) -> operatorId | null
  INPUT:  tenantId -- the tenant whose operators to consider
  OUTPUT: operatorId of the least-loaded online operator, or null

  // Step 1: Get online operators from Redis
  onlineOperators <- presenceService.getOnlineOperators(tenantId)
  IF onlineOperators is empty THEN
    RETURN null
  END IF

  // Step 2: Get active dialog counts per operator from DB
  loadMap <- query:
    SELECT operator_id, COUNT(*)::int AS active_count
    FROM conversations.dialogs
    WHERE tenant_id = $tenantId
      AND status = 'ASSIGNED'
      AND operator_id IS NOT NULL
    GROUP BY operator_id

  // Step 3: Find operator with minimum load below threshold
  bestOperator <- null
  bestLoad <- INFINITY

  FOR EACH opId IN onlineOperators DO
    load <- loadMap.get(opId) OR 0    // 0 if not in map (no active dialogs)
    IF load < maxConcurrentDialogs AND load < bestLoad THEN
      bestLoad <- load
      bestOperator <- opId
    END IF
  END FOR

  RETURN bestOperator
END FUNCTION
```

**Complexity:** O(n) where n = number of online operators (max 10).
**Dependencies:** PresenceService (Redis SMEMBERS), PostgreSQL (GROUP BY query).

---

## Algorithm 2: Assign Next Dialog from Queue

```
FUNCTION assignNextDialog(tenantId: string) -> AssignmentResult | null
  INPUT:  tenantId
  OUTPUT: { dialog, operatorId } or null

  // Step 1: Get oldest unassigned dialog (FIFO)
  unassigned <- query:
    SELECT * FROM conversations.dialogs
    WHERE tenant_id = $tenantId
      AND status = 'OPEN'
      AND operator_id IS NULL
    ORDER BY created_at ASC

  IF unassigned is empty THEN
    RETURN null
  END IF

  dialog <- unassigned[0]  // oldest first

  // Step 2: Find available operator
  operatorId <- findLeastLoadedOperator(tenantId)
  IF operatorId is null THEN
    RETURN null  // no available operator
  END IF

  // Step 3: Assign the dialog
  assigned <- dialogRepo.assignOperator(dialog.id, operatorId)
    // UPDATE dialogs SET operator_id = $operatorId, status = 'ASSIGNED'
    //   WHERE id = $dialogId
    //   RETURNING *

  IF assigned is null THEN
    RETURN null  // race condition: someone else assigned it
  END IF

  RETURN { dialog: assigned, operatorId }
END FUNCTION
```

---

## Algorithm 3: Auto-Assign Specific Dialog

```
FUNCTION autoAssign(dialogId: string, tenantId: string) -> AssignmentResult | null
  INPUT:  dialogId -- specific dialog to assign
          tenantId -- for operator lookup
  OUTPUT: { dialog, operatorId } or null

  // Step 1: Validate dialog is assignable
  dialog <- dialogRepo.findById(dialogId)
  IF dialog is null OR dialog.status != 'OPEN' THEN
    RETURN null
  END IF

  // Step 2: Find available operator
  operatorId <- findLeastLoadedOperator(tenantId)
  IF operatorId is null THEN
    RETURN null
  END IF

  // Step 3: Assign
  assigned <- dialogRepo.assignOperator(dialogId, operatorId)
  IF assigned is null THEN
    RETURN null
  END IF

  RETURN { dialog: assigned, operatorId }
END FUNCTION
```

---

## Algorithm 4: Manual Reassignment

```
FUNCTION reassign(dialogId: string, operatorId: string) -> Dialog | null
  INPUT:  dialogId -- dialog to reassign
          operatorId -- target operator
  OUTPUT: updated Dialog or null

  // Step 1: Validate dialog exists and is in assignable state
  dialog <- dialogRepo.findById(dialogId)
  IF dialog is null THEN
    RETURN null
  END IF
  IF dialog.status != 'OPEN' AND dialog.status != 'ASSIGNED' THEN
    RETURN null  // CLOSED and ARCHIVED cannot be reassigned
  END IF

  // Step 2: Perform reassignment
  RETURN dialogRepo.assignOperator(dialogId, operatorId)
    // Sets operator_id and status = 'ASSIGNED'
END FUNCTION
```

**Note:** Reassignment allows both OPEN -> ASSIGNED and ASSIGNED -> ASSIGNED (change operator). The auto-assign algorithm only works on OPEN dialogs.

---

## Algorithm 5: Presence Tracking

```
FUNCTION setOnline(operatorId: string, tenantId: string) -> void
  Redis: SADD "presence:{tenantId}" operatorId
  Socket.io: emit "operator:online" { operatorId } to tenant namespace
END FUNCTION

FUNCTION setOffline(operatorId: string, tenantId: string) -> void
  IF tenantId is provided THEN
    Redis: SREM "presence:{tenantId}" operatorId
    Socket.io: emit "operator:offline" { operatorId } to tenant namespace
  END IF
END FUNCTION

FUNCTION getOnlineOperators(tenantId: string) -> string[]
  RETURN Redis: SMEMBERS "presence:{tenantId}"
END FUNCTION

FUNCTION isOnline(operatorId: string, tenantId: string) -> boolean
  RETURN Redis: SISMEMBER "presence:{tenantId}" operatorId == 1
END FUNCTION
```

---

## Algorithm 6: Operator Deactivation

```
FUNCTION deactivateOperator(adminRequest: TenantRequest, targetId: string) -> Result
  // Step 1: Authorization
  IF adminRequest.role != 'ADMIN' THEN
    RETURN 403 "Admin role required"
  END IF

  // Step 2: Self-protection
  IF targetId == adminRequest.operatorId THEN
    RETURN 400 "Cannot deactivate yourself"
  END IF

  // Step 3: Validate target
  operator <- operatorRepo.findById(targetId)
  IF operator is null THEN
    RETURN 404
  END IF
  IF operator.tenantId != adminRequest.tenantId THEN
    RETURN 404  // cross-tenant access denied (appears as not found)
  END IF

  // Step 4: Soft-delete
  operatorRepo.updateStatus(targetId, 'DISABLED')

  // Step 5: Remove from presence
  presenceService.setOffline(targetId, adminRequest.tenantId)

  RETURN 200 { id: targetId, status: 'DISABLED' }
END FUNCTION
```

---

## Algorithm 7: Frontend Operator Sync

```
FUNCTION useOperators(token, socketOn) -> { operators, onlineIds, loading }
  STATE operators <- []
  STATE onlineIds <- Set()
  STATE loading <- true

  // Initial fetch (parallel)
  ON MOUNT:
    [allResponse, onlineResponse] <- Promise.all(
      fetch("/api/proxy/operators", { Authorization: token }),
      fetch("/api/proxy/operators/online", { Authorization: token })
    )

    onlineSet <- Set(onlineResponse.operators.map(op -> op.id))
    operators <- allResponse.operators.map(op -> {
      ...op,
      isOnline: onlineSet.has(op.id)
    })
    loading <- false

  // Real-time updates
  ON socketOn("operator:online", { operatorId }):
    onlineIds.add(operatorId)
    operators <- operators.map(op ->
      op.id == operatorId ? { ...op, isOnline: true } : op
    )

  ON socketOn("operator:offline", { operatorId }):
    onlineIds.delete(operatorId)
    operators <- operators.map(op ->
      op.id == operatorId ? { ...op, isOnline: false } : op
    )

  RETURN { operators, onlineIds, loading }
END FUNCTION
```
