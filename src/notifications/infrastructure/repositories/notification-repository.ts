/**
 * Notification Repository — PostgreSQL persistence for BC-06.
 * Stores notification jobs and supports duplicate prevention per dialog.
 *
 * Table: notifications.jobs (created via migration, uses RLS on tenant_id).
 * Reference: FR-11 PQL Pulse Notifications
 */
import { Pool, PoolClient } from 'pg'
import { Notification } from '@notifications/domain/notification'

export interface NotificationRepository {
  save(notification: Notification, client?: PoolClient): Promise<Notification>
  findByDialogId(dialogId: string, client?: PoolClient): Promise<Notification[]>
  findByOperatorId(
    operatorId: string,
    options?: { limit?: number; offset?: number },
    client?: PoolClient,
  ): Promise<Notification[]>
  countUnread(operatorId: string, client?: PoolClient): Promise<number>
  markAsRead(id: string, operatorId: string, client?: PoolClient): Promise<boolean>
}

export class PgNotificationRepository implements NotificationRepository {
  constructor(private readonly pool: Pool) {}

  async save(notification: Notification, client?: PoolClient): Promise<Notification> {
    const executor = client ?? this.pool
    const query = `
      INSERT INTO notification_jobs (id, tenant_id, operator_id, type, channel, dialog_id, title, body, metadata, read, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO NOTHING
      RETURNING *
    `
    const values = [
      notification.id,
      notification.tenantId,
      notification.operatorId,
      notification.type,
      notification.channel,
      notification.dialogId,
      notification.title,
      notification.body,
      JSON.stringify(notification.metadata),
      notification.read,
      notification.createdAt,
    ]

    try {
      await executor.query(query, values)
    } catch (err) {
      console.error('[notification-repo] save error', err)
      throw err
    }

    return notification
  }

  async findByDialogId(dialogId: string, client?: PoolClient): Promise<Notification[]> {
    const executor = client ?? this.pool
    const query = `
      SELECT * FROM notification_jobs
      WHERE dialog_id = $1
      ORDER BY created_at DESC
    `
    try {
      const result = await executor.query(query, [dialogId])
      return result.rows.map(mapRow)
    } catch (err) {
      console.error('[notification-repo] findByDialogId error', err)
      return []
    }
  }

  async findByOperatorId(
    operatorId: string,
    options: { limit?: number; offset?: number } = {},
    client?: PoolClient,
  ): Promise<Notification[]> {
    const executor = client ?? this.pool
    const limit = options.limit ?? 50
    const offset = options.offset ?? 0

    const query = `
      SELECT * FROM notification_jobs
      WHERE operator_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `
    try {
      const result = await executor.query(query, [operatorId, limit, offset])
      return result.rows.map(mapRow)
    } catch (err) {
      console.error('[notification-repo] findByOperatorId error', err)
      return []
    }
  }

  async countUnread(operatorId: string, client?: PoolClient): Promise<number> {
    const executor = client ?? this.pool
    const query = `
      SELECT COUNT(*) as count FROM notification_jobs
      WHERE operator_id = $1 AND read = false
    `
    try {
      const result = await executor.query(query, [operatorId])
      return parseInt(result.rows[0]?.count ?? '0', 10)
    } catch (err) {
      console.error('[notification-repo] countUnread error', err)
      return 0
    }
  }

  async markAsRead(id: string, operatorId: string, client?: PoolClient): Promise<boolean> {
    const executor = client ?? this.pool
    const query = `
      UPDATE notification_jobs
      SET read = true
      WHERE id = $1 AND operator_id = $2
      RETURNING id
    `
    try {
      const result = await executor.query(query, [id, operatorId])
      return (result.rowCount ?? 0) > 0
    } catch (err) {
      console.error('[notification-repo] markAsRead error', err)
      return false
    }
  }
}

function mapRow(row: Record<string, unknown>): Notification {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    operatorId: row.operator_id as string,
    type: row.type as Notification['type'],
    channel: row.channel as Notification['channel'],
    dialogId: row.dialog_id as string,
    title: row.title as string,
    body: row.body as string,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata as Notification['metadata']),
    read: row.read as boolean,
    createdAt: new Date(row.created_at as string),
  }
}
