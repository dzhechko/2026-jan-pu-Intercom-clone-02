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
import { createChatRouter } from '@conversation/infrastructure/chat-routes'
import { registerChatNamespace } from '@conversation/infrastructure/ws-handler'
import { createPQLRouter } from '@pql/infrastructure/pql-routes'
import { PQLDetectorService } from '@pql/application/services/pql-detector-service'
import { PgPQLDetectionRepository } from '@pql/infrastructure/repositories/pql-detection-repository'
import { DialogRepository } from '@conversation/infrastructure/repositories/dialog-repository'
import { analyzePQLInline } from '@pql/infrastructure/message-consumer'
import { createTelegramWebhookRouter, createTelegramManagementRouter } from '@integration/infrastructure/telegram-routes'
import { registerTelegramOutbound } from '@integration/adapters/telegram-outbound'
import { createMemoryAIRouter } from '@pql/infrastructure/memory-ai-routes'
import { MemoryAIService } from '@pql/application/services/memory-ai-service'
import { AmoCRMMCPAdapter } from '@integration/adapters/amocrm-mcp-adapter'

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
app.use('/api/webhooks/telegram', createTelegramWebhookRouter(pool, io))

// Auth middleware for all /api routes (except health and webhooks)
app.use('/api', createTenantMiddleware(pool))

// BC-01: Conversation routes
app.use('/api/dialogs', createChatRouter(pool))

// BC-02: PQL detection routes
app.use('/api/pql', createPQLRouter(pool))

// FR-05: Telegram management routes (requires auth)
app.use('/api/telegram', createTelegramManagementRouter())

// FR-03: Memory AI — CRM context routes
const crmAdapter = new AmoCRMMCPAdapter(process.env.AMOCRM_MCP_URL || '')
const memoryAIService = new MemoryAIService(crmAdapter, redis)
app.use('/api/memory', createMemoryAIRouter(pool, memoryAIService))

// Socket.io namespace per tenant (ADR-005, PO-03)
io.on('connection', (socket) => {
  const { tenantId, operatorId } = socket.handshake.auth
  if (tenantId) {
    socket.join(`tenant:${tenantId}`)
    if (operatorId) {
      socket.join(`operator:${operatorId}`)
    }
  }
})

// BC-02: PQL detector service wiring
const pqlDetectionRepo = new PgPQLDetectionRepository(pool)
const dialogRepo = new DialogRepository(pool)
const pqlDetector = new PQLDetectorService(pqlDetectionRepo, dialogRepo)

// BC-01: /chat namespace — widget + operator real-time messaging
const chatNsp = registerChatNamespace(io, pool, pqlDetector)

// FR-05: Telegram outbound — intercept operator replies to TELEGRAM dialogs
registerTelegramOutbound(io, pool)

// Start server
const PORT = process.env.API_PORT || 4000
httpServer.listen(PORT, () => {
  console.log(`КоммуниК API server running on port ${PORT}`)
})

export { app, io, pool, redis }
