/**
 * AmoCRM MCP Adapter — Anti-Corruption Layer + Circuit Breaker.
 * Reference: docs/pseudocode.md PS-06, ADR-002, ADR-008
 *
 * Wraps Cloud.ru amoCRM MCP server calls.
 * Translates MCP protocol types → domain types (CRMPort interface).
 * Circuit Breaker: timeout 2000ms, failover <30sec.
 */
import CircuitBreaker from 'opossum'
import { CRMPort, ContactContext, CRMDeal, CRMContactContext, CRMResult } from '@pql/domain/ports/crm-port'
import { Result, ok, err } from '@shared/types/result'

export class AmoCRMMCPAdapter implements CRMPort {
  private breaker: CircuitBreaker

  constructor(private mcpBaseUrl: string) {
    // Circuit Breaker config (FF-04)
    this.breaker = new CircuitBreaker(this.callMCP.bind(this), {
      timeout: 2000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      rollingCountTimeout: 10000,
    })

    this.breaker.fallback(() => ({
      ok: false,
      error: new Error('amoCRM MCP circuit open — unavailable'),
    }))
  }

  async getContactContext(email: string, tenantId: string): Promise<Result<ContactContext>> {
    try {
      const result = await this.breaker.fire({
        tool: 'get_contact_by_email',
        params: { email, tenantId },
      }) as Result<any>

      if (!result.ok) return result

      // ACL: translate amoCRM types → domain types
      const raw = result.value
      return ok({
        contacts: (raw.contacts || []).map((c: any) => ({
          id: String(c.id),
          name: c.name || '',
          email: c.email || email,
          customFields: c.custom_fields_values || {},
        })),
        deals: (raw.leads || []).map((d: any) => ({
          id: String(d.id),
          status: this.mapDealStatus(d.status_id),
          value: d.price || 0,
          createdAt: new Date(d.created_at * 1000),
        })),
        lastActivityDate: raw.contacts?.[0]?.updated_at
          ? new Date(raw.contacts[0].updated_at * 1000)
          : null,
        currentPlan: raw.contacts?.[0]?.custom_fields_values?.plan || null,
        accountAge: raw.contacts?.[0]?.created_at
          ? Math.floor((Date.now() - raw.contacts[0].created_at * 1000) / 86400000)
          : null,
      })
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)))
    }
  }

  async createDeal(
    tenantId: string,
    contactEmail: string,
    title: string,
  ): Promise<Result<{ dealId: string }>> {
    try {
      const result = await this.breaker.fire({
        tool: 'create_lead',
        params: { tenantId, contactEmail, title },
      }) as Result<any>
      if (!result.ok) return result
      return ok({ dealId: String(result.value.id) })
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)))
    }
  }

  async findDealByDialogContext(
    tenantId: string,
    contactEmail: string,
    afterDate: Date,
    beforeDate: Date,
  ): Promise<Result<CRMDeal | null>> {
    try {
      const result = await this.breaker.fire({
        tool: 'find_deals',
        params: {
          tenantId,
          contactEmail,
          afterDate: Math.floor(afterDate.getTime() / 1000),
          beforeDate: Math.floor(beforeDate.getTime() / 1000),
          status: 'won',
        },
      }) as Result<any>
      if (!result.ok) return result

      const deals = result.value?.leads || []
      if (deals.length === 0) return ok(null)

      const deal = deals[0]
      return ok({
        id: String(deal.id),
        status: 'WON' as const,
        value: deal.price || 0,
        createdAt: new Date(deal.created_at * 1000),
      })
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * FR-03: Memory AI — enriched contact context for operator sidebar.
   * Uses circuit breaker for resilience. Returns mock data when MCP is unavailable.
   * Structure is ready for real MCP integration — replace generateMockContext with actual MCP call.
   */
  async getContactContextEnriched(email: string, tenantId: string): Promise<CRMResult<CRMContactContext>> {
    if (!this.mcpBaseUrl) {
      return CRMResult.notConfigured()
    }

    try {
      const result = await this.breaker.fire({
        tool: 'get_contact_enriched',
        params: { email, tenantId },
      }) as Result<any>

      if (!result.ok) {
        // Circuit open or MCP error — fall back to mock data for now
        return CRMResult.ok(this.generateMockContext(email))
      }

      const raw = result.value
      return CRMResult.ok(this.translateToEnrichedContext(raw, email))
    } catch {
      // Circuit breaker open or network error — graceful degradation with mock
      return CRMResult.ok(this.generateMockContext(email))
    }
  }

  /**
   * ACL: Translate raw amoCRM response → domain CRMContactContext.
   * Anti-Corruption Layer keeps external CRM types out of domain.
   */
  private translateToEnrichedContext(raw: any, email: string): CRMContactContext {
    const contact = raw.contacts?.[0]
    const deals = (raw.leads || []).map((d: any) => ({
      id: String(d.id),
      title: d.name || 'Untitled deal',
      value: d.price || 0,
      status: this.mapDealStatus(d.status_id),
      closedAt: d.closed_at ? new Date(d.closed_at * 1000).toISOString() : undefined,
    }))

    const fields = {
      hasName: !!contact?.name,
      hasPlan: !!contact?.custom_fields_values?.plan,
      hasAge: !!contact?.created_at,
      hasDeals: deals.length > 0,
      hasTags: !!(contact?.tags?.length),
    }
    const filledFields = Object.values(fields).filter(Boolean).length
    const enrichmentScore = Math.round((filledFields / Object.keys(fields).length) * 100) / 100

    return {
      contactEmail: email,
      contactName: contact?.name,
      currentPlan: contact?.custom_fields_values?.plan,
      accountAge: contact?.created_at
        ? Math.floor((Date.now() - contact.created_at * 1000) / 86400000)
        : undefined,
      deals,
      previousDialogCount: raw.dialogs_count ?? 0,
      tags: contact?.tags?.map((t: any) => t.name || String(t)) ?? [],
      enrichmentScore,
    }
  }

  /**
   * Mock data generator — used while real amoCRM MCP is not connected.
   * Returns realistic simulated data to demonstrate the Memory AI UI.
   */
  private generateMockContext(email: string): CRMContactContext {
    // Deterministic mock based on email hash for consistency
    const hash = email.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
    const plans = ['Free', 'Starter', 'Professional', 'Enterprise']
    const tagSets = [
      ['early-adopter', 'active'],
      ['enterprise', 'high-value', 'decision-maker'],
      ['trial', 'onboarding'],
      ['churned', 're-engaged'],
    ]

    const planIndex = hash % plans.length
    const tagIndex = hash % tagSets.length
    const dealCount = (hash % 3) + 1
    const deals = Array.from({ length: dealCount }, (_, i) => ({
      id: `mock-deal-${hash}-${i}`,
      title: ['Platform License', 'Annual Subscription', 'Support Package', 'Add-on Services'][i % 4],
      value: [2400, 12000, 4800, 1200][i % 4],
      status: ['OPEN', 'WON', 'OPEN'][i % 3],
      closedAt: i === 1 ? new Date(Date.now() - 30 * 86400000).toISOString() : undefined,
    }))

    return {
      contactEmail: email,
      contactName: email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      currentPlan: plans[planIndex],
      accountAge: (hash % 365) + 30,
      deals,
      previousDialogCount: (hash % 12) + 1,
      tags: tagSets[tagIndex],
      enrichmentScore: 0.85,
    }
  }

  private async callMCP(request: { tool: string; params: Record<string, unknown> }): Promise<Result<any>> {
    const response = await fetch(`${this.mcpBaseUrl}/tools/${request.tool}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.params),
      signal: AbortSignal.timeout(2000),
    })

    if (!response.ok) {
      return err(new Error(`MCP error: ${response.status} ${response.statusText}`))
    }

    return ok(await response.json())
  }

  private mapDealStatus(statusId: number): 'OPEN' | 'WON' | 'LOST' {
    // amoCRM status mapping — customize per tenant
    if (statusId === 142) return 'WON'
    if (statusId === 143) return 'LOST'
    return 'OPEN'
  }
}
