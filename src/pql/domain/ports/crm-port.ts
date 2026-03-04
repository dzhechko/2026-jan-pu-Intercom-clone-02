/**
 * CRM Port — interface for CRM integration (amoCRM MCP).
 * Reference: ADR-008, docs/tactical-design.md
 *
 * Implemented by AmoCRMMCPAdapter in BC-04 Integration.
 * Domain code calls this interface, never the adapter directly.
 */
import { Result } from '@shared/types/result'

export interface CRMContact {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly customFields: Record<string, unknown>
}

export interface CRMDeal {
  readonly id: string
  readonly status: 'OPEN' | 'WON' | 'LOST'
  readonly value: number
  readonly createdAt: Date
}

export interface ContactContext {
  readonly contacts: CRMContact[]
  readonly deals: CRMDeal[]
  readonly lastActivityDate: Date | null
  readonly currentPlan: string | null
  readonly accountAge: number | null  // days since registration
}

/**
 * FR-03: Memory AI — enriched CRM contact context for operator sidebar.
 * Contains all data needed to display customer context before operator responds.
 */
export interface CRMContactContext {
  readonly contactEmail: string
  readonly contactName?: string
  readonly currentPlan?: string
  readonly accountAge?: number  // days since registration
  readonly deals: { id: string; title: string; value: number; status: string; closedAt?: string }[]
  readonly previousDialogCount: number
  readonly tags: string[]
  readonly enrichmentScore: number  // 0-1 how much data we have
}

/**
 * CRM result wrapper — distinguishes between "CRM not configured" and "CRM error".
 */
export type CRMResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'not_configured' }
  | { status: 'error'; error: string }

export const CRMResult = {
  ok<T>(data: T): CRMResult<T> {
    return { status: 'ok', data }
  },
  notConfigured<T>(): CRMResult<T> {
    return { status: 'not_configured' }
  },
  error<T>(error: string): CRMResult<T> {
    return { status: 'error', error }
  },
}

export interface CRMPort {
  getContactContext(email: string, tenantId: string): Promise<Result<ContactContext>>
  getContactContextEnriched(email: string, tenantId: string): Promise<CRMResult<CRMContactContext>>
  createDeal(tenantId: string, contactEmail: string, title: string): Promise<Result<{ dealId: string }>>
  findDealByDialogContext(
    tenantId: string,
    contactEmail: string,
    afterDate: Date,
    beforeDate: Date,
  ): Promise<Result<CRMDeal | null>>
}
