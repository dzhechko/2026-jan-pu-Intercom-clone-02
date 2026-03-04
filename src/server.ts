/**
 * КоммуниК API Server — Express + Socket.io
 * Reference: docs/C4-diagrams.md Container Diagram
 */
import express from 'express'
import { createServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import cors from 'cors'
import helmet from 'helmet'
import { Pool } from 'pg'
import Redis from 'ioredis'
import { createTenantMiddleware } from '@shared/middleware/tenant.middleware'
import { validateJwtSecret } from '@shared/utils/jwt-secret'
import { createChatRouter } from '@conversation/infrastructure/chat-routes'
import { registerChatNamespace } from '@conversation/infrastructure/ws-handler'
import { createPQLRouter } from '@pql/infrastructure/pql-routes'
import { createOperatorRouter } from '@iam/infrastructure/operator-routes'
import { createAssignmentRouter } from '@conversation/infrastructure/assignment-routes'
import { PresenceService } from '@iam/application/services/presence-service'
import { AssignmentService } from '@conversation/application/services/assignment-service'
import { PQLDetectorService } from '@pql/application/services/pql-detector-service'
import { MLModelService } from '@pql/application/services/ml-model-service'
import { PgMLModelRepository } from '@pql/infrastructure/repositories/ml-model-repository'
import { PgPQLDetectionRepository } from '@pql/infrastructure/repositories/pql-detection-repository'
import { DialogRepository } from '@conversation/infrastructure/repositories/dialog-repository'
import { analyzePQLInline } from '@pql/infrastructure/message-consumer'
import { TelegramBotService } from '@integration/services/telegram-bot-service'
import { VKMaxMCPService } from '@integration/services/vkmax-mcp-service'
import { createTelegramWebhookRouter, createTelegramManagementRouter } from '@integration/infrastructure/telegram-routes'
import { registerTelegramOutbound } from '@integration/adapters/telegram-outbound'
import { createVKMaxWebhookRouter, createVKMaxManagementRouter } from '@integration/infrastructure/vkmax-routes'
import { registerVKMaxOutbound } from '@integration/adapters/vkmax-outbound'
import { createMemoryAIRouter } from '@pql/infrastructure/memory-ai-routes'
import { createFeedbackRouter } from '@pql/infrastructure/feedback-routes'
import { createMLRouter } from '@pql/infrastructure/ml-routes'
import { MemoryAIService } from '@pql/application/services/memory-ai-service'
import { AmoCRMMCPAdapter } from '@integration/adapters/amocrm-mcp-adapter'
import { createNotificationRouter } from '@notifications/infrastructure/notification-routes'
import { NotificationService } from '@notifications/application/services/notification-service'
import { PgNotificationRepository } from '@notifications/infrastructure/repositories/notification-repository'
import { StubEmailService } from '@notifications/infrastructure/email-service'
import { createAnalyticsRouter } from '@revenue/infrastructure/analytics-routes'
import { createCRMWebhookRouter } from '@integration/infrastructure/crm-webhook-routes'
import { createAttributionRouter } from '@revenue/infrastructure/attribution-routes'
import { AutoAttributionService } from '@revenue/application/services/auto-attribution-service'
import { PgAttributionRepository } from '@revenue/infrastructure/repositories/attribution-repository'
import { createRevenueRouter } from '@revenue/infrastructure/revenue-routes'

// Startup guard: crash early if JWT_SECRET is missing (security requirement)
validateJwtSecret()

const app = express()
const httpServer = createServer(app)

// Socket.io with Redis adapter (ADR-005)
const io = new SocketIOServer(httpServer, {
  cors: { origin: process.env.NEXT_PUBLIC_API_URL || '*' },
  path: '/socket.io/',
})

// Database pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

// Redis client
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')

// Middleware
app.use(helmet())
app.use(cors())
app.use(express.json())

// Singleton MCP/Bot services — created once, shared across all requests (FF-04)
const telegramBotService = TelegramBotService.fromEnv()
const vkMaxMCPService = VKMaxMCPService.fromEnv()

// Health check (no auth required)
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    await redis.ping()
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
  } catch (error) {
    res.status(503).json({ status: 'error', error: String(error) })
  }
})

// FR-05: Telegram webhook — BEFORE auth middleware (Telegram sends updates directly)
app.use('/api/webhooks/telegram', createTelegramWebhookRouter(pool, io, telegramBotService))

// FR-09: VK Max webhook — BEFORE auth middleware (VK Max sends updates directly)
app.use('/api/webhooks/vkmax', createVKMaxWebhookRouter(pool, io, vkMaxMCPService))

// FR-12: amoCRM webhook — BEFORE auth middleware (amoCRM sends directly)
const attributionRepo = new PgAttributionRepository(pool)
const stubTenantLookup = {
  async findByAmoCRMAccountId(accountId: string) {
    // Stub: In production, look up tenant by amoCRM account ID in DB
    // For now, return a default tenant for development
    return accountId ? `tenant-${accountId}` : null
  },
}
const stubPQLDetectionLookup = {
  async findByContactEmail(email: string, tenantId: string) {
    // Stub: In production, query pql.detections joined with dialog contacts
    return null
  },
  async findById(detectionId: string) {
    // Stub: In production, query pql.detections by ID
    return null
  },
}
const autoAttributionService = new AutoAttributionService(
  attributionRepo,
  stubPQLDetectionLookup,
  stubTenantLookup,
  (attribution) => {
    // Emit DealAttributed event via Socket.io
    io.to(`tenant:${attribution.tenantId}`).emit('deal:attributed', {
      attributionId: attribution.id,
      dealId: attribution.dealId,
      dealValue: attribution.dealValue,
      pqlDetectionId: attribution.pqlDetectionId,
      confidence: attribution.confidence,
    })
  },
)
app.use('/api/webhooks/amocrm', createCRMWebhookRouter(pool, autoAttributionService))

// Auth middleware for all /api routes (except health and webhooks)
app.use('/api', createTenantMiddleware(pool))

// BC-01: Conversation routes
app.use('/api/dialogs', createChatRouter(pool))

// BC-02: PQL detection routes
app.use('/api/pql', createPQLRouter(pool))

// FR-10: PQL feedback + ML v1 routes
app.use('/api/pql', createFeedbackRouter(pool))
app.use('/api/pql/ml', createMLRouter(pool))

// FR-05: Telegram management routes (requires auth)
app.use('/api/telegram', createTelegramManagementRouter(telegramBotService))

// FR-09: VK Max management routes (requires auth)
app.use('/api/vkmax', createVKMaxManagementRouter(vkMaxMCPService))

// FR-13: Operator management routes
app.use('/api/operators', createOperatorRouter(pool, redis))

// FR-13: Assignment service + routes
const presenceService = new PresenceService(redis)
const assignmentService = new AssignmentService(pool, presenceService)
app.use('/api', createAssignmentRouter(pool, assignmentService))

// FR-03: Memory AI — CRM context routes
const crmAdapter = new AmoCRMMCPAdapter(process.env.AMOCRM_MCP_URL || '')
const memoryAIService = new MemoryAIService(crmAdapter, redis)
app.use('/api/memory', createMemoryAIRouter(pool, memoryAIService))

// FR-11: Notification routes
app.use('/api/notifications', createNotificationRouter(pool))

// FR-08: Analytics dashboard routes
app.use('/api/analytics', createAnalyticsRouter(pool))

// FR-06: Revenue Intelligence Report routes
app.use('/api/reports', createRevenueRouter(pool))

// FR-12: Attribution management routes (requires auth)
app.use('/api/attributions', createAttributionRouter(pool, attributionRepo, autoAttributionService))

// FR-13: Presence service for operator online/offline tracking
const serverPresenceService = new PresenceService(redis)

// Socket.io namespace per tenant (ADR-005, PO-03) + FR-13 presence tracking
io.on('connection', (socket) => {
  const { tenantId, operatorId } = socket.handshake.auth
  if (tenantId) {
    socket.join(`tenant:${tenantId}`)
    if (operatorId) {
      socket.join(`operator:${operatorId}`)
      // FR-13: Track operator presence on connect
      serverPresenceService.setOnline(operatorId, tenantId).catch((err) =>
        console.error('[server] presence setOnline error', err),
      )
      // Notify other operators about presence change
      io.to(`tenant:${tenantId}`).emit('operator:online', { operatorId })
    }
  }

  socket.on('disconnect', () => {
    const { tenantId: tid, operatorId: oid } = socket.handshake.auth
    if (tid && oid) {
      // FR-13: Track operator presence on disconnect
      serverPresenceService.setOffline(oid, tid).catch((err) =>
        console.error('[server] presence setOffline error', err),
      )
      // Notify other operators about presence change
      io.to(`tenant:${tid}`).emit('operator:offline', { operatorId: oid })
    }
  })
})

// BC-02: PQL detector service wiring (with ML v1 integration — FR-10)
const pqlDetectionRepo = new PgPQLDetectionRepository(pool)
const dialogRepo = new DialogRepository(pool)
const mlModelRepo = new PgMLModelRepository(pool)
const mlModelService = new MLModelService(mlModelRepo)
const pqlDetector = new PQLDetectorService(pqlDetectionRepo, dialogRepo, mlModelService)

// FR-11: Notification service wiring — push via Socket.io + email (stub)
const notificationRepo = new PgNotificationRepository(pool)
const emailService = new StubEmailService()
const notificationService = new NotificationService({
  notificationRepo,
  emailService,
  pushEmitter: { toRoom: (room: string) => io.to(room) },
})

// BC-01: /chat namespace — widget + operator real-time messaging
const chatNsp = registerChatNamespace(io, pool, pqlDetector, notificationService)

// FR-05: Telegram outbound — intercept operator replies to TELEGRAM dialogs
registerTelegramOutbound(io, pool, telegramBotService)

// FR-09: VK Max outbound — intercept operator replies to VK_MAX dialogs
registerVKMaxOutbound(io, pool, vkMaxMCPService)

// Start server
const PORT = process.env.API_PORT || 4000
httpServer.listen(PORT, () => {
  console.log(`КоммуниК API server running on port ${PORT}`)
})

export { app, io, pool, redis }
