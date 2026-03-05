# UI Guide

## Chat Widget

### Embedding

Add the chat widget to any website with a single script tag:

```html
<script
  src="https://your-domain.ru/widget.js"
  data-tenant-id="550e8400-e29b-41d4-a716-446655440000"
  data-position="bottom-right"
  data-color="#4F46E5"
  data-title="Need help?"
  data-greeting="Hi! How can we help you today?"
  async
></script>
```

### Configuration attributes

| Attribute | Default | Description |
|-----------|---------|-------------|
| `data-tenant-id` | (required) | Your tenant UUID |
| `data-position` | `bottom-right` | Widget position: `bottom-right`, `bottom-left` |
| `data-color` | `#4F46E5` | Primary brand color (hex) |
| `data-title` | `"Support"` | Widget header title |
| `data-greeting` | `""` | Initial greeting message |
| `data-language` | `"ru"` | Language: `ru`, `en` |
| `data-auto-open` | `false` | Auto-open widget on page load |
| `data-delay` | `0` | Delay before auto-open (ms) |

### Programmatic control

The widget exposes a global API:

```javascript
// Open the widget
window.KommuniK.open();

// Close the widget
window.KommuniK.close();

// Send a pre-filled message
window.KommuniK.sendMessage('I want to upgrade my plan');

// Set visitor info (for Memory AI matching)
window.KommuniK.identify({
  email: 'visitor@example.com',
  name: 'Anna Ivanova',
  company: 'TechCorp'
});

// Listen to events
window.KommuniK.on('messageReceived', (message) => {
  console.log('New message:', message.text);
});
```

### Anti-spam protection

The widget enforces a rate limit of 10 messages per minute per session. Exceeding this limit shows a temporary "Please wait before sending more messages" notice.

## Operator Workspace

### Three-panel layout

```
+--------------------+---------------------------+--------------------+
| DIALOG LIST        | CHAT PANEL                | RIGHT PANEL        |
| 280px              | flexible                  | 320px              |
|                    |                           |                    |
| [Search...]        | Dialog #1234        [x]   | CLIENT INFO        |
|                    | Channel: Telegram         | Name: Anna I.      |
| ACTIVE (3)         |                           | Email: anna@tc.ru  |
| > Dialog #1234  *  | [10:31] Anna:             | Company: TechCorp  |
|   Dialog #1235     | How much does the         |                    |
|   Dialog #1236     | enterprise plan cost?     | PQL STATUS         |
|                    |                           | Score: 0.85 HOT    |
| UNASSIGNED (2)     | [10:32] You:              | Signals: 3 matched |
|   Dialog #1237     | Let me check that for     |                    |
|   Dialog #1238     | you...                    | MEMORY AI          |
|                    |                           | Deal: #4521        |
| CLOSED             |                           | Stage: Negotiation |
| (show more)        |                           | Value: 150,000 RUB |
|                    |                           |                    |
|                    | [Type a message...]  Send | [Notes...]         |
+--------------------+---------------------------+--------------------+
```

### Responsive behavior

| Breakpoint | Layout |
|------------|--------|
| >= 1280px | Three panels visible |
| 768-1279px | Two panels (dialog list + chat), right panel as overlay |
| < 768px | Single panel with navigation (not recommended for operators) |

### Panel resizing

Panel widths can be adjusted by dragging the dividers. Double-click a divider to reset to default widths.

## Keyboard Shortcuts

| Shortcut | Context | Action |
|----------|---------|--------|
| `Enter` | Chat input | Send message |
| `Shift+Enter` | Chat input | New line |
| `Ctrl+Enter` | Dialog list | Assign selected dialog to yourself |
| `Alt+C` | Chat panel | Close current dialog |
| `Ctrl+K` | Global | Open search |
| `Ctrl+/` | Global | Show keyboard shortcuts overlay |
| `Ctrl+N` | Global | Focus message input |
| `Ctrl+Up` | Dialog list | Select previous dialog |
| `Ctrl+Down` | Dialog list | Select next dialog |
| `Ctrl+Shift+U` | Dialog list | Toggle unassigned filter |
| `Ctrl+Shift+P` | Dialog list | Toggle PQL-only filter |
| `Ctrl+Shift+T` | Chat panel | Transfer dialog to another operator |
| `Alt+1..5` | Chat input | Insert quick reply template 1-5 |
| `Esc` | Global | Close overlay / cancel action |

## PQL Visualization

### Tier colors

| Tier | Background | Text | Border | Icon |
|------|-----------|------|--------|------|
| HOT | `#FEE2E2` (red-100) | `#991B1B` (red-800) | `#EF4444` (red-500) | Flame |
| WARM | `#FEF3C7` (amber-100) | `#92400E` (amber-800) | `#F59E0B` (amber-500) | Sun |
| COLD | `#F3F4F6` (gray-100) | `#374151` (gray-700) | `#9CA3AF` (gray-400) | Snowflake |

### Badge in dialog list

Each dialog with a PQL score shows a small colored dot:

```
[Red dot]   Dialog #1234 — Anna Ivanova        10:31
            "How much does enterprise cost?"

[Yellow dot] Dialog #1235 — Dmitry Petrov       10:28
            "Can we try the trial first?"
```

### PQL detail card (right panel)

```
+------------------------------------------+
| PQL SCORE                          0.85  |
| ████████████████████░░░░  HOT            |
|                                          |
| MATCHED SIGNALS                          |
| ┌──────────────────────────────────────┐ |
| │ "how much does it cost"    +0.20     │ |
| │ "enterprise plan"          +0.18     │ |
| │ "ready to purchase"        +0.25     │ |
| │ "50 user seats"            +0.20     │ |
| └──────────────────────────────────────┘ |
|                                          |
| FEEDBACK   [thumbs up] [thumbs down]    |
+------------------------------------------+
```

### Score progress bar colors

The progress bar gradient reflects the score:

- 0.00 - 0.64: Gray gradient
- 0.65 - 0.79: Amber gradient
- 0.80 - 1.00: Red gradient with pulse animation

## Revenue Dashboard

### Overview metrics (top row)

```
+------------------+------------------+------------------+------------------+
| TOTAL REVENUE    | PQL DETECTED     | CONVERSION RATE  | AVG DEAL SIZE   |
| 2,450,000 RUB    | 47 this month    | 34%              | 52,127 RUB      |
| +12% vs prev     | +8 vs prev       | +2.1% vs prev    | -3% vs prev     |
+------------------+------------------+------------------+------------------+
```

### Charts

| Chart | Type | Description |
|-------|------|-------------|
| Revenue over time | Line chart | Monthly revenue attributed to support dialogs |
| PQL detection trend | Bar chart | PQLs detected per week, stacked by tier |
| Revenue by channel | Pie chart | Revenue split across Widget, Telegram, VK Max |
| Top operators | Horizontal bar | Operators ranked by attributed revenue |
| PQL conversion funnel | Funnel chart | Detected -> Contacted -> Deal Created -> Closed Won |

### Filters

| Filter | Options |
|--------|---------|
| Period | This month, Last 3 months, Last 6 months, Year, Custom range |
| Channel | All, Widget, Telegram, VK Max |
| PQL Tier | All, HOT only, WARM only |
| Operator | All, Specific operator |

### Export

Revenue reports can be exported:

- **PDF:** Full report with charts and tables.
- **CSV:** Raw data for spreadsheet analysis.
- **Email:** Scheduled delivery (daily, weekly, monthly).

## Analytics

### Channel analytics

Shows dialog volume and PQL detection rates per channel:

```
Channel      | Dialogs | PQLs | PQL Rate | Avg Score
-------------|---------|------|----------|----------
Widget       |     312 |   28 |    8.9%  |     0.72
Telegram     |     187 |   15 |    8.0%  |     0.68
VK Max       |      64 |    4 |    6.3%  |     0.66
```

### Trend analysis

- PQL detection accuracy over time (feedback-adjusted).
- Average response time per operator.
- Dialog resolution time by channel.
- Peak hours heatmap (day of week x hour).

### Top operators

Ranked by:
- Number of PQLs handled.
- Revenue attributed.
- Average response time.
- Client satisfaction (if feedback enabled).

### Real-time dashboard

The analytics page includes a real-time section showing:
- Active dialogs count.
- Online operators count.
- Unassigned queue length.
- PQL detections in the last hour.

Data updates every 10 seconds via WebSocket.
