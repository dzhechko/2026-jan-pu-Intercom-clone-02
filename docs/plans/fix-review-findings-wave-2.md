# Fix Review Findings Wave 2

## Scope
Fix CRITICAL and HIGH findings from 8 feature reviews (FR-05, FR-06, FR-09, FR-10, FR-11, FR-12, FR-13, FR-14).

## Priority Fixes (CRITICAL + HIGH)

### 1. SQL Injection in analytics-service.ts (FR-06)
- `days` interpolated into SQL strings via template literals
- Fix: Use parameterized `$N` interval syntax

### 2. Broken SQL — report_id JOIN (FR-06)
- `revenue.attributions` has no `report_id` column
- Fix: Remove the JOIN, query attributions directly

### 3. Tenant ownership checks missing (FR-06)
- getReport, downloadPdf don't verify report.tenantId === req.tenantId
- getByDetection, deleteAttribution don't verify tenant
- Fix: Add tenant checks to all routes

### 4. Webhook RLS — Telegram & VK Max (FR-05, FR-09)
- Webhook handlers use pool.query() without SET app.tenant_id
- Fix: Acquire tenant-scoped client in webhook handlers (same pattern as ws-handler fix)

### 5. Webhook tenantId validation (FR-05, FR-09)
- tenantId from query param not validated as UUID
- Fix: Add UUID validation with zod

### 6. Copy-paste bug in email field matching (FR-12)
- `'email' || 'email'` — both conditions identical
- Fix: Use proper Russian field name variant `'электронная почта'` or `'e-mail'`

### 7. PresenceService error handling (FR-13)
- Redis failures crash route handlers
- Fix: Wrap in try/catch, return safe defaults

### 8. NotificationRepository uses pool directly (FR-11)
- No tenant-scoped client
- Fix: Accept optional PoolClient parameter (same pattern as operator-repository)

## Out of Scope (deferred to test coverage task)
- MLTrainingService tests (FR-10)
- Keyboard shortcuts test re-implementation (FR-14)
- ARIA violations in ShortcutHelp.tsx (FR-14)
- Circuit breaker on setWebhook/getMe (FR-05, FR-09) — already behind auth middleware
- MLModelService wiring verification (FR-10) — runtime concern
