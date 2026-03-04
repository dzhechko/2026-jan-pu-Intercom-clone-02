/**
 * PostgreSQL repository for Operator aggregate.
 * Reference: docs/tactical-design.md — BC-05 IAM
 *
 * Operates on iam.operators table (Migration 002).
 * Table has RLS enabled — always set app.tenant_id GUC before querying
 * via tenant middleware (ADR-007).
 */
import { Pool, PoolClient } from 'pg'
import { Operator } from '@iam/domain/aggregates/operator'
import { Result, ok, err } from '@shared/types/result'

interface OperatorRow {
  id: string
  tenant_id: string
  email: string
  name: string
  role: string
  status: string
  password_hash: string
  created_at: Date
}

function rowToOperator(row: OperatorRow): Operator {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    name: row.name,
    role: row.role as Operator['role'],
    status: row.status as Operator['status'],
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  }
}

export class OperatorRepository {
  constructor(private readonly pool: Pool) {}

  async create(
    data: Pick<Operator, 'tenantId' | 'email' | 'name' | 'passwordHash' | 'role'>,
    client?: PoolClient,
  ): Promise<Result<Operator, Error>> {
    const query = `
      INSERT INTO iam.operators (tenant_id, email, name, password_hash, role)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `
    try {
      const executor = client ?? this.pool
      const result = await executor.query(query, [
        data.tenantId,
        data.email.toLowerCase().trim(),
        data.name,
        data.passwordHash,
        data.role,
      ])
      return ok(rowToOperator(result.rows[0]))
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)))
    }
  }

  /**
   * Find operator by email — bypasses RLS intentionally for login flow.
   * Login must work regardless of which tenant the operator belongs to.
   */
  async findByEmail(email: string): Promise<Result<Operator | null, Error>> {
    try {
      const result = await this.pool.query(
        'SELECT * FROM iam.operators WHERE email = $1 AND status != $2',
        [email.toLowerCase().trim(), 'DISABLED'],
      )
      return ok(result.rows[0] ? rowToOperator(result.rows[0]) : null)
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)))
    }
  }

  async findById(id: string, client?: PoolClient): Promise<Result<Operator | null, Error>> {
    try {
      const executor = client ?? this.pool
      const result = await executor.query(
        'SELECT * FROM iam.operators WHERE id = $1',
        [id],
      )
      return ok(result.rows[0] ? rowToOperator(result.rows[0]) : null)
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)))
    }
  }

  async findByTenantId(tenantId: string, client?: PoolClient): Promise<Result<Operator[], Error>> {
    try {
      const executor = client ?? this.pool
      const result = await executor.query(
        'SELECT * FROM iam.operators WHERE tenant_id = $1 ORDER BY created_at ASC',
        [tenantId],
      )
      return ok(result.rows.map(rowToOperator))
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)))
    }
  }

  async updateStatus(
    id: string,
    status: Operator['status'],
    client?: PoolClient,
  ): Promise<Result<void, Error>> {
    try {
      const executor = client ?? this.pool
      await executor.query(
        'UPDATE iam.operators SET status = $1 WHERE id = $2',
        [status, id],
      )
      return ok(undefined)
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)))
    }
  }
}
