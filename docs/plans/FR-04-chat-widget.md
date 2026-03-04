# FR-04: Chat Widget

**Status:** Done | **BC:** conversation | **Priority:** must | **Milestone:** M1

## Summary

Embeddable JavaScript widget for customer-facing web chat. Uses Shadow DOM for CSS isolation, Socket.io for real-time messaging with offline queue (50 messages max), and tenant branding support. Bundled with esbuild into `public/widget.js` (<30 KB minified).

## User Stories

- US-FR04-01: As a tenant admin, I want to embed a chat widget on my site, so that clients can reach support.
- US-FR04-02: As a client, I want my messages queued when offline, so that nothing is lost.
- US-FR04-03: As a tenant admin, I want to customize widget colors and title, so it matches my brand.

## Technical Design

### Architecture

```
widget/src/
  index.ts    — KommuniQ.init() entry point, Shadow DOM rendering, UI state machine
  socket.ts   — ChatSocket class: connect, sendMessage (with offline queue), typing
  styles.ts   — CSS-in-JS for shadow DOM: launcher, chat window, messages, responsive
```

### Files

| File | Role |
|------|------|
| `widget/src/index.ts` | Widget entry point, config parsing, Shadow DOM, message list, input form, launcher bubble |
| `widget/src/socket.ts` | ChatSocket: Socket.io /chat namespace, offline queue (max 50), typed events, reconnection |
| `widget/src/styles.ts` | buildStyles(config) — launcher (60x60), chat window (400x600), message bubbles, mobile fullscreen at 480px |
| `widget/src/widget.test.ts` | 14 tests covering config, shadow DOM, socket, styles |

### Key Decisions

1. **Shadow DOM:** Full CSS isolation — host page styles cannot affect the widget.
2. **Offline queue (50 max):** Messages are stored locally and flushed on reconnect, preventing message loss during network interruptions.
3. **esbuild bundling:** `widget:build` script produces a single minified JS file for CDN deployment.
4. **Debounced typing (3s):** Prevents flooding the WebSocket with typing events.

## Socket.io Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `client:message` | Client → Server | `{ content, tenantId, externalChannelId, contactEmail }` |
| `message:new` | Server → Client | `{ dialogId, message }` |
| `typing` | Both | `{ dialogId, senderType }` |
| `connect` / `disconnect` | System | Connection status |

## Dependencies

- Depends on: nothing
- Blocks: FR-07 (Operator Workspace)

## Tests

- `widget/src/widget.test.ts` — 14 tests:
  - Config defaults and overrides
  - Shadow DOM creation and isolation
  - ChatSocket connection and offline queue
  - Style generation with custom branding
  - Message rendering and sorting

## Acceptance Criteria

- [x] Widget renders in Shadow DOM
- [x] Socket.io connection to /chat namespace
- [x] Offline message queue (max 50)
- [x] Tenant branding: color, title, greeting
- [x] Typing indicators (debounced 3s)
- [x] Mobile responsive (fullscreen at 480px)
- [x] 14 tests passing
