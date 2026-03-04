# FR-04: Chat Widget
**Status:** Done | **BC:** BC-01 Conversation | **Priority:** MUST

## Summary
Implemented a fully self-contained embeddable chat widget that customers install via a single `<script>` tag. Uses Shadow DOM for complete CSS isolation from host pages, Socket.io for real-time messaging with offline queue and auto-reconnect, and CSS-in-JS with tenant branding support. The widget is bundled with esbuild into a single file under 30 KB.

## User Stories
- US-01: As a tenant, I want to embed a chat widget on my website with a single script tag so that my customers can reach support instantly.
- US-02: As a client (end user), I want to send and receive messages in real time so that I get immediate help from support operators.
- US-03: As a client, I want to see a typing indicator when an operator is responding so that I know help is on the way.
- US-04: As a client, I want my messages queued when offline so that nothing is lost if my connection drops temporarily.
- US-05: As a tenant, I want to customize the widget color, title, and greeting so that it matches my brand.

## Technical Design

### Files Created
- `widget/src/index.ts` -- Main widget class (KommuniQWidget) with Shadow DOM construction, event listeners, message handling, typing indicators, connection status, unread badge, and SVG icons. Exposes `window.KommuniQ.init(config)` global API.
- `widget/src/socket.ts` -- ChatSocket class wrapping Socket.io client for the `/chat` namespace. Features: offline message queue (max 50), typed event handlers (message:new, typing, error), exponential backoff reconnect, typing debounce (3s auto-stop).
- `widget/src/styles.ts` -- `buildStyles()` function generating full CSS with CSS custom properties for branding. Covers launcher bubble, chat window, header, messages, typing dots animation, input area, status bar, responsive breakpoints (mobile fullscreen at 480px).
- `widget/src/widget.test.ts` -- 13 tests covering style generation, ChatSocket lifecycle, Shadow DOM sanity, and sessionStorage availability.

### Key Decisions
- Shadow DOM (`mode: 'open'`) for full CSS isolation from host page -- no style conflicts regardless of host CSS.
- Session ID generated client-side via lightweight UUID v4 pattern, persisted in `sessionStorage` (per-tab, not cross-tab) to maintain dialog continuity within a browser session.
- Offline message queue with 50-message cap prevents memory issues on prolonged disconnections while preserving user messages.
- CSS-in-JS approach (template literal) avoids external stylesheet dependency -- everything self-contained in the bundle.
- Optimistic message rendering -- outbound messages appear immediately before server confirmation, inbound messages from operators are appended on `message:new` event.
- Z-index set to `2147483647` (max 32-bit int) to ensure widget stays on top of any host page elements.
- Mobile responsive: at 480px and below, chat window goes fullscreen for better mobile UX.
- Typing indicator: widget sends typing events on input change, auto-stops after 3 seconds of inactivity.

### Widget Configuration
```typescript
interface WidgetConfig {
  tenantId: string          // required
  apiUrl: string            // required
  position?: 'bottom-right' | 'bottom-left'
  primaryColor?: string     // default: '#4F46E5'
  title?: string            // default: 'Support Chat'
  greeting?: string         // default: 'Hello! How can we help?'
}
```

## Socket.io Events
| Event | Direction | Payload |
|-------|-----------|---------|
| `client:message` | Client -> Server | `{ content, tenantId, externalChannelId, contactEmail?, metadata? }` |
| `message:new` | Server -> Client | `{ message: { id, dialogId, tenantId, direction, senderType, content, attachments, pqlSignals, createdAt }, dialogId? }` |
| `typing` | Bidirectional | `{ dialogId, isTyping, senderType, tenantId }` |
| `error` | Server -> Client | `{ code, details? }` |

## Dependencies
- Depends on: BC-01 Conversation server (WebSocket handler `/chat` namespace), IAM tenant registration (tenantId)
- Blocks: FR-08 Telegram Channel (shares Conversation BC infrastructure)

## Tests
- `widget/src/widget.test.ts` -- 13 tests:
  - buildStyles: injects primaryColor, includes launcher/window/messages/input selectors, includes typing animation, generates different CSS for different colors (4 tests)
  - ChatSocket: initializes disconnected, onStatus immediate callback, queues messages when offline, registers event handlers on connect, connects to /chat namespace, notifies message/typing handlers, prevents duplicate sockets (7 tests)
  - Widget DOM: sessionStorage availability, Shadow DOM attachment sanity (2 tests)

## Acceptance Criteria
- [x] Widget embeddable via single `<script>` tag with `KommuniQ.init()` call
- [x] Shadow DOM provides full CSS isolation from host page
- [x] Real-time messaging via Socket.io `/chat` namespace
- [x] Offline message queue (up to 50 messages) with auto-flush on reconnect
- [x] Typing indicator shows "Agent is typing..." with animated dots
- [x] Connection status bar (connecting/connected/disconnected)
- [x] Unread message badge on launcher when widget is closed
- [x] Configurable branding: color, title, greeting, position
- [x] Mobile responsive (fullscreen at 480px breakpoint)
- [x] XSS-safe HTML escaping for user-configurable title
- [x] Auto-resize textarea with 120px max height
- [x] Enter to send, Shift+Enter for newline
