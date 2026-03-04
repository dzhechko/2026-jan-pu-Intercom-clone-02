# FR-09: VK Max / Messenger Max MCP -- Product Requirements Document

**Feature ID:** FR-09
**Status:** Done
**Bounded Contexts:** BC-04 Integration, BC-01 Conversation
**Priority:** SHOULD
**Milestone:** M2

## Problem Statement

Tenants using the Russian corporate messenger VK Max (Messenger Max) have no way to receive
and respond to client messages within the unified operator workspace. Operators must
switch between the workspace and VK Max, leading to missed messages, delayed responses,
and inability to detect PQL signals from VK Max conversations.

## Target Users

| Persona | Need |
|---------|------|
| **Tenant Admin** | Connect a VK Max bot so that client messages appear in the workspace |
| **Operator** | Reply to VK Max clients without switching platforms |
| **System** | Process VK Max messages through the same pipeline (PQL, attribution, etc.) |

## User Stories

### US-09a: VK Max Bot Connection
**As a** tenant admin,
**I want to** connect my VK Max bot to the workspace,
**so that** client messages from VK Max appear alongside other channels.

**Acceptance Criteria:**
- Admin can configure VK Max webhook via POST /api/vkmax/setup
- Setup appends tenantId to the webhook URL for multi-tenant routing
- Connection status is available via GET /api/vkmax/status
- VK Max confirmation callback is handled correctly

### US-09b: Bidirectional Messaging
**As an** operator,
**I want to** reply to VK Max clients from the workspace,
**so that** I do not need to switch between platforms.

**Acceptance Criteria:**
- Inbound VK Max messages create or update dialogs with channelType=VK_MAX
- Messages are persisted and broadcast to operators via Socket.io
- Operator replies are forwarded to VK Max via MCP service
- Both Socket.io (real-time) and REST paths support outbound messages

### US-09c: Resilient MCP Integration
**As the** system,
**I want** circuit breaker protection on VK Max MCP calls,
**so that** failures do not cascade to the core application.

**Acceptance Criteria:**
- All outbound MCP calls are wrapped in opossum circuit breaker
- Circuit breaker uses 5000ms timeout, 50% error threshold, 30s reset
- Mock mode works when VKMAX_MCP_URL is not configured
- Circuit breaker status is exposed in the /status endpoint

## Scope

### In Scope
- Inbound: VK Max webhook receiving message_new events
- Outbound: operator replies forwarded via Cloud.ru Messenger Max MCP
- VK Max confirmation callback handling
- Tenant resolution via webhook query parameter
- Circuit breaker on all MCP calls
- Mock implementation for local development
- Socket.io real-time broadcast of inbound messages
- Management endpoints (setup, status) behind auth

### Out of Scope
- Media attachments (images, files) -- text-only in v1
- Group chats -- 1:1 conversations only
- VK Max keyboard/button features
- Automated bot replies (future Memory AI integration)
- Client profile enrichment from VK Max

## Dependencies

| Dependency | Type | Status |
|------------|------|--------|
| FR-01: Project Setup + Docker Compose | Prerequisite | Done |
| FR-03: Conversation BC (Dialog/Message repos) | Prerequisite | Done |
| Cloud.ru Messenger Max MCP (23 stars) | External | Available |

## Success Metrics

| Metric | Target |
|--------|--------|
| VK Max message delivery latency | < 2000ms p95 |
| Circuit breaker false-open rate | < 1% |
| Test coverage (adapter + MCP service) | 14 tests, all passing |

## Risks

| Risk | Mitigation |
|------|-----------|
| VK Max API rate limits | Circuit breaker prevents retry storms; webhook always returns 'ok' |
| Tenant identification in webhooks | tenantId appended as query param during setup |
| MCP service unavailability | Mock mode for dev; circuit breaker for production |
