# PRD: FR-04 Chat Widget
**Feature:** FR-04 Chat Widget
**BC:** BC-01 Conversation Context
**Status:** Implemented
**Date:** 2026-03-04

---

## 1. Problem Statement

PLG/SaaS companies need a way for their end-user clients to initiate support conversations directly from the product or marketing site, without leaving the page. The operator team needs all incoming conversations — regardless of channel — to appear in a single unified queue. Without an embeddable web chat widget, the only inbound channel is external messengers (Telegram, VK Max), which do not carry rich product context or contact metadata.

---

## 2. Feature Overview (FR-04)

FR-04 delivers a real-time web chat widget that:

- Embeds on any tenant's website or SaaS product via a JavaScript snippet
- Opens a persistent WebSocket connection to receive operator replies in real-time
- Creates or resumes a dialog session identified by a stable `externalChannelId` (widget session ID)
- Accepts optional `contactEmail` and `metadata` for CRM context enrichment (Memory AI)
- Feeds messages into the same BC-01 dialog queue as Telegram and VK Max channels
- Supports tenant branding through `TenantSettings.customBranding`

---

## 3. Actors

| Actor | Role |
|-------|------|
| **Client** | End-user who writes in the chat widget on the tenant's site |
| **Operator** | Support agent of the tenant company who reads and replies |
| **Tenant** | Company using КоммуниК; configures branding, PQL thresholds |
| **PQL Detector** | BC-02 service that analyzes client messages for purchase intent |

---

## 4. Functional Requirements (MoSCoW)

### MUST HAVE

| ID | Requirement | Acceptance Criterion |
|----|-------------|----------------------|
| FR-04.1 | Real-time bidirectional messaging | Client message appears in operator workspace < 500 ms p95 |
| FR-04.2 | Dialog creation on first message | New dialog created with `channelType = WEB_CHAT` and `status = OPEN` |
| FR-04.3 | Dialog resume on reconnect | Same `externalChannelId` maps to the same dialog; no duplicate created |
| FR-04.4 | Message persistence | All messages stored in `conversations.messages` with direction and senderType |
| FR-04.5 | Operator reply delivery to widget | Operator message delivered to client via Socket.io `dialog:{dialogId}` room |
| FR-04.6 | Unified queue integration | WEB_CHAT dialogs appear alongside TELEGRAM and VK_MAX in operator workspace |
| FR-04.7 | Typing indicator | Client and operator typing events forwarded in real-time |

### SHOULD HAVE

| ID | Requirement | Acceptance Criterion |
|----|-------------|----------------------|
| FR-04.8 | Contact email capture | `contactEmail` passed at connect-time; persisted on dialog for Memory AI |
| FR-04.9 | Metadata pass-through | Arbitrary JSON metadata (plan, page URL) stored on dialog for CRM enrichment |
| FR-04.10 | PQL trigger integration | Each inbound client message triggers BC-02 PQL analysis (non-blocking) |

### COULD HAVE

| ID | Requirement | Acceptance Criterion |
|----|-------------|----------------------|
| FR-04.11 | Tenant branding | Widget colors/logo configurable via `TenantSettings.customBranding` |
| FR-04.12 | Message history on widget load | Widget can fetch last N messages to show prior conversation |

### WON'T HAVE (v1)

- File/attachment upload in widget
- Offline message queue (client sends while disconnected)
- Voice/video via widget
- Bot auto-reply in widget (RAG MCP — v2)

---

## 5. Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-W1 | Message delivery latency | < 500 ms p95 operator workspace (NFR-03) |
| NFR-W2 | Rate limiting | 10 msg/min per widget session (SH-03) |
| NFR-W3 | Message content limit | max 10,000 characters per message |
| NFR-W4 | Concurrent dialogs | Up to 1,000 simultaneous WEB_CHAT sessions (NFR-06) |
| NFR-W5 | Data residency | All messages stored on Russian VPS only (FF-10) |
| NFR-W6 | Tenant isolation | RLS ensures operator of tenant A cannot see tenant B dialogs (FF-03) |
| NFR-W7 | Reconnection | Socket.io client retries up to 10 times with 1s base delay |

---

## 6. User Stories

```
US-W1 [MUST] As a client visiting a SaaS product,
      I want to open a chat widget and type my question,
      so that a support operator can reply without me leaving the page.
      Acceptance: Message delivered to operator workspace < 500 ms.

US-W2 [MUST] As an operator,
      I want WEB_CHAT dialogs to appear in my unified inbox alongside Telegram,
      so that I don't need to switch tools.
      Acceptance: dialog:created event fires on new widget session.

US-W3 [MUST] As a client,
      I want to see the operator's reply appear in the widget in real-time,
      without refreshing the page.
      Acceptance: operator:message broadcast reaches dialog:{dialogId} room < 500 ms.

US-W4 [SHOULD] As the PQL Detector,
      I want to receive every inbound client message from the widget,
      so that I can score it for purchase intent without blocking the chat flow.
      Acceptance: analyzePQLInline called on every client:message event; fire-and-forget.
```

---

## 7. User Journey: First Message from Widget

```
Client opens product page → JS widget initializes
  → Socket.io connects to /chat namespace (auth: tenantId)
  → Client types "Do you have an Enterprise plan?"
  → Widget emits: client:message { tenantId, content, externalChannelId }

Server receives client:message:
  → Validates payload (Zod schema)
  → Finds or creates dialog (channelType=WEB_CHAT)
  → Persists message (direction=INBOUND, senderType=CLIENT)
  → socket.join(`dialog:{dialogId}`)
  → Emits: message:new to widget (receipt)
  → Emits: message:new + dialog:created to tenant:{tenantId} room
  → Triggers: analyzePQLInline (non-blocking, BC-02)

Operator sees new dialog in workspace → selects it
  → Operator types reply → sendMessage via REST POST + socket emit
  → Server persists message (direction=OUTBOUND, senderType=OPERATOR)
  → Emits: message:new to dialog:{dialogId} (widget receives reply)
  → Emits: message:new to tenant:{tenantId} (other operators see it)
```

---

## 8. Success Metrics

| Metric | Target |
|--------|--------|
| Widget message delivery p95 | < 500 ms |
| Dialog creation success rate | > 99.9% |
| Widget connection uptime | > 99.5% monthly |
| PQL trigger success rate | > 99% (fire-and-forget, logged on error) |
| Client-side reconnection success | > 95% within 10 retries |
