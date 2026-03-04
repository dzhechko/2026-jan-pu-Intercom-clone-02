/**
 * Tests for Telegram Adapter — FR-05 Telegram Channel
 *
 * Covers:
 *   - Webhook parsing of Telegram Update objects
 *   - Message creation from Telegram update
 *   - Outbound message formatting
 *   - Callback query handling
 *   - Skipping non-text updates
 */
import { TelegramAdapter, TelegramUpdate } from './telegram-adapter'
import { TelegramBotService } from '@integration/services/telegram-bot-service'

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

// Mock bot service
const mockSendMessage = jest.fn().mockResolvedValue({ ok: true })
const mockBotService = {
  sendMessage: mockSendMessage,
} as unknown as TelegramBotService

const TEST_TENANT_ID = '550e8400-e29b-41d4-a716-446655440000'

// ─── Test data ────────────────────────────────────────────────────────────────

function makeTextUpdate(overrides?: Partial<TelegramUpdate>): TelegramUpdate {
  return {
    update_id: 123456,
    message: {
      message_id: 1,
      from: { id: 12345, first_name: 'John', username: 'john_doe' },
      chat: { id: 12345, type: 'private' },
      date: 1234567890,
      text: 'Hello, question about pricing',
    },
    ...overrides,
  }
}

function makeCallbackQueryUpdate(): TelegramUpdate {
  return {
    update_id: 123457,
    callback_query: {
      id: 'cb_123',
      from: { id: 12345, first_name: 'John', username: 'john_doe' },
      message: {
        message_id: 1,
        chat: { id: 12345, type: 'private' },
        date: 1234567890,
        text: 'Previous bot message',
      },
      data: 'button_clicked',
    },
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter

  beforeEach(() => {
    jest.clearAllMocks()
    adapter = new TelegramAdapter(mockPool, mockIo, mockBotService, TEST_TENANT_ID)

    // Default: dialog already exists
    mockDialogFindByExternalId.mockResolvedValue({
      id: 'dialog-001',
      tenantId: TEST_TENANT_ID,
      channelType: 'TELEGRAM',
      externalChannelId: '12345',
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
      content: 'Hello, question about pricing',
      attachments: [],
      pqlSignals: [],
      createdAt: new Date(),
    })
  })

  describe('handleUpdate — text message', () => {
    it('should parse a text message and create an inbound message', async () => {
      const update = makeTextUpdate()
      const result = await adapter.handleUpdate(update)

      expect(result).toBe(true)
      expect(mockDialogFindByExternalId).toHaveBeenCalledWith(TEST_TENANT_ID, '12345')
      expect(mockMessageCreate).toHaveBeenCalledWith({
        dialogId: 'dialog-001',
        tenantId: TEST_TENANT_ID,
        direction: 'INBOUND',
        senderType: 'CLIENT',
        content: 'Hello, question about pricing',
      })
    })

    it('should create a new TELEGRAM dialog when none exists', async () => {
      mockDialogFindByExternalId.mockResolvedValue(null)
      mockDialogCreate.mockResolvedValue({
        id: 'dialog-new',
        tenantId: TEST_TENANT_ID,
        channelType: 'TELEGRAM',
        externalChannelId: '12345',
        status: 'OPEN',
        metadata: {
          telegramChatId: '12345',
          senderName: 'John',
          senderUsername: 'john_doe',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      await adapter.handleUpdate(makeTextUpdate())

      expect(mockDialogCreate).toHaveBeenCalledWith({
        tenantId: TEST_TENANT_ID,
        channelType: 'TELEGRAM',
        externalChannelId: '12345',
        metadata: {
          telegramChatId: '12345',
          senderName: 'John',
          senderUsername: 'john_doe',
        },
      })
    })

    it('should broadcast dialog:created when a new dialog is created', async () => {
      mockDialogFindByExternalId.mockResolvedValue(null)
      mockDialogCreate.mockResolvedValue({
        id: 'dialog-new',
        tenantId: TEST_TENANT_ID,
        channelType: 'TELEGRAM',
        externalChannelId: '12345',
        status: 'OPEN',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      await adapter.handleUpdate(makeTextUpdate())

      // dialog:created + message:new = 2 emit calls
      expect(mockEmit).toHaveBeenCalledWith('dialog:created', expect.any(Object))
      expect(mockEmit).toHaveBeenCalledWith('message:new', expect.any(Object))
    })

    it('should broadcast message:new to operators', async () => {
      await adapter.handleUpdate(makeTextUpdate())

      expect(mockTo).toHaveBeenCalledWith(`tenant:${TEST_TENANT_ID}`)
      expect(mockEmit).toHaveBeenCalledWith('message:new', expect.objectContaining({
        message: expect.any(Object),
        dialog: expect.any(Object),
      }))
    })

    it('should extract sender name from first_name and last_name', async () => {
      mockDialogFindByExternalId.mockResolvedValue(null)
      mockDialogCreate.mockResolvedValue({
        id: 'dialog-new',
        tenantId: TEST_TENANT_ID,
        channelType: 'TELEGRAM',
        externalChannelId: '99999',
        status: 'OPEN',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const update: TelegramUpdate = {
        update_id: 999,
        message: {
          message_id: 1,
          from: { id: 99999, first_name: 'Jane', last_name: 'Smith', username: 'janesmith' },
          chat: { id: 99999, type: 'private' },
          date: 1234567890,
          text: 'Hi there',
        },
      }

      await adapter.handleUpdate(update)

      expect(mockDialogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            senderName: 'Jane Smith',
            senderUsername: 'janesmith',
          }),
        }),
      )
    })
  })

  describe('handleUpdate — callback_query', () => {
    it('should handle callback_query and treat data as text', async () => {
      const update = makeCallbackQueryUpdate()
      const result = await adapter.handleUpdate(update)

      expect(result).toBe(true)
      expect(mockMessageCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'button_clicked',
          direction: 'INBOUND',
          senderType: 'CLIENT',
        }),
      )
    })
  })

  describe('handleUpdate — non-text updates', () => {
    it('should return false for updates without text or callback_query', async () => {
      const update: TelegramUpdate = {
        update_id: 123456,
        // No message, no callback_query
      }
      const result = await adapter.handleUpdate(update)
      expect(result).toBe(false)
    })

    it('should return false for messages without text (e.g., photo-only)', async () => {
      const update: TelegramUpdate = {
        update_id: 123456,
        message: {
          message_id: 1,
          from: { id: 12345, first_name: 'John' },
          chat: { id: 12345, type: 'private' },
          date: 1234567890,
          // No text field
        },
      }
      const result = await adapter.handleUpdate(update)
      expect(result).toBe(false)
    })
  })

  describe('sendReply — outbound to Telegram', () => {
    it('should send message via bot service', async () => {
      await adapter.sendReply('12345', 'Thanks for your question!')

      expect(mockSendMessage).toHaveBeenCalledWith('12345', 'Thanks for your question!')
    })

    it('should throw on Telegram API error', async () => {
      mockSendMessage.mockResolvedValue({
        ok: false,
        description: 'Bad Request: chat not found',
      })

      await expect(adapter.sendReply('99999', 'Hello')).rejects.toThrow(
        'Telegram API error: Bad Request: chat not found',
      )
    })
  })
})

describe('TelegramBotService', () => {
  // Save original fetch
  const originalFetch = global.fetch

  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  describe('sendMessage', () => {
    it('should POST to Telegram sendMessage endpoint', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true, result: { message_id: 42 } }),
      })
      global.fetch = mockFetch

      const service = new TelegramBotService('test-token-123')
      const result = await service.sendMessage(12345, 'Hello from operator')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-token-123/sendMessage',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: 12345,
            text: 'Hello from operator',
            parse_mode: 'HTML',
          }),
        },
      )
      expect(result.ok).toBe(true)
    })
  })

  describe('setWebhook', () => {
    it('should POST to Telegram setWebhook endpoint', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        json: () => Promise.resolve({ ok: true, result: true }),
      })
      global.fetch = mockFetch

      const service = new TelegramBotService('test-token-123')
      const result = await service.setWebhook('https://example.com/webhook')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-token-123/setWebhook',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ url: 'https://example.com/webhook' }),
        }),
      )
      expect(result.ok).toBe(true)
    })
  })

  describe('getMe', () => {
    it('should GET Telegram getMe endpoint', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        json: () =>
          Promise.resolve({
            ok: true,
            result: { id: 123, is_bot: true, first_name: 'TestBot', username: 'test_bot' },
          }),
      })
      global.fetch = mockFetch

      const service = new TelegramBotService('test-token-123')
      const result = await service.getMe()

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-token-123/getMe',
        undefined,
      )
      expect(result.ok).toBe(true)
      expect(result.result?.username).toBe('test_bot')
    })
  })

  describe('fromEnv', () => {
    it('should return null when TELEGRAM_BOT_TOKEN is not set', () => {
      delete process.env.TELEGRAM_BOT_TOKEN
      const service = TelegramBotService.fromEnv()
      expect(service).toBeNull()
    })

    it('should create service when TELEGRAM_BOT_TOKEN is set', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'env-token-456'
      const service = TelegramBotService.fromEnv()
      expect(service).toBeInstanceOf(TelegramBotService)
      delete process.env.TELEGRAM_BOT_TOKEN
    })
  })
})
