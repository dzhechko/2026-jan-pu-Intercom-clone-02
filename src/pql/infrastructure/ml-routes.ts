/**
 * ML Routes — FR-10: PQL ML v1 management endpoints.
 * Mounts under /api/pql/ml (see server.ts)
 *
 * GET  /api/pql/ml/status  — training data count, model status, readiness
 * POST /api/pql/ml/train   — trigger model training (admin only)
 * GET  /api/pql/ml/metrics — model accuracy metrics
 * GET  /api/pql/ml/export  — export training data
 */
import { Router, RequestHandler } from 'express'
import { Pool } from 'pg'
import { TenantRequest } from '@shared/middleware/tenant.middleware'
import { MLTrainingService } from '@pql/application/services/ml-training-service'
import { MLModelService } from '@pql/application/services/ml-model-service'
import { PgMLModelRepository } from './repositories/ml-model-repository'

export function createMLRouter(pool: Pool): Router {
  const router = Router()
  const trainingService = new MLTrainingService(pool)
  const modelRepo = new PgMLModelRepository(pool)
  const modelService = new MLModelService(modelRepo)

  /**
   * GET /api/pql/ml/status
   * Training data readiness and model status.
   */
  const getStatus: RequestHandler = async (req, res) => {
    try {
      const { tenantId } = req as TenantRequest
      const stats = await trainingService.getTrainingStats(tenantId)
      const hasModel = await modelService.hasTrainedModel(tenantId)

      return res.json({
        trainingData: stats,
        modelReady: hasModel,
        phase: hasModel ? 'ml-v1' : 'rule-v1',
      })
    } catch (err) {
      console.error('[ml-routes] getStatus error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * POST /api/pql/ml/train
   * Trigger model training. Admin only.
   */
  const trainModel: RequestHandler = async (req, res) => {
    try {
      const { tenantId, role } = req as TenantRequest

      if (role !== 'ADMIN') {
        return res.status(403).json({ error: 'Admin access required' })
      }

      // Collect labeled feedback data
      const trainingData = await trainingService.collectTrainingData(tenantId)
      const labeledData = trainingData
        .filter((d) => d.operatorFeedback !== null)
        .map((d) => ({
          detectionId: d.detectionId,
          signals: d.signals,
          pqlScore: d.pqlScore,
          feedback: d.operatorFeedback!,
        }))

      if (labeledData.length < 1000) {
        return res.status(400).json({
          error: 'Insufficient training data',
          required: 1000,
          current: labeledData.length,
        })
      }

      const model = await modelService.trainModel(tenantId, labeledData)

      return res.json({
        message: 'Model trained successfully',
        version: model.version,
        sampleCount: model.sampleCount,
      })
    } catch (err) {
      console.error('[ml-routes] trainModel error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET /api/pql/ml/metrics
   * Model accuracy metrics.
   */
  const getMetrics: RequestHandler = async (req, res) => {
    try {
      const { tenantId } = req as TenantRequest

      const trainingData = await trainingService.collectTrainingData(tenantId)
      const labeledData = trainingData
        .filter((d) => d.operatorFeedback !== null)
        .map((d) => ({
          detectionId: d.detectionId,
          signals: d.signals,
          pqlScore: d.pqlScore,
          feedback: d.operatorFeedback!,
        }))

      const metrics = await modelService.getModelMetrics(tenantId, labeledData)

      return res.json({ metrics })
    } catch (err) {
      console.error('[ml-routes] getMetrics error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * GET /api/pql/ml/export
   * Export training data in JSON or CSV format.
   */
  const exportData: RequestHandler = async (req, res) => {
    try {
      const { tenantId, role } = req as TenantRequest

      if (role !== 'ADMIN') {
        return res.status(403).json({ error: 'Admin access required' })
      }

      const format = (req.query.format as string) === 'csv' ? 'csv' : 'json'
      const data = await trainingService.exportTrainingSet(tenantId, format)

      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv')
        res.setHeader('Content-Disposition', 'attachment; filename=pql-training-data.csv')
        return res.send(data)
      }

      res.setHeader('Content-Type', 'application/json')
      return res.send(data)
    } catch (err) {
      console.error('[ml-routes] exportData error', err)
      return res.status(500).json({ error: 'Internal server error' })
    }
  }

  router.get('/status', getStatus)
  router.post('/train', trainModel)
  router.get('/metrics', getMetrics)
  router.get('/export', exportData)

  return router
}
