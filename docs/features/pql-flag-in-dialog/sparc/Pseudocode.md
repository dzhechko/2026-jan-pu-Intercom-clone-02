# Pseudocode: FR-02 — PQL Flag in Dialog
**Feature ID:** FR-02
**Version:** 1.0 | **Date:** 2026-03-04

---

## PS-FR02-01: PQL Detection Pipeline (Backend)

```pseudocode
FUNCTION handleClientMessage(socketEvent: ClientMessagePayload):

  // Validate payload (Zod schema)
  parsed = ClientMessageSchema.safeParse(socketEvent)
  IF NOT parsed.success THEN
    EMIT error({ code: 'INVALID_PAYLOAD' }) to sender socket
    RETURN
  END IF

  // Find or create dialog (BC-01)
  dialog = DialogRepository.findByExternalId(tenantId, externalChannelId)
  IF dialog IS NULL THEN
    dialog = DialogRepository.create({ tenantId, channelType, externalChannelId, contactEmail })
    EMIT dialog:created to tenant:{tenantId} room
  END IF

  // Save message
  message = MessageRepository.create({ dialogId, tenantId, senderType: CLIENT, content })

  // Broadcast message to operators
  EMIT message:new to tenant:{tenantId} room
  EMIT message:new to dialog:{dialogId} room (client widget confirmation)

  // BC-02: Non-blocking PQL analysis (fire-and-forget)
  analyzePQLInline(pqlDetector, chatNamespace, {
    messageId: message.id,
    dialogId: dialog.id,
    tenantId,
    content,
    senderType: 'CLIENT',
  }).catch(err => log.error('[ws-handler] PQL analysis error', err))

END FUNCTION


FUNCTION analyzePQLInline(pqlDetector, chatNamespace, event):

  detection = pqlDetector.analyze(event)

  IF detection IS NOT NULL THEN
    chatNamespace.to(`tenant:${tenantId}`).emit('pql:detected', {
      detectionId: detection.id,
      dialogId: detection.dialogId,
      tenantId: detection.tenantId,
      score: detection.score,
      tier: detection.tier,
      topSignals: detection.topSignals,
    })

    IF notificationService IS CONFIGURED THEN
      notificationService.processNewPQLDetection(detection)  // FR-11
    END IF
  END IF

  RETURN detection

END FUNCTION


FUNCTION PQLDetectorService.analyze(event: MessageEvent):

  // Guard 1: Only CLIENT messages
  IF event.senderType != 'CLIENT' THEN
    RETURN null  // skip: not_client_message
  END IF

  // Decision: ML or rule-v1
  IF mlModelService IS CONFIGURED THEN
    mlPrediction = mlModelService.predict(event.tenantId, event.content)
    IF mlPrediction IS NOT NULL THEN
      score = mlPrediction.score
      tier = mlPrediction.tier
      signals = mlPrediction.signals
      topSignals = mlPrediction.topSignals
    ELSE
      // ML not ready, fall back
      result = analyzeRules(event.content, DEFAULT_RULES)
      score = result.normalizedScore
      tier = calculateTier(score)
      signals = result.signals
      topSignals = result.topSignals
    END IF
  ELSE
    // Rule-v1 path (default MVP)
    result = analyzeRules(event.content, DEFAULT_RULES)
    score = result.normalizedScore
    tier = calculateTier(score)
    signals = result.signals
    topSignals = result.topSignals
  END IF

  // Guard 2: Skip if no signals
  IF signals.length == 0 THEN
    RETURN null
  END IF

  // Build and persist detection
  detection = {
    id: uuid(),
    dialogId: event.dialogId,
    tenantId: event.tenantId,
    messageId: event.messageId,
    score, tier, signals, topSignals,
    createdAt: now()
  }

  detectionRepo.save(detection)           // INSERT pql.detections (RLS)
  dialogUpdater.updatePQLScore(           // UPDATE conversation.dialogs
    event.dialogId, score, tier
  )

  RETURN detection

END FUNCTION


FUNCTION RuleEngine.analyzeRules(content: string, rules: SignalRule[]):

  IF content IS EMPTY THEN
    RETURN { signals: [], rawScore: 0, normalizedScore: 0, topSignals: [] }
  END IF

  // Preprocess
  truncated = content.length > 2000 ? content.slice(0, 2000) : content
  normalized = truncated
    .replace(emoji_range, '')       // strip emoji (EC-03)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')

  matchedSignals = []
  totalWeight = 0

  FOR each rule IN rules:
    match = normalized.match(rule.pattern)
    IF match IS NOT NULL THEN
      matchedSignals.push({
        ruleId: rule.id,
        type: rule.type,
        weight: rule.weight,
        matchedText: match[0]
      })
      totalWeight += rule.weight
    END IF
  END FOR

  normalizedScore = MIN(totalWeight / MAX_POSSIBLE_WEIGHT, 1.0)
  topSignals = matchedSignals.sortByWeightDesc().slice(0, 3)

  RETURN { signals: matchedSignals, rawScore: totalWeight, normalizedScore, topSignals }

END FUNCTION


FUNCTION calculateTier(score: number) -> PQLTier:
  IF score >= 0.80 THEN RETURN 'HOT'
  IF score >= 0.65 THEN RETURN 'WARM'
  RETURN 'COLD'
END FUNCTION
```

---

## PS-FR02-02: Frontend PQL Display Logic

```pseudocode
FUNCTION useDialogs({ token, on }):

  state.dialogs = []

  // Initial load
  ON MOUNT:
    dialogs = fetch('/api/proxy/dialogs')
    state.dialogs = dialogs

  // Real-time: new dialog
  on('dialog:created', ({ dialog }) => {
    state.dialogs = prepend(dialog, state.dialogs)
  })

  // Real-time: new message (update preview + unread count)
  on('message:new', ({ message, dialog }) => {
    state.dialogs = updateOrPrepend(dialog, message, state.dialogs)
  })

  // Real-time: PQL detection (FR-02 core path)
  on('pql:detected', ({ dialogId, score, tier }) => {
    state.dialogs = state.dialogs.map(d =>
      d.id == dialogId
        ? { ...d, pqlScore: score, pqlTier: tier }
        : d
    )
    // This state change triggers:
    //   1. DialogList re-render → pqlBadge() shows HOT/WARM badge
    //   2. RightPanel useEffect re-fires (depends on dialog.pqlScore)
    //      → fetches fresh signal list from API
  })

  RETURN state

END FUNCTION


FUNCTION pqlBadge(tier?: PQLTier) -> JSX | null:
  IF tier IS NULL THEN RETURN null

  styles = {
    HOT:  { label: 'HOT',  className: 'bg-red-100 text-red-700' },
    WARM: { label: 'WARM', className: 'bg-orange-100 text-orange-700' },
    COLD: { label: 'COLD', className: 'bg-gray-100 text-gray-500' },
  }

  RETURN <span className={styles[tier].className}>{styles[tier].label}</span>

END FUNCTION


FUNCTION RightPanel.fetchSignals(dialogId, pqlScore, token):

  // Triggered when dialog changes OR pqlScore changes
  useEffect([dialogId, pqlScore, token]):

    IF dialogId IS NULL OR token IS NULL THEN
      signals = []
      RETURN
    END IF

    setLoadingSignals(true)

    response = fetch('/api/proxy/pql/detections/' + dialogId, {
      headers: { Authorization: 'Bearer ' + token }
    })

    detections = response.json().detections

    // Deduplicate signals across all detections: highest weight per type wins
    signalMap = Map<type -> PQLSignal>()

    FOR each detection IN detections:
      FOR each signal IN detection.signals:
        existing = signalMap.get(signal.type)
        IF existing IS NULL OR signal.weight > existing.weight THEN
          signalMap.set(signal.type, signal)
        END IF
      END FOR
    END FOR

    signals = Array.from(signalMap.values())
      .sort(descending by weight)

    setPqlSignals(signals)
    setLoadingSignals(false)

END FUNCTION


FUNCTION RightPanel.renderPQLSection(dialog, signals, loading):

  tierDisplay = {
    HOT:  { label: 'HOT',  color: 'text-red-600',    bg: 'bg-red-50' },
    WARM: { label: 'WARM', color: 'text-orange-600',  bg: 'bg-orange-50' },
    COLD: { label: 'COLD', color: 'text-gray-600',    bg: 'bg-gray-50' },
    N/A:  { label: 'N/A',  color: 'text-gray-400',    bg: 'bg-gray-50' },
  }

  tier = tierDisplay[dialog.pqlTier] OR tierDisplay['N/A']

  RENDER:
    <section bg={tier.bg}>
      <h3>PQL Score</h3>
      <div>
        <span large bold color={tier.color}>{dialog.pqlScore ?? 0}</span>
        <span badge color={tier.color} bg={tier.bg}>{tier.label}</span>
      </div>

      <p>Top Signals</p>
      IF loading:
        RENDER "Loading signals..."
      ELSE IF signals.length > 0:
        RENDER (signals.slice(0, 5).map signal =>
          <li>
            <span>[dot]</span>
            <span>{signal.type.replace(/_/g, ' ')}</span>
            <span right>{round(signal.weight * 100)}%</span>
          </li>
        )
      ELSE:
        RENDER "No significant signals detected"
      END IF
    </section>

END FUNCTION
```
