/**
 * Unit tests for AssignmentService — FR-13 Multi-operator.
 * Uses mocked Pool and PresenceService — no real DB/Redis required.
 */
import { Pool } from 'pg'
import { AssignmentService } from './assignment-service'
import { PresenceService } from '@iam/application/services/presence-service'

// ── Helpers ───────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-uuid-1234'
const OP_1 = 'operator-1'
const OP_2 = 'operator-2'
const OP_3 = 'operator-3'
const DIALOG_1 = 'dialog-1'
const DIALOG_2 = 'dialog-2'
const DIALOG_3 = 'dialog-3'

function makeDialogRow(id: string, status: string, operatorId: string | null = null) {
  return {
    id,
    tenant_id: TENANT_ID,
    channel_type: 'WEB_CHAT',
    external_id: `ext-${id}`,
    status,
    operator_id: operatorId,
    contact_email: null,
    pql_score: null,
    pql_tier: null,
    metadata: {},
    created_at: new Date('2026-01-01').toISOString(),
    updated_at: new Date('2026-01-01').toISOString(),
  }
}

function createMockPresenceService(onlineOperators: string[]): PresenceService {
  return {
    setOnline: jest.fn().mockResolvedValue(undefined),
    setOffline: jest.fn().mockResolvedValue(undefined),
    getOnlineOperators: jest.fn().mockResolvedValue(onlineOperators),
    isOnline: jest.fn().mockImplementation(async (opId: string) =>
      onlineOperators.includes(opId),
    ),
  } as unknown as PresenceService
}

function createMockPool(overrides?: {
  unassignedDialogs?: Array<Record<string, unknown>>
  operatorLoad?: Array<{ operator_id: string; active_count: number }>
  findByIdDialog?: Record<string, unknown> | null
  assignResult?: Record<string, unknown> | null
}): Pool {
  const mockPool: Partial<Pool> = {
    query: jest.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
      const q = typeof sql === 'string' ? sql.trim() : ''

      // getQueueSize (must be before getUnassignedDialogs — both share similar WHERE clause)
      if (q.includes('COUNT(*)') && q.includes("status = 'OPEN'") && q.includes('operator_id IS NULL')) {
        return { rows: [{ count: overrides?.unassignedDialogs?.length ?? 0 }] }
      }

      // getUnassignedDialogs
      if (q.includes("status = 'OPEN'") && q.includes('operator_id IS NULL')) {
        return { rows: overrides?.unassignedDialogs ?? [] }
      }

      // getOperatorLoad
      if (q.includes("status = 'ASSIGNED'") && q.includes('GROUP BY operator_id')) {
        return { rows: overrides?.operatorLoad ?? [] }
      }

      // findById (SELECT * FROM conversations.dialogs WHERE id = $1)
      if (q.includes('FROM conversations.dialogs WHERE id =')) {
        if (overrides?.findByIdDialog === null) return { rows: [] }
        if (overrides?.findByIdDialog) return { rows: [overrides.findByIdDialog] }
        return { rows: [] }
      }

      // assignOperator (UPDATE ... SET operator_id)
      if (q.includes('SET operator_id')) {
        if (overrides?.assignResult === null) return { rows: [] }
        if (overrides?.assignResult) return { rows: [overrides.assignResult] }
        // Default: return the dialog with assigned status
        const opId = params?.[0] as string
        const dId = params?.[1] as string
        return {
          rows: [makeDialogRow(dId, 'ASSIGNED', opId)],
        }
      }

      return { rows: [] }
    }),
  }

  return mockPool as Pool
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AssignmentService', () => {
  // ── Round-robin assignment distributes evenly ─────────────────────────────

  describe('assignNextDialog()', () => {
    it('assigns the oldest unassigned dialog to the least-loaded online operator', async () => {
      const pool = createMockPool({
        unassignedDialogs: [
          makeDialogRow(DIALOG_1, 'OPEN'),
          makeDialogRow(DIALOG_2, 'OPEN'),
        ],
        operatorLoad: [
          { operator_id: OP_1, active_count: 2 },
          // OP_2 has 0 active dialogs (not in load results)
        ],
      })
      const presence = createMockPresenceService([OP_1, OP_2])
      const service = new AssignmentService(pool, presence)

      const result = await service.assignNextDialog(TENANT_ID)

      expect(result).not.toBeNull()
      expect(result!.operatorId).toBe(OP_2) // least loaded
      expect(result!.dialog.id).toBe(DIALOG_1) // oldest first
    })

    it('returns null when no unassigned dialogs', async () => {
      const pool = createMockPool({ unassignedDialogs: [] })
      const presence = createMockPresenceService([OP_1])
      const service = new AssignmentService(pool, presence)

      const result = await service.assignNextDialog(TENANT_ID)

      expect(result).toBeNull()
    })

    it('returns null when no operators are online', async () => {
      const pool = createMockPool({
        unassignedDialogs: [makeDialogRow(DIALOG_1, 'OPEN')],
      })
      const presence = createMockPresenceService([])
      const service = new AssignmentService(pool, presence)

      const result = await service.assignNextDialog(TENANT_ID)

      expect(result).toBeNull()
    })
  })

  // ── Least-loaded operator selection ───────────────────────────────────────

  describe('findLeastLoadedOperator()', () => {
    it('selects the operator with fewest active dialogs', async () => {
      const pool = createMockPool({
        operatorLoad: [
          { operator_id: OP_1, active_count: 3 },
          { operator_id: OP_2, active_count: 1 },
          { operator_id: OP_3, active_count: 2 },
        ],
      })
      const presence = createMockPresenceService([OP_1, OP_2, OP_3])
      const service = new AssignmentService(pool, presence)

      const result = await service.findLeastLoadedOperator(TENANT_ID)

      expect(result).toBe(OP_2)
    })

    it('returns null when all operators are at max capacity', async () => {
      const pool = createMockPool({
        operatorLoad: [
          { operator_id: OP_1, active_count: 5 },
          { operator_id: OP_2, active_count: 5 },
        ],
      })
      const presence = createMockPresenceService([OP_1, OP_2])
      const service = new AssignmentService(pool, presence, 5)

      const result = await service.findLeastLoadedOperator(TENANT_ID)

      expect(result).toBeNull()
    })

    it('only considers online operators', async () => {
      const pool = createMockPool({
        operatorLoad: [
          { operator_id: OP_1, active_count: 4 },
          // OP_2 has 0 load but is offline
          { operator_id: OP_3, active_count: 3 },
        ],
      })
      // OP_2 is offline
      const presence = createMockPresenceService([OP_1, OP_3])
      const service = new AssignmentService(pool, presence)

      const result = await service.findLeastLoadedOperator(TENANT_ID)

      expect(result).toBe(OP_3)
    })
  })

  // ── Max concurrent dialog limit ──────────────────────────────────────────

  describe('max concurrent dialogs', () => {
    it('respects configurable max concurrent dialog limit', async () => {
      const pool = createMockPool({
        operatorLoad: [
          { operator_id: OP_1, active_count: 3 },
        ],
      })
      const presence = createMockPresenceService([OP_1])

      // Set max to 3 — OP_1 should be at capacity
      const service = new AssignmentService(pool, presence, 3)
      const result = await service.findLeastLoadedOperator(TENANT_ID)

      expect(result).toBeNull()
    })

    it('allows assignment when under max limit', async () => {
      const pool = createMockPool({
        operatorLoad: [
          { operator_id: OP_1, active_count: 2 },
        ],
      })
      const presence = createMockPresenceService([OP_1])

      const service = new AssignmentService(pool, presence, 3)
      const result = await service.findLeastLoadedOperator(TENANT_ID)

      expect(result).toBe(OP_1)
    })
  })

  // ── No assignment when no operators online ────────────────────────────────

  describe('no operators online', () => {
    it('autoAssign returns null when no operators online', async () => {
      const pool = createMockPool({
        findByIdDialog: makeDialogRow(DIALOG_1, 'OPEN'),
      })
      const presence = createMockPresenceService([])
      const service = new AssignmentService(pool, presence)

      const result = await service.autoAssign(DIALOG_1, TENANT_ID)

      expect(result).toBeNull()
    })
  })

  // ── Reassignment ─────────────────────────────────────────────────────────

  describe('reassign()', () => {
    it('reassigns an ASSIGNED dialog to a different operator', async () => {
      const pool = createMockPool({
        findByIdDialog: makeDialogRow(DIALOG_1, 'ASSIGNED', OP_1),
      })
      const presence = createMockPresenceService([OP_1, OP_2])
      const service = new AssignmentService(pool, presence)

      const result = await service.reassign(DIALOG_1, OP_2)

      expect(result).not.toBeNull()
      expect(result!.assignedOperatorId).toBe(OP_2)
    })

    it('reassigns an OPEN dialog', async () => {
      const pool = createMockPool({
        findByIdDialog: makeDialogRow(DIALOG_1, 'OPEN'),
      })
      const presence = createMockPresenceService([OP_1])
      const service = new AssignmentService(pool, presence)

      const result = await service.reassign(DIALOG_1, OP_1)

      expect(result).not.toBeNull()
    })

    it('returns null for CLOSED dialog', async () => {
      const pool = createMockPool({
        findByIdDialog: makeDialogRow(DIALOG_1, 'CLOSED'),
        assignResult: null,
      })
      const presence = createMockPresenceService([OP_1])
      const service = new AssignmentService(pool, presence)

      const result = await service.reassign(DIALOG_1, OP_1)

      expect(result).toBeNull()
    })

    it('returns null when dialog not found', async () => {
      const pool = createMockPool({ findByIdDialog: null })
      const presence = createMockPresenceService([OP_1])
      const service = new AssignmentService(pool, presence)

      const result = await service.reassign('nonexistent', OP_1)

      expect(result).toBeNull()
    })
  })

  // ── Auto-assignment on new dialog ─────────────────────────────────────────

  describe('autoAssign()', () => {
    it('auto-assigns an OPEN dialog to the least-loaded operator', async () => {
      const pool = createMockPool({
        findByIdDialog: makeDialogRow(DIALOG_1, 'OPEN'),
        operatorLoad: [
          { operator_id: OP_1, active_count: 3 },
          { operator_id: OP_2, active_count: 1 },
        ],
      })
      const presence = createMockPresenceService([OP_1, OP_2])
      const service = new AssignmentService(pool, presence)

      const result = await service.autoAssign(DIALOG_1, TENANT_ID)

      expect(result).not.toBeNull()
      expect(result!.operatorId).toBe(OP_2) // least loaded
    })

    it('returns null for non-OPEN dialog', async () => {
      const pool = createMockPool({
        findByIdDialog: makeDialogRow(DIALOG_1, 'ASSIGNED', OP_1),
      })
      const presence = createMockPresenceService([OP_1, OP_2])
      const service = new AssignmentService(pool, presence)

      const result = await service.autoAssign(DIALOG_1, TENANT_ID)

      expect(result).toBeNull()
    })
  })

  // ── Queue size ────────────────────────────────────────────────────────────

  describe('getQueueSize()', () => {
    it('returns the count of unassigned dialogs', async () => {
      const pool = createMockPool({
        unassignedDialogs: [
          makeDialogRow(DIALOG_1, 'OPEN'),
          makeDialogRow(DIALOG_2, 'OPEN'),
          makeDialogRow(DIALOG_3, 'OPEN'),
        ],
      })
      const presence = createMockPresenceService([])
      const service = new AssignmentService(pool, presence)

      const count = await service.getQueueSize(TENANT_ID)

      expect(count).toBe(3)
    })
  })
})
