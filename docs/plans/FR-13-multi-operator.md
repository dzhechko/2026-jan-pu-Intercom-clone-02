# FR-13: Multi-operator Support
**Status:** Done | **BC:** BC-01 Conversation, BC-05 IAM | **Priority:** MUST

## Summary
Implemented multi-operator dialog assignment with round-robin least-loaded selection, real-time operator presence tracking via Redis SETs, operator management routes (list, role change, deactivation, stats), and a frontend sidebar component showing online/offline operators with active dialog counts.

## User Stories
- US-13a: As a tenant admin, I want new dialogs to be automatically assigned to the least-loaded online operator so that workload is distributed evenly.
- US-13b: As an operator, I want to see which team members are online and their current load so that I can coordinate with my team.
- US-13c: As a tenant admin, I want to manage operator roles and deactivate operators so that I can control team access.
- US-13d: As an operator, I want to manually reassign dialogs to another operator so that I can transfer conversations when needed.

## Technical Design

### Files Created
- `src/conversation/application/services/assignment-service.ts` -- AssignmentService with round-robin assignment: assignNextDialog (oldest unassigned to least-loaded), autoAssign (specific dialog), reassign (manual transfer), findLeastLoadedOperator, getOperatorLoad, getUnassignedDialogs, getQueueSize.
- `src/conversation/application/services/assignment-service.test.ts` -- 13 unit tests with mocked Pool and PresenceService.
- `src/conversation/infrastructure/assignment-routes.ts` -- Express routes for dialog assignment (manual, auto, next-in-queue) and queue size.
- `src/iam/application/services/presence-service.ts` -- PresenceService tracking operator online/offline status via Redis SETs (key pattern: presence:{tenantId}).
- `src/iam/infrastructure/operator-routes.ts` -- Operator management routes: list all, list online, update role (admin-only), deactivate (admin-only, soft-delete), operator stats.
- `app/(workspace)/components/OperatorList.tsx` -- React sidebar component showing online operators with green dot, role badges, active dialog counts, and offline operators dimmed.
- `app/(workspace)/hooks/useOperators.ts` -- React hook fetching operators from API, tracking online status in real-time via Socket.io events (operator:online, operator:offline).

### Key Decisions
- **Least-loaded selection over strict round-robin:** Instead of a pure round-robin pointer, the system counts active ASSIGNED dialogs per operator and picks the one with the fewest. This naturally balances load even when operators go offline/online.
- **Max concurrent dialog limit (default 5):** Configurable per-service instance. Operators at capacity are skipped during assignment. Prevents overload.
- **Redis SETs for presence:** Simple SADD/SREM on `presence:{tenantId}` keys. No TTL/heartbeat in v1 -- relies on explicit setOnline/setOffline calls at Socket.io connect/disconnect.
- **Soft-delete for operator deactivation:** Sets status to DISABLED rather than hard delete, preserving audit trail and dialog history.
- **Admin self-protection:** Admins cannot demote themselves or deactivate themselves, preventing accidental lockout.
- **Zod validation on manual assign:** operatorId must be a valid UUID (ManualAssignSchema).
- **Parallel fetch in useOperators hook:** Fetches all operators and online operators simultaneously for faster UI load.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/dialogs/:id/assign` | Manual assignment to a specific operator (body: `{ operatorId }`) |
| POST | `/api/dialogs/:id/assign-auto` | Auto-assign dialog via least-loaded selection |
| POST | `/api/dialogs/assign-next` | Assign next unassigned dialog from queue to least-loaded operator |
| GET | `/api/assignment/queue` | Get unassigned dialog count (queue size) |
| GET | `/api/operators` | List all operators for the tenant |
| GET | `/api/operators/online` | List currently online operators |
| GET | `/api/operators/:id/stats` | Operator stats: activeDialogs, closedToday, isOnline |
| PATCH | `/api/operators/:id/role` | Change operator role -- ADMIN only (body: `{ role }`) |
| DELETE | `/api/operators/:id` | Deactivate operator (soft-delete) -- ADMIN only |

## Socket.io Events
| Event | Direction | Payload |
|-------|-----------|---------|
| `operator:online` | Server -> Client | `{ operatorId }` -- operator came online |
| `operator:offline` | Server -> Client | `{ operatorId }` -- operator went offline |

## Dependencies
- Depends on: FR-01 (project setup), FR-02 (IAM / tenant middleware), FR-03 (Conversation BC / DialogRepository)
- Blocks: FR-14 (Keyboard Shortcuts uses assignment actions)

## Tests
- `src/conversation/application/services/assignment-service.test.ts` -- 13 tests covering:
  - assignNextDialog: oldest unassigned to least-loaded, null when no dialogs, null when no operators online
  - findLeastLoadedOperator: fewest active dialogs wins, null at max capacity, only online operators considered
  - Max concurrent dialog limit: respects configurable limit, allows under limit
  - autoAssign: assigns OPEN dialog, returns null for non-OPEN
  - reassign: ASSIGNED dialog to different operator, OPEN dialog, null for CLOSED, null for not found
  - getQueueSize: correct count of unassigned dialogs

## Acceptance Criteria
- [x] New dialogs are automatically assignable to the least-loaded online operator
- [x] Max concurrent dialog limit (default 5) prevents operator overload
- [x] Operators at capacity are skipped during assignment
- [x] Manual reassignment works for OPEN and ASSIGNED dialogs
- [x] CLOSED dialogs cannot be reassigned
- [x] Operator presence is tracked in real-time via Redis
- [x] Frontend shows online/offline operators with active dialog counts
- [x] Role changes and deactivation require ADMIN role
- [x] Admins cannot demote or deactivate themselves
- [x] Queue size endpoint returns count of unassigned dialogs
- [x] Real-time Socket.io events update operator online status in the UI
