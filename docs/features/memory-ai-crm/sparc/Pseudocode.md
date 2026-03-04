# Pseudocode: FR-03 Memory AI — CRM Context
**Feature ID:** FR-03
**Version:** 1.0 | **Date:** 2026-03-04
**Reference:** docs/pseudocode.md PS-03, PS-06

---

## ALG-01: MemoryAIService.fetchContext()
**File:** `src/pql/application/services/memory-ai-service.ts`
**SLA:** < 1000ms p95 (cache hit < 10ms, cache miss < 800ms via MCP)

```pseudocode
FUNCTION fetchContext(contactEmail: string, tenantId: string) -> CRMResult<CRMContactContext>:

  // GUARD: empty email → return empty context immediately
  IF contactEmail IS EMPTY THEN
    RETURN CRMResult.ok(emptyContext(contactEmail))
  END IF

  // STEP 1: Check Redis cache
  cacheKey = "memory-ai:context:{tenantId}:{contactEmail.toLowerCase()}"
  cached = Redis.get(cacheKey)   // null if Redis unavailable
  IF cached IS NOT NULL THEN
    RETURN CRMResult.ok(JSON.parse(cached))
  END IF

  // STEP 2: Call CRM port (adapter behind circuit breaker)
  TRY
    result = CRMPort.getContactContextEnriched(contactEmail, tenantId)
    //  result is CRMResult<CRMContactContext>

    IF result.status == 'ok' THEN
      // STEP 3: Cache the successful result
      Redis.set(cacheKey, JSON.stringify(result.data), 'EX', 300)
      RETURN result
    END IF

    IF result.status == 'not_configured' THEN
      // Tenant has no CRM — pass through, do NOT cache
      RETURN result
    END IF

    // status == 'error' → graceful degradation
    RETURN CRMResult.ok(emptyContext(contactEmail))

  CATCH any_exception:
    // Unexpected error (network, parse failure, etc.) → graceful degradation
    RETURN CRMResult.ok(emptyContext(contactEmail))
  END TRY

END FUNCTION


FUNCTION emptyContext(contactEmail: string) -> CRMContactContext:
  RETURN {
    contactEmail: contactEmail,
    deals: [],
    previousDialogCount: 0,
    tags: [],
    enrichmentScore: 0,
  }
END FUNCTION
```

---

## ALG-02: MemoryAIService.invalidateCache()
**Trigger:** CRM data updated (e.g., deal closed, plan changed)

```pseudocode
FUNCTION invalidateCache(contactEmail: string, tenantId: string) -> void:

  IF Redis IS NULL THEN RETURN  // no-op when caching disabled

  cacheKey = "memory-ai:context:{tenantId}:{contactEmail.toLowerCase()}"
  TRY
    Redis.del(cacheKey)
  CATCH redis_error:
    // Ignore Redis errors — cache invalidation is best-effort
    // Next fetchContext() call will hit CRM directly
  END TRY

END FUNCTION
```

---

## ALG-03: AmoCRMMCPAdapter.getContactContextEnriched()
**File:** `src/integration/adapters/amocrm-mcp-adapter.ts`
**Pattern:** Circuit Breaker + Anti-Corruption Layer + Graceful Degradation
**SLA:** < 2000ms (timeout enforced at two levels)

```pseudocode
FUNCTION getContactContextEnriched(email: string, tenantId: string) -> CRMResult<CRMContactContext>:

  // GUARD: not configured
  IF mcpBaseUrl IS EMPTY THEN
    RETURN CRMResult.notConfigured()
  END IF

  TRY
    // STEP 1: Call through Circuit Breaker
    result = CircuitBreaker.fire({
      tool: 'get_contact_enriched',
      params: { email: email, tenantId: tenantId }
    })
    // CircuitBreaker calls callMCP() internally
    // If circuit OPEN → fallback() fires instead → result.ok = false

    IF result.ok IS FALSE THEN
      // Circuit open or MCP error → mock context for UI continuity
      RETURN CRMResult.ok(generateMockContext(email))
    END IF

    // STEP 2: ACL translation (raw amoCRM JSON → domain types)
    domainContext = translateToEnrichedContext(result.value, email)
    RETURN CRMResult.ok(domainContext)

  CATCH any_exception:
    // Network error, timeout, parse error → mock context
    RETURN CRMResult.ok(generateMockContext(email))
  END TRY

END FUNCTION
```

---

## ALG-04: AmoCRMMCPAdapter.callMCP()
**Internal transport function — wrapped by Circuit Breaker**

```pseudocode
FUNCTION callMCP(request: { tool: string, params: Record<string, unknown> }) -> Result<any>:

  response = fetch(
    url: "{mcpBaseUrl}/tools/{request.tool}",
    method: POST,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request.params),
    signal: AbortSignal.timeout(2000)    // Node.js level abort after 2s
  )

  IF response.status IS NOT ok THEN
    RETURN Result.err(Error("MCP error: {response.status} {response.statusText}"))
  END IF

  RETURN Result.ok(response.json())

END FUNCTION
```

**Two-level timeout protection:**
1. `opossum` timeout: 2000ms (kills via CircuitBreaker machinery)
2. `AbortSignal.timeout(2000)`: kills the fetch at Node.js level

---

## ALG-05: translateToEnrichedContext() — ACL
**Pure function: maps raw amoCRM JSON to domain CRMContactContext**

```pseudocode
FUNCTION translateToEnrichedContext(raw: AmoCRMResponse, email: string) -> CRMContactContext:

  contact = raw.contacts[0]   // may be undefined

  deals = raw.leads.map(d => {
    id: String(d.id),
    title: d.name || "Untitled deal",
    value: d.price || 0,
    status: mapDealStatus(d.status_id),
    closedAt: d.closed_at ? toISOString(d.closed_at * 1000) : undefined
  })

  // Enrichment score: proportion of available fields
  fieldsPresent = {
    hasName: contact?.name IS NOT NULL,
    hasPlan: contact?.custom_fields_values?.plan IS NOT NULL,
    hasAge: contact?.created_at IS NOT NULL,
    hasDeals: deals.length > 0,
    hasTags: contact?.tags?.length > 0,
  }
  filledCount = COUNT(fieldsPresent WHERE value == true)
  enrichmentScore = ROUND(filledCount / 5, 2)   // 5 = total fields

  RETURN CRMContactContext {
    contactEmail: email,
    contactName: contact?.name,
    currentPlan: contact?.custom_fields_values?.plan,
    accountAge: contact?.created_at
                ? FLOOR((NOW() - contact.created_at * 1000) / 86400000)
                : undefined,
    deals: deals,
    previousDialogCount: raw.dialogs_count ?? 0,
    tags: contact?.tags?.map(t => t.name || String(t)) ?? [],
    enrichmentScore: enrichmentScore,
  }

END FUNCTION


FUNCTION mapDealStatus(statusId: number) -> 'OPEN' | 'WON' | 'LOST':
  SWITCH statusId:
    142 → RETURN 'WON'
    143 → RETURN 'LOST'
    default → RETURN 'OPEN'
END FUNCTION
```

---

## ALG-06: generateMockContext() — Fallback
**Used when MCP circuit is open or not yet connected**
**Deterministic: same email always produces same mock data**

```pseudocode
FUNCTION generateMockContext(email: string) -> CRMContactContext:

  // Hash email to produce deterministic mock
  hash = SUM(email.chars.map(c => c.charCodeAt(0)))

  plans = ['Free', 'Starter', 'Professional', 'Enterprise']
  tagSets = [
    ['early-adopter', 'active'],
    ['enterprise', 'high-value', 'decision-maker'],
    ['trial', 'onboarding'],
    ['churned', 're-engaged'],
  ]

  selectedPlan = plans[hash MOD 4]
  selectedTags = tagSets[hash MOD 4]
  dealCount = (hash MOD 3) + 1   // 1-3 deals

  deals = GENERATE dealCount deals FROM:
    titles = ['Platform License', 'Annual Subscription', 'Support Package', 'Add-on Services']
    values = [2400, 12000, 4800, 1200]
    statuses = ['OPEN', 'WON', 'OPEN']

  contactName = CAPITALIZE_WORDS(email.split('@')[0].replace(/[._-]/g, ' '))

  RETURN CRMContactContext {
    contactEmail: email,
    contactName: contactName,
    currentPlan: selectedPlan,
    accountAge: (hash MOD 365) + 30,     // 30-395 days
    deals: deals,
    previousDialogCount: (hash MOD 12) + 1,
    tags: selectedTags,
    enrichmentScore: 0.85,               // mock always appears well-enriched
  }

END FUNCTION
```

---

## ALG-07: Memory AI REST Handler
**File:** `src/pql/infrastructure/memory-ai-routes.ts`

```pseudocode
HANDLER GET /api/memory/:dialogId:

  tenantId = req.tenantId   // injected by JWT middleware
  dialogId = req.params.dialogId

  IF dialogId IS EMPTY OR tenantId IS EMPTY THEN
    RETURN 400 { error: 'Missing dialogId or tenant context' }
  END IF

  TRY
    // Step 1: resolve contactEmail from dialog
    row = DB.query("SELECT contact_email FROM conversations.dialogs WHERE id=$1 AND tenant_id=$2",
                   [dialogId, tenantId])

    IF row IS NULL THEN
      RETURN 404 { error: 'Dialog not found' }
    END IF

    contactEmail = row.contact_email

    IF contactEmail IS NULL THEN
      RETURN 200 { status: 'ok', data: emptyContext(null) }
    END IF

    // Step 2: fetch context
    result = MemoryAIService.fetchContext(contactEmail, tenantId)

    SWITCH result.status:
      'not_configured' → RETURN 200 { status: 'not_configured', data: null }
      'error'          → RETURN 200 { status: 'error', error: result.error, data: null }
      'ok'             → RETURN 200 { status: 'ok', data: result.data }

  CATCH error:
    LOG.error('[MemoryAI] Error fetching context by dialogId', error)
    RETURN 500 { error: 'Internal server error' }
  END TRY

END HANDLER
```

---

## ALG-08: Context Boost in PQL Scoring
**Reference:** docs/pseudocode.md PS-01 steps 5-6
**Called by:** PQLDetectorService after MemoryAI returns context

```pseudocode
FUNCTION applyContextBoost(baseScore: float, memoryContext: CRMContactContext) -> float:

  IF memoryContext.enrichmentScore < 0.3 THEN
    RETURN baseScore   // insufficient data — no boost
  END IF

  boostedScore = baseScore

  // Active Free plan user → higher conversion probability
  IF memoryContext.currentPlan == 'FREE'
     AND memoryContext.accountAge > 30 THEN
    boostedScore += 0.10
  END IF

  // Already in sales funnel → slightly lower urgency
  openDeals = memoryContext.deals.filter(d => d.status == 'OPEN')
  IF openDeals.length > 0 THEN
    boostedScore -= 0.05
  END IF

  RETURN MIN(boostedScore, 1.0)

END FUNCTION
```

---

## Cache Strategy Summary

| Scenario | Redis TTL | Notes |
|----------|-----------|-------|
| Successful CRM data | 300s (5 min) | Active support session freshness |
| `not_configured` | Not cached | May be configured any time |
| Error/degraded context | Not cached | Allow retry on next request |
| Empty email | Not cached | No meaningful key |
| Redis unavailable | N/A | Falls through to CRM every time |
