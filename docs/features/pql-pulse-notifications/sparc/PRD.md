# FR-11: PQL Pulse Notifications -- Product Requirements Document

## Overview

FR-11 implements a tier-based real-time notification system (PQL Pulse) within BC-06 Notifications. When the PQL Detection engine (BC-02) identifies a Product-Qualified Lead in a support dialog, the system immediately notifies the relevant operator via push (Socket.io) and/or email, depending on the PQL tier.

## Problem Statement

Operators handling support dialogs need instant awareness when a conversation reveals a high-value sales opportunity. Without real-time notifications, HOT leads may go unattended, resulting in lost revenue. The notification system bridges the gap between PQL detection and operator action.

## Target Users

- **Operators** -- support agents of tenant companies who handle dialogs and respond to PQL leads.
- **Admins** -- tenant administrators who receive HOT lead email alerts as a fallback when no operator is assigned.

## Core Requirements

### CR-01: Tier-Based Notification Routing
- HOT tier (score >= 0.80): Push notification via Socket.io + email notification to operator (and admin).
- WARM tier (score >= 0.65): Push notification via Socket.io only.
- COLD tier (score < 0.65): Logged to console, no notification sent.

### CR-02: Real-Time Push Notifications
- Delivered via Socket.io `notification:pql` event.
- Targeted to operator-specific room (`operator:{id}`) when an operator is assigned.
- Falls back to tenant-wide room (`tenant:{tenantId}`) when no operator is assigned.

### CR-03: Email Notifications for HOT Leads
- Formatted HTML email with PQL score, tier, top signals, contact email, and a direct link to the dialog.
- Sent via EmailService interface (currently stubbed; production SMTP via `SMTP_HOST` env var).

### CR-04: Duplicate Prevention
- Before sending, the service checks `notification_jobs` table for existing `pql_detected` push notifications for the same `dialogId`.
- If a push notification already exists, all notifications for that detection are skipped.

### CR-05: Notification Bell UI
- Bell icon in operator workspace header with unread count badge (capped at "9+").
- Dropdown showing recent notifications with tier badge, title, body, contact email, and relative time.
- Click navigates to the relevant dialog and marks the notification as read.
- Outside-click closes dropdown.

### CR-06: Notification Management API
- `GET /api/notifications` -- paginated list (limit/offset, Zod-validated).
- `GET /api/notifications/unread-count` -- unread count for current operator.
- `PATCH /api/notifications/:id/read` -- mark notification as read.

### CR-07: Notification Persistence
- All sent notifications persisted in `notification_jobs` PostgreSQL table.
- Table uses Row-Level Security (RLS) on `tenant_id` per ADR-007.

## Non-Functional Requirements

- Push notifications delivered within the existing PQL detection p95 latency budget (< 2000ms total, FF-01).
- No cross-BC imports from notifications to other bounded contexts (FF-02).
- Email service is a stub in v1; real SMTP integration is deferred.
- All data stored on Russian VPS only (FF-10).

## Success Metrics

- Operators respond to HOT PQL leads within 5 minutes of detection (target).
- Zero duplicate notifications per dialog.
- Notification bell renders unread count accurately in real-time.

## Dependencies

- **FR-02 (PQL Detection):** Emits `PQLDetected` events that trigger notification processing.
- **FR-01 (IAM/JWT):** Bearer token authentication for REST API endpoints.
- **BC-01 (Conversation):** Provides dialog context and contact email.

## Priority & Milestone

- **Priority:** SHOULD
- **Milestone:** M1
- **BC:** BC-06 Notifications
