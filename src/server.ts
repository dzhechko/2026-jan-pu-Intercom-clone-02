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

// Auth middleware for all /api routes (except health)
app.use('/api', createTenantMiddleware(pool))

// TODO: Mount BC routers
// app.use('/api/dialogs', dialogRouter)
// app.use('/api/pql', pqlRouter)
// app.use('/api/revenue', revenueRouter)
// app.use('/api/operators', operatorRouter)
// app.use('/api/tenants', tenantRouter)

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

// Start server
const PORT = process.env.API_PORT || 4000
httpServer.listen(PORT, () => {
  console.log(`КоммуниК API server running on port ${PORT}`)
})

export { app, io, pool, redis }
