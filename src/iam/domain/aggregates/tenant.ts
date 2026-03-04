/**
 * Tenant aggregate root — top-level bounded context for multi-tenancy.
 * Reference: docs/tactical-design.md — BC-05 IAM
 *
 * Each Tenant represents an isolated workspace. All data is scoped
 * by tenant_id via PostgreSQL RLS (ADR-007, FF-03).
 */

export interface TenantSettings {
  /** PQL scoring threshold to trigger outreach (default 0.65) */
  pqlThreshold: number
  notifyChannels: ('EMAIL' | 'PUSH')[]
  crmIntegration?: {
    type: 'AMOCRM' | 'BITRIX24'
    apiKeyEncrypted: string
    subdomain: string
  }
  customBranding?: {
    primaryColor: string
    logoUrl: string
    widgetTitle: string
  }
}

export interface Tenant {
  id: string
  name: string
  plan: 'TRIAL' | 'GROWTH' | 'REVENUE' | 'OUTCOME'
  status: 'ACTIVE' | 'SUSPENDED' | 'CHURNED'
  billingEmail: string
  settings: TenantSettings
  createdAt: Date
  updatedAt: Date
}

export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  pqlThreshold: 0.65,
  notifyChannels: ['EMAIL'],
}
