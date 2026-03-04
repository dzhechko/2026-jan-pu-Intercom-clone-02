# FR-13: Multi-operator Support -- Specification

## Overview

FR-13 implements multi-operator dialog assignment with round-robin least-loaded selection, real-time operator presence tracking, operator management endpoints, and a frontend sidebar for team visibility.

---

## Domain Model

### Operator Aggregate (BC-05 IAM)

```typescript
interface Operator {
  id: string          // UUID, PK
  tenantId: string    // UUID, FK -> iam.tenants
  email: string       // unique per tenant
  name: string
  passwordHash: string
  role: 'ADMIN' | 'OPERATOR'
  status: 'ACTIVE' | 'INVITED' | 'DISABLED'
  createdAt: Date
}
```

**Invariants:**
- `(tenant_id, email)` is unique -- enforced by DB constraint
- `role` is either ADMIN or OPERATOR -- enforced by CHECK constraint
- `status` transitions: ACTIVE -> DISABLED (soft-delete), INVITED -> ACTIVE (on first login)

### Dialog Aggregate (BC-01 Conversation) -- Extended Fields

```typescript
interface Dialog {
  // ... existing fields ...
  assignedOperatorId?: string  // maps to operator_id UUID FK in DB
  status: 'OPEN' | 'ASSIGNED' | 'CLOSED' | 'ARCHIVED'
}
```

**Assignment state machine:**
```
OPEN (no operator) -> ASSIGNED (operator set)
ASSIGNED -> ASSIGNED (reassignment to different operator)
OPEN -> ASSIGNED (manual assign)
ASSIGNED -> CLOSED
CLOSED -> (terminal, no reassignment)
```

### PresenceService (BC-05 IAM)

Tracks operator online/offline state using Redis SETs.

**Data structure:**
```
Key: presence:{tenantId}
Type: SET
Members: operatorId UUIDs
```

**Operations:**
| Method | Redis Command | Description |
|--------|---------------|-------------|
| setOnline | SADD | Add operator to tenant's presence set |
| setOffline | SREM | Remove operator from tenant's presence set |
| getOnlineOperators | SMEMBERS | Get all online operator IDs for a tenant |
| isOnline | SISMEMBER | Check if a specific operator is online |

### AssignmentService (BC-01 Conversation)

**Configuration:**
- `maxConcurrentDialogs`: number (default: 5) -- constructor parameter

**Methods:**

| Method | Input | Output | Description |
|--------|-------|--------|-------------|
| assignNextDialog | tenantId | AssignmentResult or null | Assign oldest OPEN unassigned dialog to least-loaded operator |
| autoAssign | dialogId, tenantId | AssignmentResult or null | Auto-assign a specific dialog |
| reassign | dialogId, operatorId | Dialog or null | Manual reassignment |
| findLeastLoadedOperator | tenantId | operatorId or null | Find operator with fewest active dialogs |
| getOperatorLoad | tenantId | Map<operatorId, count> | Count of ASSIGNED dialogs per operator |
| getUnassignedDialogs | tenantId | Dialog[] | OPEN dialogs with no operator, ordered by createdAt ASC |
| getQueueSize | tenantId | number | Count of unassigned dialogs |

**Least-loaded algorithm:**
1. Get online operators from PresenceService
2. Get active dialog count per operator from DB
3. Filter operators below maxConcurrentDialogs threshold
4. Select operator with minimum active count
5. Return null if no eligible operator exists

---

## API Specification

### Assignment Endpoints (BC-01)

#### POST /api/dialogs/:id/assign
Manual assignment of a dialog to a specific operator.

**Request body:**
```json
{ "operatorId": "uuid-string" }
```
**Validation:** Zod schema `ManualAssignSchema` -- operatorId must be a valid UUID.

**Response 200:**
```json
{ "dialog": { ... } }
```
**Error 400:** Invalid body (UUID validation failed)
**Error 404:** Dialog not found or status is CLOSED/ARCHIVED

#### POST /api/dialogs/:id/assign-auto
Auto-assign a dialog to the least-loaded online operator.

**Response 200:**
```json
{ "dialog": { ... }, "operatorId": "uuid" }
```
**Error 404:** No available operator or dialog not in OPEN status

#### POST /api/dialogs/assign-next
Assign the next unassigned dialog from the queue to the least-loaded operator.

**Response 200:**
```json
{ "dialog": { ... }, "operatorId": "uuid" }
```
or
```json
{ "dialog": null, "message": "No unassigned dialogs in queue" }
```

#### GET /api/assignment/queue
Get the current queue size (count of unassigned OPEN dialogs).

**Response 200:**
```json
{ "queueSize": 5 }
```

### Operator Management Endpoints (BC-05)

#### GET /api/operators
List all operators for the authenticated tenant.

**Response 200:**
```json
{
  "operators": [
    { "id": "uuid", "email": "a@b.com", "name": "Alice", "role": "ADMIN", "status": "ACTIVE", "createdAt": "..." }
  ]
}
```

#### GET /api/operators/online
List currently online operators for the tenant.

**Response 200:**
```json
{
  "operators": [
    { "id": "uuid", "email": "a@b.com", "name": "Alice", "role": "ADMIN", "status": "ACTIVE" }
  ]
}
```

#### GET /api/operators/:id/stats
Get stats for a specific operator.

**Response 200:**
```json
{
  "operatorId": "uuid",
  "activeDialogs": 3,
  "closedToday": 12,
  "avgResponseTime": null,
  "isOnline": true
}
```
**Error 404:** Operator not found or belongs to different tenant

#### PATCH /api/operators/:id/role
Change operator role. **Admin only.**

**Request body:**
```json
{ "role": "ADMIN" | "OPERATOR" }
```
**Validation:** Zod schema `UpdateRoleSchema`.

**Response 200:**
```json
{ "id": "uuid", "role": "OPERATOR" }
```
**Error 400:** Cannot change own role (self-demotion protection)
**Error 403:** Not an admin
**Error 404:** Operator not found or cross-tenant access

#### DELETE /api/operators/:id
Deactivate operator (soft-delete). **Admin only.**

**Response 200:**
```json
{ "id": "uuid", "status": "DISABLED" }
```
**Error 400:** Cannot deactivate yourself
**Error 403:** Not an admin
**Error 404:** Operator not found or cross-tenant access

### Socket.io Events

| Event | Direction | Payload | Trigger |
|-------|-----------|---------|---------|
| `operator:online` | Server -> Client | `{ operatorId: string }` | Operator connects via WebSocket |
| `operator:offline` | Server -> Client | `{ operatorId: string }` | Operator disconnects or is deactivated |

---

## Frontend Specification

### OperatorList Component

**Location:** `app/(workspace)/components/OperatorList.tsx`

**Props:**
```typescript
interface OperatorListProps {
  operators: OperatorInfo[]
  currentOperatorId: string
  token: string
  loading: boolean
}
```

**Behavior:**
- Splits operators into online and offline groups
- Online operators: green dot, name, ADMIN badge, active dialog count
- Offline operators: gray dot, dimmed opacity
- Current operator marked with "(you)"
- Stats fetched in parallel for online operators via `/api/proxy/operators/:id/stats`

### useOperators Hook

**Location:** `app/(workspace)/hooks/useOperators.ts`

**Input:** `{ token: string, on: (event, handler) => unsubscribe }`

**Output:** `{ operators, onlineIds, loading, fetchOperators }`

**Behavior:**
- Fetches all operators and online operators in parallel on mount
- Subscribes to `operator:online` and `operator:offline` Socket.io events
- Merges real-time updates into operator state
- Returns unsubscribe functions for cleanup

---

## Database Schema

### iam.operators (Migration 002)

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PK, gen_random_uuid() |
| tenant_id | UUID | FK -> iam.tenants, NOT NULL |
| email | VARCHAR(255) | NOT NULL |
| name | VARCHAR(255) | NOT NULL |
| role | VARCHAR(20) | CHECK (ADMIN, OPERATOR), default OPERATOR |
| status | VARCHAR(20) | default ACTIVE |
| password_hash | VARCHAR(255) | NOT NULL |
| last_login_at | TIMESTAMPTZ | nullable |
| created_at | TIMESTAMPTZ | NOT NULL, default NOW() |

**Constraints:** UNIQUE(tenant_id, email)
**RLS:** `tenant_id = current_setting('app.tenant_id')::UUID`

### conversations.dialogs (Migration 003) -- relevant columns

| Column | Type | Constraints |
|--------|------|-------------|
| operator_id | UUID | FK -> iam.operators, nullable |
| status | VARCHAR(20) | CHECK (OPEN, ASSIGNED, CLOSED, ARCHIVED) |

**Indexes:** `idx_dialogs_tenant_status ON (tenant_id, status)`
