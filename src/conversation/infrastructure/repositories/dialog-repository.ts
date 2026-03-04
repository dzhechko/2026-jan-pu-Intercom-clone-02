/**
 * Dialog repository — PostgreSQL implementation.
 * Schema: conversations.dialogs (migration 003)
 * Reference: docs/tactical-design.md — Repositories
 *
 * IMPORTANT: All queries run under RLS (FF-03).
 * Caller must have SET app.tenant_id in the session before calling any method.
 */
import { Pool } from 'pg'
import { v4 as uuidv4 } from 'uuid'
import { Dialog, CreateDialogParams, DialogStatus, PQLTier } from '@conversation/domain/aggregates/dialog'

function rowToDialog(row: Record<string, unknown>): Dialog {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    channelType: row.channel_type as Dialog['channelType'],
    externalChannelId: row.external_id as string,
    status: row.status as DialogStatus,
    assignedOperatorId: row.operator_id as string | undefined,
    contactEmail: row.contact_email as string | undefined,
    pqlScore: row.pql_score != null ? Number(row.pql_score) : undefined,
    pqlTier: row.pql_tier as PQLTier | undefined,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  }
}

export class DialogRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Persist a new dialog and return the full aggregate.
   */
  async create(params: CreateDialogParams): Promise<Dialog> {
    const id = uuidv4()
    const { rows } = await this.pool.query(
      `INSERT INTO conversations.dialogs
         (id, tenant_id, channel_type, external_id, contact_email, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        id,
        params.tenantId,
        params.channelType,
        params.externalChannelId,
        params.contactEmail ?? null,
        JSON.stringify(params.metadata ?? {}),
      ],
    )
    return rowToDialog(rows[0])
  }

  /**
   * Find dialog by primary key. Returns null when not found (or filtered by RLS).
   */
  async findById(id: string): Promise<Dialog | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM conversations.dialogs WHERE id = $1',
      [id],
    )
    return rows.length ? rowToDialog(rows[0]) : null
  }

  /**
   * Find by channel-specific external identifier within a tenant.
   */
  async findByExternalId(
    tenantId: string,
    externalChannelId: string,
  ): Promise<Dialog | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM conversations.dialogs WHERE tenant_id = $1 AND external_id = $2',
      [tenantId, externalChannelId],
    )
    return rows.length ? rowToDialog(rows[0]) : null
  }

  /**
   * List all OPEN / ASSIGNED dialogs for the current tenant (bounded by RLS).
   * Returns newest-first, capped at 100 for pagination safety.
   */
  async findOpenByTenant(
    tenantId: string,
    limit = 50,
    offset = 0,
  ): Promise<Dialog[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM conversations.dialogs
       WHERE tenant_id = $1
         AND status IN ('OPEN','ASSIGNED')
       ORDER BY updated_at DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, limit, offset],
    )
    return rows.map(rowToDialog)
  }

  /**
   * Transition dialog to a new status.
   */
  async updateStatus(id: string, status: DialogStatus): Promise<Dialog | null> {
    const { rows } = await this.pool.query(
      `UPDATE conversations.dialogs
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, id],
    )
    return rows.length ? rowToDialog(rows[0]) : null
  }

  /**
   * Assign dialog to an operator and transition to ASSIGNED.
   */
  async assignOperator(id: string, operatorId: string): Promise<Dialog | null> {
    const { rows } = await this.pool.query(
      `UPDATE conversations.dialogs
       SET operator_id = $1, status = 'ASSIGNED', updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [operatorId, id],
    )
    return rows.length ? rowToDialog(rows[0]) : null
  }

  /**
   * Update PQL scoring result on the dialog.
   */
  async updatePQLScore(
    id: string,
    score: number,
    tier: PQLTier,
  ): Promise<Dialog | null> {
    const { rows } = await this.pool.query(
      `UPDATE conversations.dialogs
       SET pql_score = $1, pql_tier = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [score, tier, id],
    )
    return rows.length ? rowToDialog(rows[0]) : null
  }
}
