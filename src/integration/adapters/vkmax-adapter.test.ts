/**
 * Tests for VK Max Adapter — FR-09 VK Max Channel
 *
 * Covers:
 *   - Webhook parsing of VK Max Update objects
 *   - Dialog creation with VK_MAX channel
 *   - Message creation from VK Max update
 *   - Outbound message forwarding
 *   - Circuit breaker behavior
 *   - Skipping non-message_new updates
 */
import { VKMaxAdapter, VKMaxUpdate } from './vkmax-adapter'
import { VKMaxMCPService } from '@integration/services/vkmax-mcp-service'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockDialogCreate = jest.fn()
const mockDialogFindByExternalId = jest.fn()
const mockMessageCreate = jest.fn()

jest.mock('@conversation/infrastructure/repositories/dialog-repository', () => ({
  DialogRepository: jest.fn().mockImplementation(() => ({
    create: mockDialogCreate,
    findByExternalId: mockDialogFindByExternalId,
    findById: jest.fn(),
  })),
}))

jest.mock('@conversation/infrastructure/repositories/message-repository', () => ({
  MessageRepository: jest.fn().mockImplementation(() => ({
    create: mockMessageCreate,
  })),
}))

// Mock Socket.io
const mockEmit = jest.fn()
const mockTo = jest.fn().mockReturnValue({ emit: mockEmit })
const mockIo = {
  of: jest.fn().mockReturnValue({
    to: mockTo,
  }),
} as any

// Mock pool
const mockPool = {} as any

// Mock MCP service
const mockSendMessage = jest.fn().mockResolvedValue({ ok: true, messageId: 12345 })
const mockMCPService = {
  sendMessage: mockSendMessage,
  isCircuitOpen: jest.fn().mockReturnValue(false),
} as unknown as VKMaxMCPService

const TEST_TENANT_ID = '550e8400-e29b-41d4-a716-446655440000'

// ─── Test data ────────────────────────────────────────────────────────────────

function makeMessageNewUpdate(overrides?: Partial<VKMaxUpdate>): VKMaxUpdate {
  return {
    type: 'message_new',
    object: {
      message: {
        peer_id: 2000000001,
        from_id: 12345,
        text: 'Привет, вопрос по API',
        date: 1234567890,
      },
    },
    group_id: 123456,
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('VKMaxAdapter', () => {
  let adapter: VKMaxAdapter

  beforeEach(() => {
    jest.clearAllMocks()
    adapter = new VKMaxAdapter(mockPool, mockIo, mockMCPService, TEST_TENANT_ID)

    // Default: dialog already exists
    mockDialogFindByExternalId.mockResolvedValue({
      id: 'dialog-001',
      tenantId: TEST_TENANT_ID,
      channelType: 'VK_MAX',
      externalChannelId: '2000000001',
      status: 'OPEN',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    mockMessageCreate.mockResolvedValue({
      id: 'msg-001',
      dialogId: 'dialog-001',
      tenantId: TEST_TENANT_ID,
      direction: 'INBOUND',
      senderType: 'CLIENT',
      content: 'Привет, вопрос по API',
      attachments: [],
      pqlSignals: [],
      createdAt: new Date(),
    })
  })

  describe('handleUpdate — message_new', () => {
    it('should parse a message_new update and create an inbound message', async () => {
      const update = makeMessageNewUpdate()
      const result = await adapter.handleUpdate(update)

      expect(result).toBe(true)
      expect(mockDialogFindByExternalId).toHaveBeenCalledWith(TEST_TENANT_ID, '2000000001')
      expect(mockMessageCreate).toHaveBeenCalledWith({
        dialogId: 'dialog-001',
        tenantId: TEST_TENANT_ID,
        direction: 'INBOUND',
        senderType: 'CLIENT',
        content: 'Привет, вопрос по API',
      })
    })

    it('should create a new VK_MAX dialog when none exists', async () => {
      mockDialogFindByExternalId.mockResolvedValue(null)
      mockDialogCreate.mockResolvedValue({
        id: 'dialog-new',
        tenantId: TEST_TENANT_ID,
        channelType: 'VK_MAX',
        externalChannelId: '2000000001',
        status: 'OPEN',
        metadata: {
          vkMaxPeerId: '2000000001',
          vkMaxFromId: '12345',
          vkMaxGroupId: '123456',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      await adapter.handleUpdate(makeMessageNewUpdate())

      expect(mockDialogCreate).toHaveBeenCalledWith({
        tenantId: TEST_TENANT_ID,
        channelType: 'VK_MAX',
        externalChannelId: '2000000001',
        metadata: {
          vkMaxPeerId: '2000000001',
          vkMaxFromId: '12345',
          vkMaxGroupId: '123456',
        },
      })
    })

    it('should broadcast dialog:created when a new dialog is created', async () => {
      mockDialogFindByExternalId.mockResolvedValue(null)
      mockDialogCreate.mockResolvedValue({
        id: 'dialog-new',
        tenantId: TEST_TENANT_ID,
        channelType: 'VK_MAX',
        externalChannelId: '2000000001',
        status: 'OPEN',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      await adapter.handleUpdate(makeMessageNewUpdate())

      // dialog:created + message:new = 2 emit calls
      expect(mockEmit).toHaveBeenCalledWith('dialog:created', expect.any(Object))
      expect(mockEmit).toHaveBeenCalledWith('message:new', expect.any(Object))
    })

    it('should broadcast message:new to operators', async () => {
      await adapter.handleUpdate(makeMessageNewUpdate())

      expect(mockTo).toHaveBeenCalledWith(`tenant:${TEST_TENANT_ID}`)
      expect(mockEmit).toHaveBeenCalledWith('message:new', expect.objectContaining({
        message: expect.any(Object),
        dialog: expect.any(Object),
      }))
    })

    it('should store vkMaxPeerId, vkMaxFromId, and vkMaxGroupId in metadata', async () => {
      mockDialogFindByExternalId.mockResolvedValue(null)
      mockDialogCreate.mockResolvedValue({
        id: 'dialog-new',
        tenantId: TEST_TENANT_ID,
        channelType: 'VK_MAX',
        externalChannelId: '2000000001',
        status: 'OPEN',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      await adapter.handleUpdate(makeMessageNewUpdate())

      expect(mockDialogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            vkMaxPeerId: '2000000001',
            vkMaxFromId: '12345',
            vkMaxGroupId: '123456',
          }),
        }),
      )
    })
  })

  describe('handleUpdate — non-message_new updates', () => {
    it('should return false for unknown event types', async () => {
      const update: VKMaxUpdate = {
        type: 'group_join',
        object: {
          message: {
            peer_id: 2000000001,
            from_id: 12345,
            text: '',
            date: 1234567890,
          },
        },
        group_id: 123456,
      }
      const result = await adapter.handleUpdate(update)
      expect(result).toBe(false)
    })

    it('should return false for message_new without text', async () => {
      const update: VKMaxUpdate = {
        type: 'message_new',
        object: {
          message: {
            peer_id: 2000000001,
            from_id: 12345,
            text: '',
            date: 1234567890,
          },
        },
        group_id: 123456,
      }
      const result = await adapter.handleUpdate(update)
      expect(result).toBe(false)
    })
  })

  describe('sendReply — outbound to VK Max', () => {
    it('should send message via MCP service', async () => {
      await adapter.sendReply('2000000001', 'Спасибо за ваш вопрос!')

      expect(mockSendMessage).toHaveBeenCalledWith('2000000001', 'Спасибо за ваш вопрос!')
    })

    it('should throw on VK Max MCP error', async () => {
      mockSendMessage.mockResolvedValue({
        ok: false,
        description: 'Peer not found',
      })

      await expect(adapter.sendReply('99999', 'Hello')).rejects.toThrow(
        'VK Max MCP error: Peer not found',
      )
    })
  })
})

describe('VKMaxMCPService', () => {
  describe('fromEnv', () => {
    it('should return null when VKMAX_MCP_URL is not set', () => {
      delete process.env.VKMAX_MCP_URL
      delete process.env.VKMAX_ACCESS_TOKEN
      const service = VKMaxMCPService.fromEnv()
      expect(service).toBeNull()
    })

    it('should return null when only VKMAX_MCP_URL is set (no token)', () => {
      process.env.VKMAX_MCP_URL = 'https://mcp.example.com'
      delete process.env.VKMAX_ACCESS_TOKEN
      const service = VKMaxMCPService.fromEnv()
      expect(service).toBeNull()
      delete process.env.VKMAX_MCP_URL
    })

    it('should create service when both env vars are set', () => {
      process.env.VKMAX_MCP_URL = 'https://mcp.example.com'
      process.env.VKMAX_ACCESS_TOKEN = 'test-token-456'
      const service = VKMaxMCPService.fromEnv()
      expect(service).toBeInstanceOf(VKMaxMCPService)
      delete process.env.VKMAX_MCP_URL
      delete process.env.VKMAX_ACCESS_TOKEN
    })
  })

  describe('circuit breaker', () => {
    it('should report circuit breaker status', () => {
      const service = new VKMaxMCPService('', 'test-token')
      // Initially the circuit should be closed
      expect(service.isCircuitOpen()).toBe(false)
    })

    it('should send messages via mock when mcpUrl is empty', async () => {
      const service = new VKMaxMCPService('', 'test-token')
      const result = await service.sendMessage('2000000001', 'Test message')
      expect(result.ok).toBe(true)
      expect(result.messageId).toBeDefined()
    })
  })
})
