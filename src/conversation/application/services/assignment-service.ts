/**
 * Assignment Queue Service — FR-13 Multi-operator
 * Round-robin dialog assignment with least-loaded operator selection.
 *
 * Distributes new dialogs evenly among online operators, respecting:
 * - Operator online status (via PresenceService / Redis)
 * - Maximum concurrent dialog limit per operator (default 5)
 * - Least-loaded operator selection (fewest active ASSIGNED dialogs)
 */
import { Pool } from 'pg'
import { DialogRepository } from '@conversation/infrastructure/repositories/dialog-repository'
import { PresenceService } from '@iam/application/services/presence-service'
import { Dialog } from '@conversation/domain/aggregates/dialog'

export interface AssignmentResult {
  dialog: Dialog
  operatorId: string
}

export class AssignmentService {
  private readonly dialogRepo: DialogRepository
  private readonly maxConcurrentDialogs: number

  constructor(
    private readonly pool: Pool,
    private readonly presenceService: PresenceService,
    maxConcurrentDialogs = 5,
  ) {
    this.dialogRepo = new DialogRepository(pool)
    this.maxConcurrentDialogs = maxConcurrentDialogs
  }

  /**
   * Find the oldest unassigned OPEN dialog for a tenant and assign it
   * to the least-loaded online operator.
   */
  async assignNextDialog(tenantId: string): Promise<AssignmentResult | null> {
    // Find oldest unassigned OPEN dialog
    const unassigned = await this.getUnassignedDialogs(tenantId)
    if (unassigned.length === 0) return null

    const dialog = unassigned[0] // oldest first
    const operatorId = await this.findLeastLoadedOperator(tenantId)
    if (!operatorId) return null

    const assigned = await this.dialogRepo.assignOperator(dialog.id, operatorId)
    if (!assigned) return null

    return { dialog: assigned, operatorId }
  }

  /**
   * Auto-assign a specific dialog to the least-loaded online operator.
   */
  async autoAssign(dialogId: string, tenantId: string): Promise<AssignmentResult | null> {
    const dialog = await this.dialogRepo.findById(dialogId)
    if (!dialog || dialog.status !== 'OPEN') return null

    const operatorId = await this.findLeastLoadedOperator(tenantId)
    if (!operatorId) return null

    const assigned = await this.dialogRepo.assignOperator(dialogId, operatorId)
    if (!assigned) return null

    return { dialog: assigned, operatorId }
  }

  /**
   * Manually reassign a dialog to a specific operator.
   * Allows reassignment of both OPEN and ASSIGNED dialogs.
   */
  async reassign(dialogId: string, operatorId: string): Promise<Dialog | null> {
    const dialog = await this.dialogRepo.findById(dialogId)
    if (!dialog) return null
    if (dialog.status !== 'OPEN' && dialog.status !== 'ASSIGNED') return null

    return this.dialogRepo.assignOperator(dialogId, operatorId)
  }

  /**
   * Get the count of active (ASSIGNED) dialogs per operator within a tenant.
   */
  async getOperatorLoad(tenantId: string): Promise<Map<string, number>> {
    const { rows } = await this.pool.query(
      `SELECT operator_id, COUNT(*)::int AS active_count
       FROM conversations.dialogs
       WHERE tenant_id = $1 AND status = 'ASSIGNED' AND operator_id IS NOT NULL
       GROUP BY operator_id`,
      [tenantId],
    )

    const loadMap = new Map<string, number>()
    for (const row of rows) {
      loadMap.set(row.operator_id, row.active_count)
    }
    return loadMap
  }

  /**
   * Get unassigned OPEN dialogs for a tenant, ordered by creation time (oldest first).
   */
  async getUnassignedDialogs(tenantId: string): Promise<Dialog[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM conversations.dialogs
       WHERE tenant_id = $1 AND status = 'OPEN' AND operator_id IS NULL
       ORDER BY created_at ASC`,
      [tenantId],
    )
    return rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      tenantId: row.tenant_id as string,
      channelType: row.channel_type as Dialog['channelType'],
      externalChannelId: row.external_id as string,
      status: row.status as Dialog['status'],
      assignedOperatorId: row.operator_id as string | undefined,
      contactEmail: row.contact_email as string | undefined,
      pqlScore: row.pql_score != null ? Number(row.pql_score) : undefined,
      pqlTier: row.pql_tier as Dialog['pqlTier'],
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    }))
  }

  /**
   * Get unassigned dialog count for the queue indicator.
   */
  async getQueueSize(tenantId: string): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS count
       FROM conversations.dialogs
       WHERE tenant_id = $1 AND status = 'OPEN' AND operator_id IS NULL`,
      [tenantId],
    )
    return rows[0]?.count ?? 0
  }

  /**
   * Find the online operator with the fewest active dialogs,
   * who is below the max concurrent dialog limit.
   */
  async findLeastLoadedOperator(tenantId: string): Promise<string | null> {
    const onlineOperators = await this.presenceService.getOnlineOperators(tenantId)
    if (onlineOperators.length === 0) return null

    const loadMap = await this.getOperatorLoad(tenantId)

    let bestOperator: string | null = null
    let bestLoad = Infinity

    for (const opId of onlineOperators) {
      const load = loadMap.get(opId) ?? 0
      if (load < this.maxConcurrentDialogs && load < bestLoad) {
        bestLoad = load
        bestOperator = opId
      }
    }

    return bestOperator
  }
}
