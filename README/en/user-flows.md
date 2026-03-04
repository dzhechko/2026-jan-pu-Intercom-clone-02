# User Flows

## Flow 1: Visitor Sends a Message

A website visitor initiates a support dialog through the chat widget.

### Steps

```
1. Visitor opens website with embedded KommuniK widget
2. Visitor clicks the widget bubble (bottom-right corner)
3. Widget opens, shows greeting message
4. Visitor types and sends a message
       |
       v
5. Widget sends message via WebSocket to KommuniK server
6. Server creates a new Dialog (status: UNASSIGNED)
7. Server creates a Message record linked to the Dialog
8. Server emits MessageReceived event to Redis Stream
       |
       v
9. WebSocket pushes new dialog to Operator Workspace
10. Dialog appears in the UNASSIGNED section for all operators
11. Operator clicks dialog → clicks "Assign to me" (or Ctrl+Enter)
12. Dialog moves to operator's ACTIVE list
       |
       v
13. Operator types a reply and presses Enter
14. Server delivers reply to visitor's widget via WebSocket
15. Visitor sees the reply in the chat widget
16. Conversation continues until resolved
       |
       v
17. Operator clicks Close (or Ctrl+W)
18. Dialog status changes to CLOSED
19. DialogClosed event emitted
```

### Channels

This flow applies to all channels with channel-specific transport:

| Channel | Intake | Delivery |
|---------|--------|----------|
| Widget | WebSocket | WebSocket |
| Telegram | Webhook POST | Telegram Bot API |
| VK Max | MCP event | Max MCP send |

### Error handling

- If WebSocket disconnects, the widget shows "Reconnecting..." and retries.
- If no operator is available, the dialog stays in UNASSIGNED with a queue position shown to the visitor.
- Messages are persisted even if the visitor closes the browser; the dialog resumes when they return.

---

## Flow 2: PQL Detected in a Dialog

The PQL detection system identifies purchase intent and notifies the operator.

### Steps

```
1. Client sends message: "How much does the enterprise plan cost for 50 users?"
       |
       v
2. MessageReceived event → Redis Stream: events:messages
       |
       v
3. PQL Detector worker picks up the event
4. Two parallel processes start:
   ├── RuleEngine: scans message against 15+ signal patterns
   │     Match: "how much" (pricing, +0.20)
   │     Match: "enterprise plan" (scaling, +0.18)
   │     Match: "50 users" (scaling, +0.20)
   │     Cumulative score: 0.58
   │
   └── Memory AI: queries amoCRM MCP for client context
         Found: existing contact, active deal in Negotiation stage
         Context boost: +0.27 (active deal increases PQL likelihood)
       |
       v
5. Combined PQL Score: 0.85 → Tier: HOT
6. PQLDetected event → Redis Stream: events:pql
       |
       v
7. Three parallel consumers:
   ├── WebSocket: push PQL badge to Operator Workspace
   │     → Red HOT badge appears on dialog in left panel
   │     → Right panel shows PQL score breakdown
   │     → Right panel shows Memory AI CRM context
   │
   ├── Revenue Attribution: creates pending attribution record
   │     → Links dialog to amoCRM deal #4521
   │     → Status: PENDING (awaiting deal closure)
   │
   └── PQL Pulse: sends notification
         → In-app notification to operator
         → Email to sales team (if configured)
         → Telegram alert (if configured)
       |
       v
8. Operator sees the HOT PQL indicator
9. Operator reviews CRM context in the right panel:
   - Contact: Anna Ivanova, TechCorp
   - Deal #4521: Negotiation stage, 150,000 RUB
   - Last call: 3 days ago with Sales Manager Dmitry
       |
       v
10. Operator provides informed response using CRM context
11. Operator coordinates with Sales Manager for deal closure
       |
       v
12. Deal closes in amoCRM → amoCRM webhook fires
13. Revenue Attribution updates: PENDING → ATTRIBUTED
14. Revenue: 150,000 RUB attributed to support dialog #1234
```

### PQL feedback loop

```
Operator disagrees with PQL score
       |
       v
Clicks thumbs down on PQL badge
       |
       v
Selects reason: "False positive — client was asking for a friend"
       |
       v
PQLFeedbackReceived event stored
       |
       v
Future ML model (v2) uses feedback for retraining
```

---

## Flow 3: Telegram Message Lifecycle

A message arrives from Telegram, is handled in the workspace, and the reply goes back to Telegram.

### Steps

```
1. Client sends message in Telegram to the bot
       |
       v
2. Telegram sends webhook POST to:
   https://your-domain.ru/api/webhooks/telegram/<tenant-id>
       |
       v
3. Server verifies HMAC-SHA256 signature
   ├── Valid → continue
   └── Invalid → HTTP 401, request rejected
       |
       v
4. Telegram adapter extracts:
   - Chat ID (used as client session identifier)
   - Message text
   - Sender info (first_name, last_name, username)
   - Timestamp
       |
       v
5. Server checks if an active Dialog exists for this chat ID
   ├── Exists → append Message to existing Dialog
   └── New → create Dialog (channel: TELEGRAM, status: UNASSIGNED)
       |
       v
6. MessageReceived event → Redis Stream
   (PQL detection flow starts in parallel)
       |
       v
7. Dialog appears in Operator Workspace
   - Channel icon shows Telegram logo
   - Client name from Telegram profile
       |
       v
8. Operator assigns and reads the message
9. Operator types a reply and sends it
       |
       v
10. Server calls Telegram Bot API:
    POST https://api.telegram.org/bot<token>/sendMessage
    { "chat_id": "<chat-id>", "text": "<operator-reply>" }
       |
       v
11. Client receives reply in Telegram
12. Conversation continues through the same flow
```

### Telegram-specific features

- **Rich messages:** Operator can send formatted text (bold, italic, links).
- **Photos and documents:** Forwarded as attachments in the workspace.
- **Group chats:** Not supported; bot responds only in private chats.
- **Bot commands:** `/start` triggers a greeting message configured per tenant.

---

## Flow 4: Revenue Report Generation

An administrator generates a Revenue Intelligence Report.

### Steps

```
1. Admin navigates to Revenue Dashboard
2. Clicks "Generate Report" button
3. Selects parameters:
   - Period: Last month (January 2026)
   - Channels: All
   - Format: PDF
       |
       v
4. API call: POST /api/revenue/reports
   {
     "period": { "from": "2026-01-01", "to": "2026-01-31" },
     "channels": ["widget", "telegram", "max"],
     "format": "pdf"
   }
       |
       v
5. Revenue Report Service starts generation:
   a. Query all ATTRIBUTED records for the tenant in the period
   b. Group by channel, operator, and PQL tier
   c. Calculate aggregates:
      - Total attributed revenue
      - Revenue per channel
      - Revenue per operator
      - PQL detection count by tier
      - Conversion rate (PQL → closed deal)
      - Average deal size
      - Comparison with previous period
       |
       v
6. Report record created (status: GENERATING)
7. ReportGenerated event → Redis Stream
       |
       v
8. PDF renderer creates the document:
   - Cover page with tenant branding
   - Executive summary with key metrics
   - Revenue breakdown charts
   - Operator performance table
   - Channel comparison
   - PQL detection analysis
   - Recommendations
       |
       v
9. PDF stored, report status: READY
       |
       v
10. If email delivery configured:
    - Resend API sends email with PDF attachment
    - Recipients: configured admin/sales emails
    - Email contains only metadata (no PII in email body)
       |
       v
11. Admin downloads PDF from dashboard
    GET /api/revenue/reports/<report-id>/download
```

### Scheduled reports

```bash
# Configure weekly report schedule
curl -X POST https://your-domain.ru/api/revenue/reports/schedule \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "frequency": "weekly",
    "dayOfWeek": "monday",
    "time": "09:00",
    "timezone": "Europe/Moscow",
    "recipients": ["admin@acme.ru", "sales@acme.ru"],
    "format": "pdf"
  }'
```

---

## Flow 5: New Tenant Onboarding

A new company registers and sets up KommuniK.

### Steps

```
1. Company admin visits https://your-domain.ru/register
       |
       v
2. Fills registration form:
   - Company name
   - Admin email and password
   - Admin name
   - Selected plan
       |
       v
3. POST /api/auth/register
       |
       v
4. Server creates:
   a. Tenant record with unique UUID
   b. RLS policies activated for the new tenant
   c. Admin Operator account (role: ADMIN)
   d. Default PQL rules (15 signals) copied to tenant
   e. Default notification settings
   f. JWT token issued
       |
       v
5. Admin is redirected to the Setup Wizard
       |
       v
6. Step 1: Team Setup
   - Invite operators (email invitations)
   - Set roles (ADMIN / OPERATOR)
       |
       v
7. Step 2: Channel Setup
   Choose and configure channels:
   ├── Widget: copy embed script for website
   ├── Telegram: enter bot token, webhook auto-configured
   └── VK Max: enter bot token, MCP auto-configured
       |
       v
8. Step 3: CRM Integration
   - Connect amoCRM (OAuth flow)
   - Select pipeline for PQL deals
   - Map custom fields
       |
       v
9. Step 4: PQL Configuration
   - Review default PQL rules
   - Adjust weights for industry
   - Set PQL tier thresholds (or keep defaults)
       |
       v
10. Step 5: Notifications
    - Configure PQL Pulse recipients
    - Set notification channels (in-app, email, Telegram)
    - Set quiet hours
       |
       v
11. Setup complete — redirect to Operator Workspace
       |
       v
12. Admin embeds widget on their website:
    <script src="https://your-domain.ru/widget.js"
            data-tenant-id="<tenant-uuid>" async></script>
       |
       v
13. First visitor message arrives
    → Dialog created
    → Operator notified
    → PQL detection active
    → Revenue attribution ready
       |
       v
14. KommuniK is fully operational
```

### Post-onboarding checklist

| Step | Verification |
|------|-------------|
| Widget embedded | Send a test message from the website |
| Telegram connected | Send `/start` to the bot |
| amoCRM linked | Check that Memory AI shows CRM data |
| PQL rules active | Send a message containing "how much does it cost" |
| Notifications working | Verify PQL Pulse alert arrives |
| Operators invited | All team members can log in |
| Revenue tracking | Create a test deal in amoCRM, verify attribution |
