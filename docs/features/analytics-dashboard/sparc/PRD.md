# FR-08: Basic Analytics Dashboard -- Product Requirements Document

## Feature Identity

| Field | Value |
|-------|-------|
| Feature ID | FR-08 |
| Name | Basic Analytics Dashboard |
| Bounded Context | BC-03 Revenue (backend) + Frontend (admin UI) |
| Priority | MUST (M2 milestone) |
| Status | Done |
| Depends On | FR-01 (IAM/JWT), FR-03 (PQL RuleEngine), FR-06 (Revenue Attribution), FR-07 (Operator Workspace) |
| Blocks | None (leaf feature) |

## Problem Statement

Tenant administrators have no visibility into support operations performance. Without a centralized dashboard, admins cannot answer basic questions: How many dialogs are we handling? What percentage contain PQL signals? How fast are operators responding? Are PQL detections converting into closed deals?

This lack of operational insight means tenants cannot measure the ROI of the KommuniQ platform -- the core value proposition of turning support into a revenue center.

## Solution

An admin-only analytics dashboard that aggregates and visualizes four core KPIs (total dialogs, PQL rate, average response time, PQL-to-deal conversion) along with supporting breakdowns (channel distribution, PQL tier distribution, daily trend, top operators). The backend executes 8 parallel SQL queries under RLS for performance, and the frontend renders a responsive card + chart layout with period filtering.

## User Stories

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-01 | As an admin, I want to see total dialog count and PQL detection rate so that I can monitor support volume and PQL efficiency | Dashboard shows Total Dialogs and PQL Rate cards with correct values |
| US-02 | As an admin, I want to filter metrics by time period (7d/30d/90d) so that I can analyze trends at different scales | Period selector switches between 7-day, 30-day, and 90-day windows; data refreshes on switch |
| US-03 | As an admin, I want to see dialog distribution by channel so that I can understand where conversations originate | Channel breakdown shows WEB_CHAT, TELEGRAM, VK_MAX with percentage bars |
| US-04 | As an admin, I want to see PQL distribution by tier so that I can assess detection quality | PQL tier chart shows HOT (red), WARM (amber), COLD (blue) with counts and percentages |
| US-05 | As an admin, I want to see a daily dialog trend chart so that I can identify volume patterns | Bar chart renders with date labels; scrollable table shows recent day counts |
| US-06 | As an admin, I want to see top operators by closed dialogs and PQL conversions so that I can evaluate team performance | Top 10 operators listed by closed dialogs with PQL conversion counts |

## Non-Functional Requirements

| ID | Requirement | Implementation |
|----|-------------|----------------|
| NFR-01 | Admin-only access | Backend `requireAdmin` middleware returns 403; frontend layout redirects non-ADMIN operators |
| NFR-02 | Tenant isolation (FF-03) | All queries parameterize `tenant_id`; RLS enforces at DB level |
| NFR-03 | Response time | 8 queries execute via `Promise.all` in parallel |
| NFR-04 | Input validation | Zod schemas validate `period` and `days` query parameters |
| NFR-05 | Graceful degradation | Empty states render fallback messages; null avg response time shows "--" |
| NFR-06 | Minimal bundle size | CSS-only charts (Tailwind) instead of charting library |

## Feature Dependencies

| Feature | Relationship | What It Provides |
|---------|-------------|-----------------|
| FR-01 (IAM/JWT) | Upstream | JWT authentication, ADMIN role, tenant_id extraction |
| FR-03 (PQL RuleEngine) | Upstream | `pql.detections` table data for PQL count and tier metrics |
| FR-06 (Revenue Report) | Upstream | `revenue.attributions` table for conversion rate calculation |
| FR-07 (Operator Workspace) | Upstream | `conversations.dialogs` and `conversations.messages` for dialog/response time metrics |

## API Contract

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/analytics/dashboard?period=7d\|30d\|90d` | JWT + ADMIN | All-in-one dashboard metrics |
| GET | `/api/analytics/dialogs-by-channel` | JWT + ADMIN | Channel distribution (all time) |
| GET | `/api/analytics/pql-by-tier` | JWT + ADMIN | PQL tier distribution (all time) |
| GET | `/api/analytics/daily-trend?days=30` | JWT + ADMIN | Daily dialog creation trend |

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|-------------|
| Dashboard load time | < 2s | Time from page load to metrics rendered |
| Test coverage | 8 unit tests passing | `npx jest --testPathPattern=analytics` |
| Tenant isolation | Zero cross-tenant data leaks | RLS + parameterized queries |
| Admin-only enforcement | 100% of non-admin requests rejected | Backend middleware + frontend guard |
