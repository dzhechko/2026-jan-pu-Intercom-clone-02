/**
 * КоммуниК Worker — Cron jobs and background processing.
 * Reference: docs/pseudocode.md PS-05 (Revenue Report generation)
 */
import { CronJob } from 'cron'
import { Pool } from 'pg'
import Redis from 'ioredis'
import { createRevenueReportService } from '@revenue/infrastructure/revenue-routes'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')

// FR-06: Revenue Report Service instance for cron
const revenueReportService = createRevenueReportService(pool)

// Revenue Report — 1st of every month at 09:00 (PS-05)
const revenueReportCron = new CronJob(
  '0 9 1 * *',
  async () => {
    console.log('[Worker] Starting monthly Revenue Report generation...')
    try {
      const result = await revenueReportService.generateMonthlyReports()
      console.log(`[Worker] Revenue Reports: ${result.generated} generated, ${result.errors.length} errors`)
      if (result.errors.length > 0) {
        console.error('[Worker] Revenue Report errors:', result.errors)
      }
    } catch (error) {
      console.error('[Worker] Revenue Report generation failed:', error)
    }
  },
  null,
  false,
  'Europe/Moscow',
)

// Notification processor — every 30 seconds
const notificationCron = new CronJob(
  '*/30 * * * * *',
  async () => {
    // TODO: Process pending notifications from notifications.jobs
  },
  null,
  false,
)

// Start all cron jobs
revenueReportCron.start()
notificationCron.start()

console.log('[Worker] КоммуниК worker started')
console.log('[Worker] Revenue Report cron: 1st of month at 09:00 MSK')
console.log('[Worker] Notification processor: every 30 seconds')

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Worker] Shutting down...')
  revenueReportCron.stop()
  notificationCron.stop()
  await pool.end()
  redis.disconnect()
  process.exit(0)
})
