# FR-14: Keyboard Shortcuts -- Product Requirements Document

**Feature:** FR-14 Keyboard Shortcuts
**BC:** BC-01 Conversation (Operator Workspace UI)
**Priority:** SHOULD | **Milestone:** M2
**Status:** Implemented

---

## Problem Statement

Operators in a PLG/SaaS support environment handle dozens of dialogs per shift. Mouse-driven workflows create friction: switching between dialogs, sending common responses, assigning ownership, and closing resolved tickets all require multiple clicks. This slows operator throughput and increases fatigue during high-volume periods.

## Target Persona

**Operator** -- a support agent employed by a Tenant company using the platform. Operators work in the Operator Workspace (FR-07) and need rapid context-switching between dialogs.

## Goals

1. Reduce time-per-action for the 5 most common operator tasks (send message, navigate dialogs, assign, close, quick reply).
2. Provide discoverability via an in-app shortcut help overlay.
3. Avoid interfering with normal text input in message composition fields.

## User Stories

| ID | Story | Acceptance Criteria |
|----|-------|---------------------|
| US-14a | As an operator, I want keyboard shortcuts for common actions so that I can handle dialogs faster without using the mouse. | 14 shortcuts registered across 3 categories; all functional |
| US-14b | As an operator, I want quick reply templates bound to Alt+1..5 so that I can send frequent responses instantly. | Alt+1..5 each send the corresponding template text |
| US-14c | As an operator, I want a shortcut help panel so that I can discover available shortcuts. | `?` key opens modal; Escape or overlay click closes it |

## Shortcut Inventory (14 shortcuts)

### Navigation (5)

| Shortcut | Action |
|----------|--------|
| Ctrl+K | Focus search/filter dialogs |
| Alt+Up | Previous dialog |
| Alt+Down | Next dialog |
| Alt+N | Jump to next unassigned dialog |
| Escape | Deselect dialog / close panels |

### Messaging (6)

| Shortcut | Action |
|----------|--------|
| Ctrl+Enter | Send message |
| Alt+1 | Quick reply #1 |
| Alt+2 | Quick reply #2 |
| Alt+3 | Quick reply #3 |
| Alt+4 | Quick reply #4 |
| Alt+5 | Quick reply #5 |

### Actions (3)

| Shortcut | Action |
|----------|--------|
| Alt+A | Assign dialog to me |
| Alt+C | Close current dialog |
| ? | Show keyboard shortcuts help |

## Quick Reply Templates (Default)

| Slot | Label | Content (RU) |
|------|-------|-------------|
| Alt+1 | Connect specialist | Spasibo za obrashchenie! Podklyuchayu spetsialista. |
| Alt+2 | Request email | Mogu ya utochnit vash email dlya svyazi? |
| Alt+3 | 24h follow-up | My izuchim vash zapros i vernyomsya v techenie 24 chasov. |
| Alt+4 | Demo offer | Khotite naznachit demo-vstrechu s nashey komandoy? |
| Alt+5 | Transfer to sales | Peredayu vash zapros v otdel prodazh. |

## Non-Goals

- Custom shortcut remapping (future M3).
- Tenant-configurable quick reply templates (future; currently hardcoded).
- Vim-style modal shortcuts.

## Dependencies

- **Requires:** FR-07 (Operator Workspace UI), FR-13 (Multi-operator assignment/close actions).
- **Blocks:** None.

## Success Metrics

| Metric | Target |
|--------|--------|
| Shortcut adoption rate | >30% of operators use at least 1 shortcut within first week |
| Quick reply usage | >50% of common responses sent via Alt+N |
| Help panel open rate | Measured but no target (discoverability signal) |
