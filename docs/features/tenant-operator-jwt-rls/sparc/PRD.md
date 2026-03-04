# IAM-01: Tenant + Operator + JWT + RLS — Product Requirements Document

**Feature ID:** IAM-01
**Status:** Implemented (Done)
**Bounded Context:** BC-05 Identity & Access
**Priority:** MUST (foundational layer)
**Milestone:** M1
**Date:** 2026-03-04

---

## 1. Problem Statement

КоммуниК is a multi-tenant SaaS platform serving multiple companies (Tenants) simultaneously. Each Tenant's support operators must work in a fully isolated workspace — they must never see data from another Tenant, even if they know the UUID of another Tenant's dialog.

Without a proper IAM foundation, every feature becomes a security liability. All downstream Bounded Contexts (Conversation, PQL Intelligence, Revenue) depend on a trust anchor that proves "this request belongs to Tenant X."

### Current Pain
- No authentication → any HTTP request can read all data
- No tenant scoping → cross-tenant data leakage risk
- No role model → any operator can perform admin operations

---

## 2. Business Goals

| Goal | Metric | Target |
|------|--------|--------|
| Tenant isolation | Zero cross-tenant data leaks | FF-03: 100% RLS enforcement |
| Onboarding speed | Time to first operator login | < 2 minutes from registration |
| Team management | Admin can invite operators | Self-service via API |
| Compliance | 152-ФЗ data residency | All data on Russian VPS |

---

## 3. User Stories

### US-IAM-01: SaaS Founder Registration
**As a** SaaS founder,
**I want** to register my company and immediately receive admin access,
**So that** I can configure the workspace and start using the platform.

**Acceptance Criteria:**
- Registration requires: company name, billing email, admin name, password (min 8 chars)
- On success: returns JWT token + Tenant record + ADMIN operator record
- Tenant and operator created atomically (transaction rollback on partial failure)
- First operator always receives ADMIN role

### US-IAM-02: Admin Invites Operators
**As an** admin operator,
**I want** to invite my team members by email,
**So that** they can handle support dialogs in the same workspace.

**Acceptance Criteria:**
- Only ADMIN role can invite operators
- Invitation requires: email, name, role (ADMIN|OPERATOR)
- Invited operator gets INVITED status until first login
- Duplicate email within the same tenant returns 409 Conflict

### US-IAM-03: Operator Login
**As an** operator,
**I want** to authenticate with email and password,
**So that** I receive a JWT token for subsequent API requests.

**Acceptance Criteria:**
- Login with valid credentials returns JWT token (24-hour expiry)
- Invalid credentials return 401 (generic message — no enum of what was wrong)
- Disabled operators cannot log in

### US-IAM-04: Tenant Data Isolation
**As a** platform operator (КоммуниК team),
**I want** tenant data to be isolated at the database layer,
**So that** application bugs cannot cause cross-tenant data leaks.

**Acceptance Criteria:**
- All authenticated requests set `app.tenant_id` PostgreSQL GUC before any query
- PostgreSQL RLS policies enforce `tenant_id = current_setting('app.tenant_id')::UUID`
- Even direct UUID access to another tenant's rows returns empty result set
- Isolation tested in integration tests (FF-03)

---

## 4. Functional Requirements

| ID | Requirement | Priority |
|----|------------|---------|
| FR-IAM-01 | POST /api/auth/register — creates Tenant + first ADMIN operator atomically | MUST |
| FR-IAM-02 | POST /api/auth/login — validates credentials, issues 24h JWT | MUST |
| FR-IAM-03 | GET /api/auth/me — returns current operator profile (authenticated) | MUST |
| FR-IAM-04 | POST /api/auth/operators — admin-only operator invitation | MUST |
| FR-IAM-05 | Tenant middleware: verify JWT, set app.tenant_id GUC, attach dbClient | MUST |
| FR-IAM-06 | bcrypt password hashing (12 rounds) | MUST |
| FR-IAM-07 | Zod validation on all input schemas | MUST |
| FR-IAM-08 | Operator management: list, change role, deactivate (soft-delete) | SHOULD |
| FR-IAM-09 | Presence tracking: online/offline status via Redis | SHOULD |
| FR-IAM-10 | Operator stats: active dialogs, closed today, online status | COULD |

---

## 5. Non-Functional Requirements

| Category | Requirement |
|---------|------------|
| Security | JWT signed with HS256, secret from `JWT_SECRET` env var |
| Security | Passwords hashed with bcrypt (12 rounds, ~200ms) |
| Security | No password leakage in any API response |
| Security | RLS enforced at DB layer (not application WHERE clause) |
| Performance | Login latency < 500ms p95 (bcrypt is the bottleneck) |
| Compliance | All data on Russian VPS (152-ФЗ) — no foreign LLM/API calls |
| Reliability | Registration transaction: atomicity guaranteed |
| Testing | 16 unit tests with mocked Pool (no real DB in CI) |

---

## 6. Out of Scope (v1)

- Refresh token rotation (deferred)
- Password reset via email (deferred)
- OAuth2 / SSO integration (deferred)
- Rate limiting on auth endpoints (deferred to SH-03)
- Audit log for role changes (deferred)
- Two-factor authentication (deferred)

---

## 7. Dependencies

| Dependency | Type | Notes |
|-----------|------|-------|
| PostgreSQL 16 | Infrastructure | RLS requires pg 8.11.x |
| Redis 7 | Infrastructure | Presence tracking (PresenceService) |
| jsonwebtoken | Library | JWT issuance and verification |
| bcryptjs | Library | Password hashing |
| zod | Library | Input validation |
| Migration 002 | DB Migration | iam.tenants + iam.operators tables with RLS |

---

## 8. Fitness Functions

| FF | Description | Threshold |
|----|------------|----------|
| FF-03 | Tenant RLS isolation — Tenant A cannot see Tenant B data | 100% (blocks deploy) |
| FF-02 | No cross-BC imports | Enforced by ESLint (blocks merge) |
