# Reusable Architectural & Code Patterns — КоммуниК

This document captures reusable architectural and code patterns discovered in the КоммуниК codebase. These patterns are NOT domain-specific and can be applied to other distributed monolith projects.

---

## 1. Result Type for Error Handling

**Name:** Result Type / Railway-Oriented Programming

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/shared/types/result.ts:1-16`

**Description:** Discriminated union type that encodes success/failure as a variant, enabling explicit error handling without exceptions in infrastructure layers.

**Reusability:** HIGH

**Why reusable:**
- Language-agnostic pattern (works in TypeScript, Rust, Haskell, etc.)
- Eliminates try-catch boilerplate for expected failures (MCP calls, external APIs)
- Composable: can chain operations with `.map()` or custom combinators
- Particularly useful for adapter layers that interact with fallible external systems

**Implementation:**
```typescript
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E }

export function ok<T>(value: T): Result<T, never> { /* ... */ }
export function err<E>(error: E): Result<never, E> { /* ... */ }
```

**Usage Example (MCP Adapter):**
```typescript
async getContactContext(email: string, tenantId: string): Promise<Result<ContactContext>> {
  try {
    const result = await this.breaker.fire({ /* ... */ })
    if (!result.ok) return result
    return ok({ /* transformed data */ })
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}
```

---

## 2. Domain Exception Base Class

**Name:** Domain Exception with Code

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/shared/types/domain-exception.ts:1-13`

**Description:** Typed exception class for domain rule violations, encoding business errors as classes with both a machine-readable code and human message.

**Reusability:** MEDIUM

**Why reusable:**
- Standardizes exception format across all bounded contexts
- Enables error recovery and user-facing error translation
- Separates exception handling from domain logic
- Codes allow client code to branch on specific error categories

**Implementation:**
```typescript
export class DomainException extends Error {
  constructor(
    public readonly code: string,  // e.g., 'INVALID_PQL_SCORE', 'DIALOG_NOT_FOUND'
    message: string,
  ) {
    super(message)
    this.name = 'DomainException'
  }
}
```

---

## 3. Row Mapper Pattern for Repository Deserialization

**Name:** Row Mapper / Hydrator

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/conversation/infrastructure/repositories/dialog-repository.ts:13-28`

**Description:** Pure function that transforms raw database rows into typed domain aggregates, decoupling schema from domain model.

**Reusability:** HIGH

**Why reusable:**
- Eliminates repeated JSON.parse/type coercion across repositories
- Single source of truth for schema-to-domain mapping
- Easy to test: pure function with no side effects
- Handles type conversions (timestamps, enums, nullable fields consistently)

**Implementation:**
```typescript
function rowToDialog(row: Record<string, unknown>): Dialog {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    channelType: row.channel_type as Dialog['channelType'],
    pqlScore: row.pql_score != null ? Number(row.pql_score) : undefined,
    pqlTier: row.pql_tier as PQLTier | undefined,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}
```

**Usage:**
```typescript
async findById(id: string): Promise<Dialog | null> {
  const { rows } = await this.pool.query('SELECT * FROM conversations.dialogs WHERE id = $1', [id])
  return rows.length ? rowToDialog(rows[0]) : null
}
```

---

## 4. Tenant Isolation Middleware (RLS Context Setter)

**Name:** Row-Level Security (RLS) Context Middleware

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/shared/middleware/tenant.middleware.ts:1-62`

**Description:** Express middleware that extracts tenant ID from JWT token and sets PostgreSQL RLS context via `SET app.tenant_id`, ensuring all downstream queries are filtered by tenant.

**Reusability:** HIGH

**Why reusable:**
- Enforces hard architectural boundary: tenant ID cannot be passed as a WHERE clause filter
- Works with any JWT-based auth system
- Pairs with PostgreSQL RLS policies for defense-in-depth multi-tenancy
- Transparent to downstream code: RLS filtering happens at DB layer, not application layer

**Key Pattern:**
```typescript
export interface TenantRequest extends Request {
  tenantId: string
  operatorId: string
  role: 'ADMIN' | 'OPERATOR'
  dbClient: PoolClient  // Dedicated connection for this request's RLS context
}

export function createTenantMiddleware(pool: Pool) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = /* extract from Authorization header */
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload

    const client = await pool.connect()
    await client.query(`SET app.tenant_id = '${payload.tenantId}'`)

    res.on('close', () => client.release())  // Cleanup on response finish

    const tenantReq = req as TenantRequest
    tenantReq.dbClient = client
    next()
  }
}
```

**Why it's valuable:** Prevents accidental tenant data leakage. Even if a developer forgets to filter by tenant_id, PostgreSQL RLS policies still enforce isolation.

---

## 5. AES-256-GCM Encryption for Secrets

**Name:** Authenticated Encryption for Storage

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/shared/utils/encryption.ts:1-62`

**Description:** Utility for AES-256-GCM encryption/decryption of API keys stored in database, with IV and auth tag managed separately.

**Reusability:** HIGH

**Why reusable:**
- Encrypts PII and credentials in database without external secrets service
- AES-256-GCM provides both confidentiality and authenticity
- Encryption key comes from environment (never in DB)
- Pattern applicable to any system storing encrypted secrets

**Implementation:**
```typescript
const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

export interface EncryptedValue {
  encrypted: string  // base64
  iv: string         // base64
  authTag: string    // base64
}

export function encrypt(plaintext: string): EncryptedValue {
  const key = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex')
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  }
}
```

---

## 6. Domain Events as Shared Kernel

**Name:** Domain Event Types / Cross-BC Communication

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/shared/events/domain-events.ts:1-117`

**Description:** Centralized domain event types that are the ONLY imports allowed across bounded context boundaries.

**Reusability:** HIGH

**Why reusable:**
- Decouples BCs through events, not shared code
- Base event interface enforces immutability and tenant context
- Union type enables exhaustive pattern matching in consumers
- Follows Event Sourcing and CQRS patterns

**Pattern:**
```typescript
export interface DomainEvent {
  readonly eventId: string
  readonly occurredAt: Date
  readonly tenantId: string
}

export interface MessageReceived extends DomainEvent {
  readonly type: 'MessageReceived'
  readonly dialogId: string
  readonly messageId: string
  readonly content: string
  readonly contactEmail: string | null
  readonly channelType: 'WEB_CHAT' | 'TELEGRAM' | 'VK_MAX'
}

// Union of all events — enables exhaustive handling
export type KommuniqEvent =
  | DialogStarted
  | MessageReceived
  | DialogAssigned
  | PQLDetected
  | RevenueAttributed
  | /* ... other events */
```

**Usage:** Each BC publishes only its events; other BCs subscribe via event handlers (async via Socket.io or Redis Streams).

---

## 7. Anti-Corruption Layer + Circuit Breaker Pattern

**Name:** MCP Adapter with Circuit Breaker & Type Translation

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/integration/adapters/amocrm-mcp-adapter.ts:1-245`

**Description:** Wraps external MCP server calls with circuit breaker + automatic type translation from external protocol to domain types.

**Reusability:** HIGH

**Why reusable:**
- Protects against cascading failures when external service is slow/down
- Prevents domain layer from knowing about external service types
- Graceful degradation: returns mock data instead of throwing
- Timeout enforcement (2000ms) prevents hanging requests

**Key Components:**

1. **Circuit Breaker Setup:**
```typescript
this.breaker = new CircuitBreaker(this.callMCP.bind(this), {
  timeout: 2000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  rollingCountTimeout: 10000,
})

this.breaker.fallback(() => ({
  ok: false,
  error: new Error('amoCRM MCP circuit open — unavailable'),
}))
```

2. **Type Translation (ACL):**
```typescript
// Translate MCP response → domain types
const raw = result.value
return ok({
  contacts: (raw.contacts || []).map((c: any) => ({
    id: String(c.id),
    name: c.name || '',
    email: c.email || email,
    customFields: c.custom_fields_values || {},
  })),
  deals: (raw.leads || []).map((d: any) => ({
    id: String(d.id),
    status: this.mapDealStatus(d.status_id),
    value: d.price || 0,
    createdAt: new Date(d.created_at * 1000),
  })),
  // ...
})
```

3. **Fallback Graceful Degradation:**
```typescript
async getContactContextEnriched(email: string, tenantId: string): Promise<CRMResult<CRMContactContext>> {
  try {
    const result = await this.breaker.fire({ /* ... */ })
    if (!result.ok) {
      return CRMResult.ok(this.generateMockContext(email))  // Fallback to mock
    }
    return CRMResult.ok(this.translateToEnrichedContext(raw, email))
  } catch {
    return CRMResult.ok(this.generateMockContext(email))  // Graceful degradation
  }
}
```

---

## 8. Port/Adapter Architecture for Dependency Inversion

**Name:** Port Interface + Adapter Implementation

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/pql/domain/ports/crm-port.ts:1-77`

**Description:** Domain layer defines Port (interface) for external dependency; infrastructure layer implements Adapter (concrete class).

**Reusability:** HIGH

**Why reusable:**
- Domain code depends on abstractions, not concrete implementations
- Easy to swap adapters (testing vs. production)
- Enforces unidirectional dependency: domain → port ← adapter

**Implementation:**
```typescript
// Domain Port (in BC-02 PQL)
export interface CRMPort {
  getContactContext(email: string, tenantId: string): Promise<Result<ContactContext>>
  getContactContextEnriched(email: string, tenantId: string): Promise<CRMResult<CRMContactContext>>
  createDeal(tenantId: string, contactEmail: string, title: string): Promise<Result<{ dealId: string }>>
  findDealByDialogContext(tenantId: string, contactEmail: string, afterDate: Date, beforeDate: Date): Promise<Result<CRMDeal | null>>
}

// Infrastructure Adapter (in BC-04 Integration)
export class AmoCRMMCPAdapter implements CRMPort {
  async getContactContext(email: string, tenantId: string): Promise<Result<ContactContext>> {
    // Implementation with circuit breaker
  }
  // ... implement all interface methods
}
```

**Usage in Domain Service:**
```typescript
export class MemoryAIService {
  constructor(private crmPort: CRMPort) {}  // Depends on port, not adapter

  async enrichOperatorContext(email: string, tenantId: string) {
    return this.crmPort.getContactContextEnriched(email, tenantId)
  }
}
```

---

## 9. WebSocket Namespace-Based Room Strategy

**Name:** Socket.io Multi-Tenant Room Broadcasting

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/conversation/infrastructure/ws-handler.ts:1-250`

**Description:** Uses Socket.io room naming convention to broadcast messages to specific tenants and dialogs without hardcoding room logic.

**Reusability:** MEDIUM-HIGH

**Why reusable:**
- Scalable to thousands of concurrent connections
- Room names encode context: `tenant:{tenantId}`, `dialog:{dialogId}`, `operator:{operatorId}`
- Works with Socket.io's Redis adapter for multi-server deployments
- No custom message routing logic needed

**Room Strategy:**
```typescript
// Operators join tenant broadcast room
if (tenantId && operatorId) {
  socket.join(`tenant:${tenantId}`)
  socket.join(`operator:${operatorId}`)
}

// Clients join dialog-specific room
if (dialogId) {
  socket.join(`dialog:${dialogId}`)
}

// Broadcast new message to all operators watching this tenant
nsp.to(`tenant:${tenantId}`).emit('message:new', { message, dialog })

// Deliver to widget (client room)
nsp.to(`dialog:${dialogId}`).emit('message:new', { message })
```

---

## 10. Inline Event Analysis (Non-Blocking PQL Detection)

**Name:** Inline Async Processing without Event Queue

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/pql/infrastructure/message-consumer.ts:70-100`

**Description:** Triggers async analysis (PQL detection) inline without waiting for completion, avoiding blocking WebSocket message handling.

**Reusability:** HIGH

**Why reusable:**
- Decouples message persistence from PQL detection
- Uses `.catch()` for non-blocking error handling
- Scales without needing a separate message queue (vs. Redis Streams)
- Works well for latency-tolerant operations like ML inference

**Pattern:**
```typescript
// In ws-handler.ts after saving a message
if (pqlDetector) {
  const pqlEvent: MessageEvent = {
    messageId: message.id,
    dialogId: dialog.id,
    tenantId,
    content,
    senderType: 'CLIENT',
  }
  // Fire and forget — don't wait for result
  analyzePQLInline(pqlDetector, nsp, pqlEvent, notificationService).catch((err) =>
    console.error('[ws-handler] PQL analysis error', err),
  )
}
```

**Benefits:** Message is confirmed to client immediately; PQL detection happens asynchronously.

---

## 11. Input Validation with Zod Schemas

**Name:** Declarative API Input Validation

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/iam/application/services/auth-service.ts:31-49`

**Description:** Uses zod schemas for type-safe, declarative validation of API inputs with human-readable error messages.

**Reusability:** HIGH

**Why reusable:**
- Single schema definition for validation + TypeScript type inference
- Composable: can reuse schemas across handlers
- Rich error messages for client feedback
- Prevents invalid data from entering domain layer

**Implementation:**
```typescript
export const RegisterSchema = z.object({
  tenantName: z.string().min(2).max(255),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  name: z.string().min(2).max(255),
})

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

// Usage in handler
async register(input: z.infer<typeof RegisterSchema>): Promise<Result<RegisterResult, Error>> {
  const parsed = RegisterSchema.safeParse(input)
  if (!parsed.success) {
    return err(new Error(parsed.error.issues.map((i) => i.message).join('; ')))
  }
  const { tenantName, email, password, name } = parsed.data
  // ... proceed with validated data, guaranteed to be correct type
}
```

---

## 12. Transactional Wrapper Pattern

**Name:** Database Transaction with Automatic Rollback

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/iam/application/services/auth-service.ts:79-118`

**Description:** Wraps multi-step DB operations (register: create tenant + create operator) in a transaction with cleanup.

**Reusability:** HIGH

**Why reusable:**
- Ensures atomicity: either both writes succeed or neither
- Automatic rollback on error
- Proper resource cleanup in `finally` block
- Works with any pg Pool

**Pattern:**
```typescript
async register(input: z.infer<typeof RegisterSchema>): Promise<Result<RegisterResult, Error>> {
  const parsed = RegisterSchema.safeParse(input)
  if (!parsed.success) return err(/* ... */)

  const { tenantName, email, password, name } = parsed.data
  const client = await this.pool.connect()

  try {
    await client.query('BEGIN')

    const tenantResult = await this.tenantRepo.create(
      { name: tenantName, billingEmail: email },
      client,
    )
    if (!tenantResult.ok) throw tenantResult.error

    const tenant = tenantResult.value
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

    const operatorResult = await this.operatorRepo.create(
      { tenantId: tenant.id, email, name, passwordHash, role: 'ADMIN' },
      client,
    )
    if (!operatorResult.ok) throw operatorResult.error

    await client.query('COMMIT')
    const operator = operatorResult.value
    const token = this.issueToken(operator)
    return ok({ tenant, operator, token })
  } catch (e) {
    await client.query('ROLLBACK')
    return err(e instanceof Error ? e : new Error(String(e)))
  } finally {
    client.release()
  }
}
```

---

## 13. Server Composition & Dependency Injection

**Name:** Factory-Based Service Composition

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/server.ts:1-235`

**Description:** Express server composes all services, adapters, and routes at startup, using injected singletons and factory functions.

**Reusability:** HIGH

**Why reusable:**
- Explicit dependency graph at server startup (easy to understand what's being wired)
- Singleton services shared across all requests
- No service locator or global state
- Easy to replace implementations for testing

**Pattern:**
```typescript
// Singleton services
const telegramBotService = TelegramBotService.fromEnv()
const vkMaxMCPService = VKMaxMCPService.fromEnv()

// Factory: repositories
const attributionRepo = new PgAttributionRepository(pool)
const pqlDetectionRepo = new PgPQLDetectionRepository(pool)
const dialogRepo = new DialogRepository(pool)

// Factory: domain services
const mlModelService = new MLModelService(mlModelRepo)
const pqlDetector = new PQLDetectorService(pqlDetectionRepo, dialogRepo, mlModelService)
const crmAdapter = new AmoCRMMCPAdapter(process.env.AMOCRM_MCP_URL || '')
const memoryAIService = new MemoryAIService(crmAdapter, redis)

// Wire routes with dependencies
app.use('/api/pql', createPQLRouter(pool))
app.use('/api/memory', createMemoryAIRouter(pool, memoryAIService))

// Wire Socket.io namespaces
const chatNsp = registerChatNamespace(io, pool, pqlDetector, notificationService)
registerTelegramOutbound(io, pool, telegramBotService)
```

**Benefits:**
- Single place where all wiring happens
- Easy to swap implementations (test mocks, alternative providers)
- No implicit dependencies or surprises

---

## 14. Multi-Adapter Channel Pattern

**Name:** Channel-Agnostic Message Handling

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/integration/adapters/telegram-adapter.ts:1-162`

**Description:** Adapter wraps channel-specific protocol (Telegram webhook format) and translates to domain model (Dialog, Message).

**Reusability:** HIGH

**Why reusable:**
- Works for any channel (Telegram, VK Max, Email, SMS, etc.)
- Each channel adapter maps to same Dialog + Message domain model
- No domain code knows about channel-specific types
- Easy to add new channels without changing core system

**Pattern:**
```typescript
export class TelegramAdapter {
  async handleUpdate(update: TelegramUpdate): Promise<boolean> {
    if (update.message?.text) {
      await this.handleIncomingMessage(update.message)
      return true
    }
    if (update.callback_query?.data) {
      // Synthesize as text message
      const syntheticMessage: TelegramMessage = {
        message_id: 0,
        from: update.callback_query.from,
        chat: update.callback_query.message?.chat ?? { /* ... */ },
        date: Math.floor(Date.now() / 1000),
        text: update.callback_query.data,
      }
      await this.handleIncomingMessage(syntheticMessage)
      return true
    }
    return false
  }

  private async handleIncomingMessage(tgMessage: TelegramMessage): Promise<void> {
    // Create/find dialog
    let dialog = await this.dialogRepo.findByExternalId(this.tenantId, chatId)
    if (!dialog) {
      dialog = await this.dialogRepo.create({
        tenantId: this.tenantId,
        channelType: 'TELEGRAM',
        externalChannelId: chatId,
        metadata: { /* ... */ },
      })
    }

    // Save message in domain model
    const message = await this.messageRepo.create({
      dialogId: dialog.id,
      tenantId: this.tenantId,
      direction: 'INBOUND',
      senderType: 'CLIENT',
      content: text,
    })

    // Broadcast via Socket.io (generic)
    this.io.of('/chat').to(`tenant:${this.tenantId}`).emit('message:new', { message, dialog })
  }
}
```

---

## 15. Mock Data Generation for Graceful Degradation

**Name:** Deterministic Mock Data Generator

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/integration/adapters/amocrm-mcp-adapter.ts:186-222`

**Description:** Generates consistent mock data based on input hash when external service is unavailable, allowing UI to display realistic data without real service.

**Reusability:** MEDIUM

**Why reusable:**
- Enables development without external service dependency
- Consistent across restarts (deterministic hash)
- Demonstrates UI layouts before real data integration
- Useful for testing fallback behavior

**Pattern:**
```typescript
private generateMockContext(email: string): CRMContactContext {
  // Deterministic mock based on email hash for consistency
  const hash = email.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const plans = ['Free', 'Starter', 'Professional', 'Enterprise']
  const tagSets = [
    ['early-adopter', 'active'],
    ['enterprise', 'high-value', 'decision-maker'],
    ['trial', 'onboarding'],
    ['churned', 're-engaged'],
  ]

  const planIndex = hash % plans.length
  const tagIndex = hash % tagSets.length
  const dealCount = (hash % 3) + 1
  const deals = Array.from({ length: dealCount }, (_, i) => ({
    id: `mock-deal-${hash}-${i}`,
    title: ['Platform License', 'Annual Subscription', 'Support Package', 'Add-on Services'][i % 4],
    value: [2400, 12000, 4800, 1200][i % 4],
    status: ['OPEN', 'WON', 'OPEN'][i % 3],
    closedAt: i === 1 ? new Date(Date.now() - 30 * 86400000).toISOString() : undefined,
  }))

  return {
    contactEmail: email,
    contactName: email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    currentPlan: plans[planIndex],
    accountAge: (hash % 365) + 30,
    deals,
    previousDialogCount: (hash % 12) + 1,
    tags: tagSets[tagIndex],
    enrichmentScore: 0.85,
  }
}
```

---

## 16. Mock Repository Pattern for Testing

**Name:** Jest Mock Factories

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/pql/application/services/pql-detector-service.test.ts:9-34`

**Description:** Factory functions that create jest.Mocked instances of repository interfaces, enabling easy test setup.

**Reusability:** HIGH

**Why reusable:**
- Consistent mock setup across all test suites
- Single place to update when interface changes
- Decouples test logic from mock implementation

**Pattern:**
```typescript
function createMockDetectionRepo(): jest.Mocked<PQLDetectionRepository> {
  return {
    save: jest.fn().mockImplementation(async (d: PQLDetection) => d),
    findByDialogId: jest.fn().mockResolvedValue([]),
    findByTenantId: jest.fn().mockResolvedValue([]),
  }
}

function createMockDialogUpdater(): jest.Mocked<DialogPQLUpdater> {
  return {
    updatePQLScore: jest.fn().mockResolvedValue(null),
  }
}

function createMessageEvent(overrides: Partial<MessageEvent> = {}): MessageEvent {
  return {
    messageId: 'msg-001',
    dialogId: 'dlg-001',
    tenantId: 'tenant-001',
    content: 'Hello, just browsing',
    senderType: 'CLIENT',
    ...overrides,
  }
}

// Usage
describe('PQLDetectorService', () => {
  let service: PQLDetectorService
  let detectionRepo: jest.Mocked<PQLDetectionRepository>

  beforeEach(() => {
    detectionRepo = createMockDetectionRepo()
    service = new PQLDetectorService(detectionRepo, /* ... */)
  })

  it('should detect PQL signals', async () => {
    const event = createMessageEvent({ content: 'Хотим оформить договор' })
    const result = await service.analyze(event)
    expect(result).not.toBeNull()
    expect(detectionRepo.save).toHaveBeenCalled()
  })
})
```

---

## 17. Value Object Pattern

**Name:** Immutable Value Objects with Factory Functions

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/pql/domain/value-objects/pql-score.ts:1-18`

**Description:** Immutable data structures with factory functions for deriving values (e.g., tier from score).

**Reusability:** HIGH

**Why reusable:**
- No setters = no accidental mutations
- Factory functions encode business rules (e.g., score >= 0.80 → HOT)
- Composable: can nest value objects in aggregates
- Language-agnostic (works in any OOP language)

**Pattern:**
```typescript
export type PQLTier = 'HOT' | 'WARM' | 'COLD'

export interface PQLScore {
  readonly value: number       // 0.0 – 1.0
  readonly tier: PQLTier
  readonly topSignals: Array<{ type: string; weight: number }>
}

export function calculateTier(score: number): PQLTier {
  if (score >= 0.80) return 'HOT'
  if (score >= 0.65) return 'WARM'
  return 'COLD'
}
```

---

## 18. Service Layer with Result Types

**Name:** Application Service using Result Types

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/iam/application/services/auth-service.ts:66-200`

**Description:** Application service methods return `Result` types, allowing callers to handle both success and failure paths.

**Reusability:** HIGH

**Why reusable:**
- Consistent error handling across all services
- No exception-based control flow
- Easy to propagate errors up the call stack
- Works well with async/await

**Pattern:**
```typescript
export class AuthService {
  async register(input: z.infer<typeof RegisterSchema>): Promise<Result<RegisterResult, Error>> {
    const parsed = RegisterSchema.safeParse(input)
    if (!parsed.success) {
      return err(new Error(/* ... */))
    }
    // ... proceed with transaction
    return ok({ tenant, operator, token })
  }

  async login(input: z.infer<typeof LoginSchema>): Promise<Result<LoginResult, Error>> {
    const parsed = LoginSchema.safeParse(input)
    if (!parsed.success) {
      return err(new Error(/* ... */))
    }
    // ... authenticate
    return ok({ operator, token })
  }
}
```

---

## 19. Registry Pattern for Event Handlers

**Name:** Handler Registration & Wiring

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/pql/infrastructure/message-consumer.ts:15-64`

**Description:** Function that registers event handlers on a namespace, injecting dependencies explicitly.

**Reusability:** HIGH

**Why reusable:**
- Decouples event definitions from handlers
- Easy to enable/disable handlers per environment
- Works with any event bus (Socket.io, Redis Streams, RabbitMQ)
- Injection of dependencies is explicit

**Pattern:**
```typescript
export interface PQLMessageConsumerDeps {
  chatNamespace: Namespace
  pqlDetector: PQLDetectorService
  notificationService?: NotificationService
}

export function registerPQLConsumer({ chatNamespace, pqlDetector, notificationService }: PQLMessageConsumerDeps): void {
  chatNamespace.on('connection', (socket) => {
    socket.on('pql:analyze', async (payload: unknown) => {
      try {
        const event = payload as MessageEvent
        if (!event.messageId || !event.dialogId || !event.tenantId || !event.content) {
          return
        }

        const detection = await pqlDetector.analyze(event)

        if (detection) {
          chatNamespace.to(`tenant:${event.tenantId}`).emit('pql:detected', {
            detectionId: detection.id,
            dialogId: detection.dialogId,
            tenantId: detection.tenantId,
            score: detection.score,
            tier: detection.tier,
            topSignals: detection.topSignals,
          })

          if (notificationService) {
            await triggerPQLNotification(notificationService, detection)
          }
        }
      } catch (err) {
        console.error('[pql-consumer] analysis error', err)
      }
    })
  })
}
```

---

## 20. Adapter Registration Pattern for Outbound Channels

**Name:** Outbound Adapter Registration

**File:** `/workspaces/2026-jan-pu-Intercom-clone-02/src/integration/adapters/telegram-outbound.ts:16-78`

**Description:** Function that registers outbound handlers, allowing one-way push to external systems (e.g., forward operator message to Telegram).

**Reusability:** HIGH

**Why reusable:**
- Separates inbound webhooks from outbound pushes
- Can be registered in server.ts alongside other integrations
- Works with any external channel (SMS, Email, etc.)
- Fire-and-forget pattern reduces latency

**Pattern:**
```typescript
export function registerTelegramOutbound(
  io: SocketIOServer,
  pool: Pool,
  botService?: TelegramBotService | null,
): void {
  const chatNsp = io.of('/chat')
  const dialogRepo = new DialogRepository(pool)

  chatNsp.use((socket, next) => {
    socket.on('operator:message:telegram', async (payload: {
      dialogId: string
      content: string
    }) => {
      try {
        const dialog = await dialogRepo.findById(payload.dialogId)
        if (!dialog || dialog.channelType !== 'TELEGRAM') return

        if (!botService) {
          console.error('[telegram-outbound] TelegramBotService not configured')
          return
        }

        await botService.sendMessage(dialog.externalChannelId, payload.content)
      } catch (err) {
        console.error('[telegram-outbound] Failed to forward message to Telegram:', err)
      }
    })

    next()
  })
}

// Also provide standalone function for use in REST routes
export async function forwardToTelegramIfNeeded(
  pool: Pool,
  dialogId: string,
  content: string,
  botService?: TelegramBotService | null,
): Promise<void> {
  const dialogRepo = new DialogRepository(pool)
  const dialog = await dialogRepo.findById(dialogId)

  if (!dialog || dialog.channelType !== 'TELEGRAM') return

  if (!botService) {
    console.error('[telegram-outbound] TelegramBotService not configured')
    return
  }

  const result = await botService.sendMessage(dialog.externalChannelId, content)
  if (!result.ok) {
    console.error('[telegram-outbound] Telegram API error:', result.description)
  }
}
```

---

## Summary Table

| # | Pattern Name | File | Reusability | Best For |
|---|---|---|---|---|
| 1 | Result Type | shared/types/result.ts | HIGH | Error handling without exceptions |
| 2 | Domain Exception | shared/types/domain-exception.ts | MEDIUM | Domain rule violations |
| 3 | Row Mapper | conversation/repositories/dialog-repository.ts | HIGH | DB deserialization |
| 4 | RLS Middleware | shared/middleware/tenant.middleware.ts | HIGH | Multi-tenancy isolation |
| 5 | AES-256-GCM Encryption | shared/utils/encryption.ts | HIGH | Secrets in DB |
| 6 | Domain Events | shared/events/domain-events.ts | HIGH | Cross-BC communication |
| 7 | MCP Adapter + Circuit Breaker | integration/adapters/amocrm-mcp-adapter.ts | HIGH | External service resilience |
| 8 | Port/Adapter | pql/domain/ports/crm-port.ts | HIGH | Dependency inversion |
| 9 | Socket.io Room Strategy | conversation/infrastructure/ws-handler.ts | MEDIUM-HIGH | Real-time broadcasting |
| 10 | Inline Async Processing | pql/infrastructure/message-consumer.ts | HIGH | Non-blocking analysis |
| 11 | Zod Input Validation | iam/services/auth-service.ts | HIGH | API input validation |
| 12 | Transactional Wrapper | iam/services/auth-service.ts | HIGH | Multi-step atomicity |
| 13 | Server Composition | server.ts | HIGH | DI + singleton wiring |
| 14 | Multi-Adapter Channel | integration/adapters/telegram-adapter.ts | HIGH | Channel-agnostic handling |
| 15 | Mock Data Generator | integration/adapters/amocrm-mcp-adapter.ts | MEDIUM | Graceful degradation |
| 16 | Mock Repository Factory | pql/services/pql-detector-service.test.ts | HIGH | Test setup |
| 17 | Value Object | pql/value-objects/pql-score.ts | HIGH | Immutable domain data |
| 18 | Service with Result Types | iam/services/auth-service.ts | HIGH | Application logic |
| 19 | Handler Registration | pql/infrastructure/message-consumer.ts | HIGH | Event handler wiring |
| 20 | Outbound Adapter | integration/adapters/telegram-outbound.ts | HIGH | Push to external systems |

---

## Key Takeaways for Reuse

1. **Error Handling:** Result types eliminate try-catch boilerplate while maintaining explicitness
2. **Multi-Tenancy:** RLS middleware + encryption utilities form a complete isolation strategy
3. **Resilience:** Circuit breaker + anti-corruption layer protect against external service failures
4. **Communication:** Domain events + Socket.io rooms scale to multi-server deployments
5. **Dependency Inversion:** Ports + adapters decouple domain from infrastructure
6. **Testing:** Mock factories + value objects make tests concise and maintainable
7. **Composition:** Server wiring pattern centralizes all dependencies for clarity

All patterns follow **Domain-Driven Design** principles and are suitable for monolith-to-microservice evolution.
