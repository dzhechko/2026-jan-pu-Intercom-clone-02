import {
  isDealClosedWebhook,
  translateToDealClosedEvents,
  AmoCRMWebhookPayload,
} from './crm-webhook-types'

describe('crm-webhook-types ACL', () => {
  // ─── isDealClosedWebhook ─────────────────────────────────────────────

  describe('isDealClosedWebhook', () => {
    it('returns true when leads.status contains status_id 142', () => {
      const payload: AmoCRMWebhookPayload = {
        leads: {
          status: [
            {
              id: '1001',
              status_id: '142',
              pipeline_id: '10',
              old_status_id: '100',
              account_id: 'acc-1',
            },
          ],
        },
      }
      expect(isDealClosedWebhook(payload)).toBe(true)
    })

    it('returns false when leads.status has a different status_id', () => {
      const payload: AmoCRMWebhookPayload = {
        leads: {
          status: [
            {
              id: '1001',
              status_id: '143',
              pipeline_id: '10',
              old_status_id: '100',
              account_id: 'acc-1',
            },
          ],
        },
      }
      expect(isDealClosedWebhook(payload)).toBe(false)
    })

    it('returns false when leads is undefined', () => {
      const payload: AmoCRMWebhookPayload = {}
      expect(isDealClosedWebhook(payload)).toBe(false)
    })

    it('returns false when leads.status is an empty array', () => {
      const payload: AmoCRMWebhookPayload = {
        leads: {
          status: [],
        },
      }
      expect(isDealClosedWebhook(payload)).toBe(false)
    })
  })

  // ─── translateToDealClosedEvents ─────────────────────────────────────

  describe('translateToDealClosedEvents', () => {
    it('translates a won deal correctly with all fields', () => {
      const now = Date.now()
      const payload: AmoCRMWebhookPayload = {
        leads: {
          status: [
            {
              id: '2001',
              status_id: '142',
              pipeline_id: '20',
              old_status_id: '100',
              account_id: 'acc-2',
              price: 50000,
              responsible_user_id: 'user-42',
              custom_fields: [
                { id: 'cf-1', name: 'Email', values: [{ value: 'client@example.com' }] },
              ],
            },
          ],
        },
      }

      const events = translateToDealClosedEvents(payload)

      expect(events).toHaveLength(1)
      const event = events[0]
      expect(event.dealId).toBe('2001')
      expect(event.accountId).toBe('acc-2')
      expect(event.dealValue).toBe(50000)
      expect(event.pipelineId).toBe('20')
      expect(event.responsibleUserId).toBe('user-42')
      expect(event.contactEmail).toBe('client@example.com')
      expect(event.closedAt.getTime()).toBeGreaterThanOrEqual(now)
    })

    it('extracts contactEmail from custom_fields with name "email"', () => {
      const payload: AmoCRMWebhookPayload = {
        leads: {
          status: [
            {
              id: '3001',
              status_id: '142',
              pipeline_id: '30',
              old_status_id: '100',
              account_id: 'acc-3',
              custom_fields: [
                { id: 'cf-1', name: 'email', values: [{ value: 'lower@test.com' }] },
              ],
            },
          ],
        },
      }

      const events = translateToDealClosedEvents(payload)
      expect(events[0].contactEmail).toBe('lower@test.com')
    })

    it('extracts contactEmail from custom_fields with name "e-mail"', () => {
      const payload: AmoCRMWebhookPayload = {
        leads: {
          status: [
            {
              id: '3002',
              status_id: '142',
              pipeline_id: '30',
              old_status_id: '100',
              account_id: 'acc-3',
              custom_fields: [
                { id: 'cf-2', name: 'E-mail', values: [{ value: 'hyphen@test.com' }] },
              ],
            },
          ],
        },
      }

      const events = translateToDealClosedEvents(payload)
      expect(events[0].contactEmail).toBe('hyphen@test.com')
    })

    it('returns null contactEmail when no email custom field exists', () => {
      const payload: AmoCRMWebhookPayload = {
        leads: {
          status: [
            {
              id: '3003',
              status_id: '142',
              pipeline_id: '30',
              old_status_id: '100',
              account_id: 'acc-3',
              custom_fields: [
                { id: 'cf-3', name: 'Phone', values: [{ value: '+71234567890' }] },
              ],
            },
          ],
        },
      }

      const events = translateToDealClosedEvents(payload)
      expect(events[0].contactEmail).toBeNull()
    })

    it('returns empty array when no status changes exist', () => {
      const payload: AmoCRMWebhookPayload = {}
      expect(translateToDealClosedEvents(payload)).toEqual([])
    })

    it('filters out non-won status changes', () => {
      const payload: AmoCRMWebhookPayload = {
        leads: {
          status: [
            {
              id: '4001',
              status_id: '100',
              pipeline_id: '40',
              old_status_id: '50',
              account_id: 'acc-4',
              price: 10000,
            },
            {
              id: '4002',
              status_id: '142',
              pipeline_id: '40',
              old_status_id: '100',
              account_id: 'acc-4',
              price: 20000,
            },
            {
              id: '4003',
              status_id: '143',
              pipeline_id: '40',
              old_status_id: '100',
              account_id: 'acc-4',
              price: 30000,
            },
          ],
        },
      }

      const events = translateToDealClosedEvents(payload)
      expect(events).toHaveLength(1)
      expect(events[0].dealId).toBe('4002')
      expect(events[0].dealValue).toBe(20000)
    })

    it('returns 0 for dealValue when price is missing', () => {
      const payload: AmoCRMWebhookPayload = {
        leads: {
          status: [
            {
              id: '5001',
              status_id: '142',
              pipeline_id: '50',
              old_status_id: '100',
              account_id: 'acc-5',
            },
          ],
        },
      }

      const events = translateToDealClosedEvents(payload)
      expect(events[0].dealValue).toBe(0)
    })

    it('returns null responsibleUserId when responsible_user_id is missing', () => {
      const payload: AmoCRMWebhookPayload = {
        leads: {
          status: [
            {
              id: '6001',
              status_id: '142',
              pipeline_id: '60',
              old_status_id: '100',
              account_id: 'acc-6',
            },
          ],
        },
      }

      const events = translateToDealClosedEvents(payload)
      expect(events[0].responsibleUserId).toBeNull()
    })
  })
})
