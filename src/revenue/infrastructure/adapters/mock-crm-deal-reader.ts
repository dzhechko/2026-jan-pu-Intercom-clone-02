/**
 * Mock CRM Deal Reader — provides simulated deal data for revenue reports.
 * Reference: FR-06
 *
 * Returns deterministic mock data based on tenantId hash.
 * Replace with real AmoCRM MCP adapter call when CRM integration is live.
 */
import { CRMDealReader, CRMDealForReport } from '@revenue/application/services/revenue-report-service'

export class MockCRMDealReader implements CRMDealReader {
  async findClosedDealsForPeriod(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<CRMDealForReport[]> {
    // Deterministic mock based on tenant hash
    const hash = tenantId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
    const dealCount = (hash % 5) + 1

    return Array.from({ length: dealCount }, (_, i) => {
      const closedAt = new Date(start.getTime() + (end.getTime() - start.getTime()) * ((i + 1) / (dealCount + 1)))
      return {
        id: `mock-deal-${hash}-${i}`,
        value: [2400, 12000, 4800, 1200, 8400][i % 5],
        status: 'WON' as const,
        closedAt,
        contactEmail: `contact-${i}@example.com`,
      }
    })
  }
}
