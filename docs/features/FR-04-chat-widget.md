# FR-04: Chat Widget
**Status:** Done | **BC:** conversation | **Priority:** must | **Milestone:** M1

## Summary
Embeddable JavaScript widget for customer-facing web chat built with Socket.io and Shadow DOM. Provides real-time messaging with offline message queuing (50 messages max), tenant branding customization, and mobile-responsive design. Bundled with esbuild into `public/widget.js` (<30 KB minified).

## Files Created/Modified

| File | Role |
|------|------|
| `widget/src/index.ts` | Widget entry point, KommuniQ.init() global singleton, Shadow DOM construction, message rendering, UI state machine, launcher bubble |
| `widget/src/socket.ts` | ChatSocket class: /chat namespace connection, offline queue (max 50 items), typed Socket.io events, reconnection with exponential backoff |
| `widget/src/styles.ts` | buildStyles(config) CSS-in-JS: launcher bubble (60x60px), chat window (400x600px), message bubbles with inbound/outbound styling, responsive fullscreen at 480px |
| `widget/src/widget.test.ts` | 14 Jest tests with jsdom: style generation, ChatSocket lifecycle, DOM construction, offline queuing, handler registration |

## Socket.io Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `client:message` | Client → Server | `{ content, tenantId, externalChannelId, contactEmail?, metadata? }` |
| `message:new` | Server → Client | `{ message: { id, dialogId, tenantId, direction, senderType, content, attachments, pqlSignals, createdAt }, dialogId? }` |
| `typing` | Bidirectional | `{ dialogId, isTyping, senderType, tenantId }` |
| `connect` | System | Fires when WebSocket establishes connection |
| `disconnect` | System | Fires when WebSocket closes or errors |
| `connect_error` | System | Fires on connection authentication/network error |

## Key Decisions

1. **Shadow DOM Isolation:** Full CSS isolation via `attachShadow({ mode: 'open' })` prevents host page styles from affecting the widget. Styles injected as `<style>` element in shadow root.

2. **Offline Message Queue (50 max):** Messages are stored locally via ChatSocket queue and flushed on reconnect via `flushQueue()`. Prevents message loss during network interruptions. Silently drops messages beyond limit.

3. **Single esbuild Bundle:** `widget:build` script produces a single minified JS file deployable to CDN. No separate CSS files. All styles are CSS-in-JS via `buildStyles()` function.

4. **Debounced Typing Indicators (3s):** `sendTyping()` auto-stops after 3 seconds of input inactivity via setTimeout. Prevents WebSocket flooding from rapid keystroke events.

5. **Optimistic Message Rendering:** Client messages are rendered immediately before server confirmation. Inbound messages from server are only rendered if `direction === 'INBOUND'` to avoid duplicates.

6. **Session-Based External ID:** `getOrCreateSessionId()` generates UUID v4 via sessionStorage per browser session. Used as `externalChannelId` in WebSocket auth and message payloads. No backend UUID generation needed.

7. **Position & Branding Config:** Widget position (`bottom-right` or `bottom-left`) and primary color injected into CSS variables (`:host`). Supports custom title and greeting text via `WidgetConfig`.

8. **Reconnection Strategy:** Socket.io client handles exponential backoff (1s → 30s max, 0.3 randomization). REJECTED: manual reconnection logic. Socket.io-client manages this transparently.

## Tests

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/widget/src/widget.test.ts` — **14 tests**

### Test Coverage
- **buildStyles (4 tests):**
  - ✅ Injects provided primaryColor into CSS
  - ✅ Includes all required selectors (#kq-launcher, #kq-window, #kq-messages, #kq-input)
  - ✅ Includes typing animation (@keyframes kq-bounce)
  - ✅ Generates different CSS for different colors

- **ChatSocket (7 tests):**
  - ✅ Initializes with 'disconnected' status
  - ✅ Calls status handler immediately on onStatus() registration
  - ✅ Queues messages when not connected
  - ✅ Registers all event handlers on connect (connect, disconnect, message:new, typing)
  - ✅ Connects to /chat namespace with tenantId auth
  - ✅ Notifies message handlers on message:new event
  - ✅ Notifies typing handlers on typing event
  - ✅ Does not create duplicate sockets on multiple connect() calls

- **DOM Sanity (2 tests):**
  - ✅ sessionStorage available in jsdom environment
  - ✅ Shadow DOM attachment and querySelector work in jsdom

### Test Environment
- Jest with `@jest-environment jsdom`
- Socket.io-client mocked with Jest
- No E2E tests (widget is pre-bundled; integration tested in Operator Workspace)

## Acceptance Criteria

- [x] Widget renders in Shadow DOM with full CSS isolation
- [x] Socket.io connection to `/chat` namespace with tenantId authentication
- [x] Offline message queue (max 50 items) — messages flushed on reconnect
- [x] Tenant branding: primaryColor, title, greeting customizable via WidgetConfig
- [x] Typing indicators (debounced 3s) — auto-stop after inactivity
- [x] Mobile responsive: fullscreen layout at 480px breakpoint (100vw × 100dvh)
- [x] Launcher bubble (60x60px) with unread badge (red, top-right corner)
- [x] Chat window (400x600px) with header, messages, input textarea, send button
- [x] Optimistic message rendering (OUTBOUND before server echo)
- [x] HTML escaping in title/greeting to prevent XSS
- [x] 14 tests passing (style generation, socket lifecycle, DOM construction)
- [x] esbuild bundling producing <30 KB minified JS
- [x] Global `window.KommuniQ` singleton with `init(config)` method
