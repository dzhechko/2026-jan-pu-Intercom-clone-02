/**
 * PostgreSQL repository for Tenant aggregate.
 * Reference: docs/tactical-design.md — BC-05 IAM
 *
 * Operates on iam.tenants table (Migration 002).
 * RLS is set at the connection level via app.tenant_id GUC —
 * this repo bypasses RLS intentionally for bootstrap operations
 * (register, system-level lookups). Use with caution.
 */
import { Pool, PoolClient } from 'pg'
import { Tenant, TenantSettings, DEFAULT_TENANT_SETTINGS } from '@iam/domain/aggregates/tenant'
import { Result, ok, err } from '@shared/types/result'

interface TenantRow {
  id: string
  name: string
  plan: string
  status: string
  billing_email: string
  settings: Record<string, unknown>
  created_at: Date
  updated_at?: Date
}

function rowToTenant(row: TenantRow): Tenant {
  const settings = row.settings as Partial<TenantSettings>
  return {
    id: row.id,
    name: row.name,
    plan: row.plan as Tenant['plan'],
    status: row.status as Tenant['status'],
    billingEmail: row.billing_email,
    settings: {
      pqlThreshold: settings.pqlThreshold ?? DEFAULT_TENANT_SETTINGS.pqlThreshold,
      notifyChannels: settings.notifyChannels ?? DEFAULT_TENANT_SETTINGS.notifyChannels,
      crmIntegration: settings.crmIntegration,
      customBranding: settings.customBranding,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at,
  }
}

export class TenantRepository {
  constructor(private readonly pool: Pool) {}

  async create(
    data: Pick<Tenant, 'name' | 'billingEmail'> & { settings?: Partial<TenantSettings> },
    client?: PoolClient,
  ): Promise<Result<Tenant, Error>> {
    const settings = { ...DEFAULT_TENANT_SETTINGS, ...data.settings }
    const query = `
      INSERT INTO iam.tenants (name, billing_email, settings)
      VALUES ($1, $2, $3)
      RETURNING *, created_at AS updated_at
    `
    try {
      const executor = client ?? this.pool
      const result = await executor.query(query, [
        data.name,
        data.billingEmail,
        JSON.stringify(settings),
      ])
      return ok(rowToTenant(result.rows[0]))
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)))
    }
  }

  async findById(id: string): Promise<Result<Tenant | null, Error>> {
    try {
      const result = await this.pool.query(
        'SELECT *, created_at AS updated_at FROM iam.tenants WHERE id = $1',
        [id],
      )
      return ok(result.rows[0] ? rowToTenant(result.rows[0]) : null)
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)))
    }
  }

  async update(
    id: string,
    data: Partial<Pick<Tenant, 'name' | 'plan' | 'status' | 'billingEmail' | 'settings'>>,
    client?: PoolClient,
  ): Promise<Result<Tenant, Error>> {
    const fields: string[] = []
    const values: unknown[] = []
    let idx = 1

    if (data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(data.name) }
    if (data.plan !== undefined) { fields.push(`plan = $${idx++}`); values.push(data.plan) }
    if (data.status !== undefined) { fields.push(`status = $${idx++}`); values.push(data.status) }
    if (data.billingEmail !== undefined) { fields.push(`billing_email = $${idx++}`); values.push(data.billingEmail) }
    if (data.settings !== undefined) { fields.push(`settings = $${idx++}`); values.push(JSON.stringify(data.settings)) }

    if (fields.length === 0) {
      const existing = await this.findById(id)
      if (!existing.ok) return existing
      if (!existing.value) return err(new Error(`Tenant ${id} not found`))
      return ok(existing.value)
    }

    values.push(id)
    const query = `
      UPDATE iam.tenants SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING *, created_at AS updated_at
    `
    try {
      const executor = client ?? this.pool
      const result = await executor.query(query, values)
      if (result.rows.length === 0) return err(new Error(`Tenant ${id} not found`))
      return ok(rowToTenant(result.rows[0]))
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)))
    }
  }
}
