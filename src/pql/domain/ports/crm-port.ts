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

export interface CRMPort {
  getContactContext(email: string, tenantId: string): Promise<Result<ContactContext>>
  createDeal(tenantId: string, contactEmail: string, title: string): Promise<Result<{ dealId: string }>>
  findDealByDialogContext(
    tenantId: string,
    contactEmail: string,
    afterDate: Date,
    beforeDate: Date,
  ): Promise<Result<CRMDeal | null>>
}
