# FR-13: Multi-operator Support -- Product Requirements Document

**Feature:** Multi-operator dialog assignment and team management
**BC:** BC-01 Conversation, BC-05 IAM
**Priority:** SHOULD (Milestone M2)
**Status:** Implemented

---

## Problem Statement

PLG/SaaS support teams need more than one operator handling dialogs simultaneously. Without automatic assignment and load balancing, dialog response times increase, workload distribution is uneven, and admins lack visibility into team utilization. A single-operator model does not scale beyond the first paying tenant.

## Target Users

| Persona | Need |
|---------|------|
| **Tenant Admin** | Manage team of up to 10 operators, assign roles, deactivate members, view stats |
| **Operator** | Receive fairly-distributed dialog assignments, see team presence, manually reassign dialogs |

## User Stories

### US-13a: Automatic Assignment (Least-Loaded)
**As a** tenant admin,
**I want** new dialogs to be automatically assigned to the least-loaded online operator,
**so that** workload is distributed evenly across my team.

**Acceptance Criteria:**
- System selects the online operator with the fewest active (ASSIGNED) dialogs
- Operators at the configurable max concurrent dialog limit (default: 5) are skipped
- When no operators are online, the dialog remains in the unassigned queue
- The oldest unassigned dialog is assigned first (FIFO)

### US-13b: Team Presence Visibility
**As an** operator,
**I want** to see which team members are online and their current dialog load,
**so that** I can coordinate with my team effectively.

**Acceptance Criteria:**
- Sidebar shows online operators with a green indicator and active dialog count
- Offline operators appear dimmed below the online list
- ADMIN role is indicated with a badge
- Current operator is labeled "(you)"
- Online/offline transitions are reflected in real time via Socket.io events

### US-13c: Operator Management (Admin)
**As a** tenant admin,
**I want** to manage operator roles and deactivate operators,
**so that** I can control team access and maintain security.

**Acceptance Criteria:**
- Admins can change any operator's role between ADMIN and OPERATOR
- Admins cannot demote themselves (self-protection)
- Admins can deactivate (soft-delete) any operator except themselves
- Deactivated operators are set to DISABLED status and removed from presence
- Deactivated operators cannot log in (findByEmail filters DISABLED)

### US-13d: Manual Reassignment
**As an** operator,
**I want** to manually reassign a dialog to another operator,
**so that** I can transfer conversations when needed (e.g., escalation, shift handoff).

**Acceptance Criteria:**
- OPEN and ASSIGNED dialogs can be reassigned to any operator
- CLOSED dialogs cannot be reassigned
- operatorId is validated as a UUID via Zod schema
- Non-existent dialogs return a 404 response

## Business Rules

| Rule | Description |
|------|-------------|
| BR-01 | Max 10 operators per tenant (plan limit, enforced at invite) |
| BR-02 | Max concurrent dialog limit per operator: default 5, configurable |
| BR-03 | Assignment algorithm: least-loaded among online operators |
| BR-04 | Queue ordering: FIFO by dialog createdAt ASC |
| BR-05 | Admins cannot demote or deactivate themselves |
| BR-06 | Deactivation is soft-delete (status = DISABLED), preserving audit trail |
| BR-07 | Only ACTIVE operators are returned by login flow |

## Out of Scope (v1)

- Heartbeat-based presence (v1 relies on explicit Socket.io connect/disconnect)
- Skill-based routing (all operators are equal in v1)
- Shift scheduling and automatic offline on schedule end
- Detailed response time analytics (avgResponseTime is null placeholder)
- Operator invitation email delivery (temp password generated, no email sent)

## Success Metrics

| Metric | Target |
|--------|--------|
| Average queue wait time | < 30s with 3+ online operators |
| Assignment fairness (max load delta between operators) | <= 2 dialogs |
| Operator presence accuracy | 100% at connect/disconnect events |
| Admin management operations | < 200ms p95 |

## Dependencies

- **FR-01:** Project setup and Docker Compose
- **FR-02:** IAM -- Tenant + Operator + JWT + RLS
- **FR-03:** Conversation BC -- Dialog aggregate and repository

## Blocks

- **FR-14:** Keyboard Shortcuts (uses assignment actions)
