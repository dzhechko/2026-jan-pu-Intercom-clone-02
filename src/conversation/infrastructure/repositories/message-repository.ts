/**
 * Message repository — PostgreSQL implementation.
 * Schema: conversations.messages (migration 003)
 * Reference: docs/tactical-design.md — Repositories
 *
 * IMPORTANT: All queries run under RLS (FF-03).
 */
import { Pool } from 'pg'
import { v4 as uuidv4 } from 'uuid'
import { Message, CreateMessageParams } from '@conversation/domain/aggregates/message'

function rowToMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    dialogId: row.dialog_id as string,
    tenantId: row.tenant_id as string,
    direction: row.direction as Message['direction'],
    senderType: row.sender_type as Message['senderType'],
    content: row.content as string,
    attachments: (row.attachments as unknown[]) ?? [],
    pqlSignals: (row.pql_signals as unknown[]) ?? [],
    createdAt: new Date(row.created_at as string),
  }
}

export interface MessagePage {
  messages: Message[]
  total: number
  hasMore: boolean
}

export class MessageRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Persist a new message and return it with generated id and timestamp.
   */
  async create(params: CreateMessageParams): Promise<Message> {
    const id = uuidv4()
    const { rows } = await this.pool.query(
      `INSERT INTO conversations.messages
         (id, dialog_id, tenant_id, direction, sender_type, content, attachments, pql_signals)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        id,
        params.dialogId,
        params.tenantId,
        params.direction,
        params.senderType,
        params.content,
        JSON.stringify(params.attachments ?? []),
        JSON.stringify(params.pqlSignals ?? []),
      ],
    )
    return rowToMessage(rows[0])
  }

  /**
   * Paginated message history for a dialog.
   * Sorted newest-first to support cursor-style pagination in the UI.
   */
  async findByDialogId(
    dialogId: string,
    limit = 50,
    offset = 0,
  ): Promise<MessagePage> {
    const [dataResult, countResult] = await Promise.all([
      this.pool.query(
        `SELECT * FROM conversations.messages
         WHERE dialog_id = $1
         ORDER BY created_at ASC
         LIMIT $2 OFFSET $3`,
        [dialogId, limit, offset],
      ),
      this.pool.query(
        'SELECT COUNT(*)::int AS total FROM conversations.messages WHERE dialog_id = $1',
        [dialogId],
      ),
    ])

    const total = countResult.rows[0].total as number
    return {
      messages: dataResult.rows.map(rowToMessage),
      total,
      hasMore: offset + limit < total,
    }
  }

  /**
   * Retrieve the most recent message for a dialog (used by unread indicators).
   */
  async findLatestByDialogId(dialogId: string): Promise<Message | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM conversations.messages
       WHERE dialog_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [dialogId],
    )
    return rows.length ? rowToMessage(rows[0]) : null
  }
}
