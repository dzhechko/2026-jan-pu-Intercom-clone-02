# FR-11: PQL Pulse Notifications -- Pseudocode

## Algorithm 1: Tier-Based Notification Routing

This is the core algorithm in `NotificationService.processNewPQLDetection()`.

```
FUNCTION processNewPQLDetection(detection: PQLNotificationPayload) -> Notification[]
  INPUT:
    detection.tier       -- 'HOT' | 'WARM' | 'COLD'
    detection.dialogId   -- UUID of the dialog
    detection.tenantId   -- UUID of the tenant
    detection.score      -- 0.0 to 1.0
    detection.topSignals -- array of { ruleId, type, weight, matchedText }
    detection.contactEmail     -- optional string
    detection.assignedOperatorId -- optional string

  OUTPUT:
    created: Notification[] -- notifications that were created and sent

  BEGIN
    created = []

    -- Step 1: Filter COLD tier (no notifications)
    IF detection.tier == 'COLD' THEN
      LOG "COLD PQL for dialog {dialogId} -- skipping"
      RETURN created
    END IF

    -- Step 2: Duplicate prevention
    existing = repo.findByDialogId(detection.dialogId)
    alreadyNotifiedPush = existing.ANY(n => n.type == 'pql_detected' AND n.channel == 'push')

    IF alreadyNotifiedPush THEN
      LOG "Already notified for dialog {dialogId} -- skipping"
      RETURN created
    END IF

    -- Step 3: Build Socket.io push payload
    socketPayload = {
      type: 'pql_detected',
      dialogId: detection.dialogId,
      score: detection.score,
      tier: detection.tier,
      topSignals: detection.topSignals.MAP(s => { type: s.type, weight: s.weight }),
      contactEmail: detection.contactEmail ?? null,
      timestamp: NOW().toISOString()
    }

    -- Step 4: Determine target room
    IF detection.assignedOperatorId EXISTS THEN
      targetRoom = "operator:{assignedOperatorId}"
    ELSE
      targetRoom = "tenant:{tenantId}"
    END IF

    -- Step 5: Emit push notification
    pushEmitter.toRoom(targetRoom).emit('notification:pql', socketPayload)

    -- Step 6: Persist push notification record
    pushNotification = buildNotification(tenantId, operatorId='all'|assignedId, channel='push', detection)
    repo.save(pushNotification)
    created.APPEND(pushNotification)

    -- Step 7: HOT tier -- also send email
    IF detection.tier == 'HOT' THEN
      emailPayload = formatPQLNotificationEmail(detection, tenant)
      emailRecipient = assignedOperatorId EXISTS
        ? "operator-{assignedOperatorId}@kommuniq.local"
        : "admin@kommuniq.local"
      emailService.send({ ...emailPayload, to: emailRecipient })

      emailNotification = buildNotification(tenantId, operatorId, channel='email', detection)
      repo.save(emailNotification)
      created.APPEND(emailNotification)
    END IF

    LOG "{tier} PQL for dialog {dialogId} -- sent {created.length} notification(s)"
    RETURN created
  END
END FUNCTION
```

## Algorithm 2: Notification Construction

```
FUNCTION buildNotification(tenantId, operatorId, channel, detection) -> Notification
  INPUT:
    tenantId    -- UUID
    operatorId  -- UUID or 'all' or 'admin'
    channel     -- 'push' | 'email'
    detection   -- PQLNotificationPayload

  BEGIN
    tierLabel = detection.tier == 'HOT' ? 'Hot' : 'Warm'

    RETURN {
      id: UUID_v4(),
      tenantId: tenantId,
      operatorId: operatorId,
      type: 'pql_detected',
      channel: channel,
      dialogId: detection.dialogId,
      title: "{tierLabel} PQL Lead Detected",
      body: "Score: {score*100}% -- {topSignals.map(type).join(', ')}",
      metadata: {
        score: detection.score,
        tier: detection.tier,
        topSignals: detection.topSignals.MAP(s => { type, weight }),
        contactEmail: detection.contactEmail
      },
      read: false,
      createdAt: NOW()
    }
  END
END FUNCTION
```

## Algorithm 3: Email Formatting

```
FUNCTION formatPQLNotificationEmail(detection, tenant) -> EmailPayload
  INPUT:
    detection.dialogId, score, tier, topSignals, contactEmail
    tenant.name, tenant.baseUrl

  BEGIN
    baseUrl = tenant.baseUrl ?? env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    dialogLink = "{baseUrl}/?dialog={dialogId}"
    tierEmoji = tier == 'HOT' ? fire : tier == 'WARM' ? yellow : blue

    html = RENDER_HTML_TEMPLATE(
      header:  "{tierEmoji} New {tier} PQL Lead Detected",
      body:    score, tier, contactEmail, signalsList,
      cta:     "Open Dialog" -> dialogLink,
      footer:  "KommuniQ Revenue Intelligence -- {tenant.name}"
    )

    RETURN {
      to: '',          -- caller fills in recipient
      subject: "{tierEmoji} {tier} PQL Lead -- Score {score*100}%",
      html: html
    }
  END
END FUNCTION
```

## Algorithm 4: Client-Side Real-Time Merge (useNotifications hook)

```
FUNCTION useNotifications(token, socketOn) -> NotificationState
  STATE:
    notifications: PQLNotification[] = []
    unreadCount: number = 0
    loading: boolean = true

  ON_MOUNT:
    -- Fetch initial data from REST API
    notifications = GET /api/notifications?limit=20 (Bearer token)
    unreadCount   = GET /api/notifications/unread-count (Bearer token)
    loading = false

  ON_SOCKET_EVENT('notification:pql', payload):
    -- Convert Socket.io payload to PQLNotification shape
    newNotification = {
      id: "rt-{timestamp}",
      type: 'pql_detected',
      dialogId: payload.dialogId,
      title: "{tier} PQL Lead Detected",
      body: "Score: {score}% -- {signals}",
      metadata: { score, tier, topSignals, contactEmail },
      read: false,
      createdAt: payload.timestamp
    }
    -- Prepend and cap at 50
    notifications = [newNotification, ...notifications].SLICE(0, 50)
    unreadCount = unreadCount + 1

  FUNCTION markAsRead(notificationId):
    PATCH /api/notifications/{notificationId}/read (Bearer token)
    IF success:
      notifications = notifications.MAP(n => n.id == notificationId ? { ...n, read: true } : n)
      unreadCount = MAX(0, unreadCount - 1)

  RETURN { notifications, unreadCount, loading, markAsRead, refresh }
END FUNCTION
```

## Algorithm 5: Duplicate Detection Query

```
FUNCTION isDuplicateNotification(dialogId) -> boolean
  BEGIN
    existing = SELECT * FROM notification_jobs WHERE dialog_id = {dialogId} ORDER BY created_at DESC
    RETURN existing.ANY(n => n.type == 'pql_detected' AND n.channel == 'push')
  END
END FUNCTION
```
