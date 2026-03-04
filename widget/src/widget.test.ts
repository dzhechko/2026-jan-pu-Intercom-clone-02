/**
 * @jest-environment jsdom
 *
 * Basic widget tests — DOM construction and config validation.
 * Uses jsdom for browser-like DOM APIs.
 */

// We test the low-level building blocks rather than the full widget class
// because esbuild bundles the widget for production; Jest tests the source.

import { buildStyles } from './styles'
import { ChatSocket } from './socket'

// ─── Style tests ─────────────────────────────────────────────────────────────

describe('buildStyles', () => {
  it('injects the provided primaryColor', () => {
    const css = buildStyles('#FF0000')
    expect(css).toContain('#FF0000')
  })

  it('includes launcher and window selectors', () => {
    const css = buildStyles('#4F46E5')
    expect(css).toContain('#kq-launcher')
    expect(css).toContain('#kq-window')
    expect(css).toContain('#kq-messages')
    expect(css).toContain('#kq-input')
  })

  it('includes animation for typing dots', () => {
    const css = buildStyles('#4F46E5')
    expect(css).toContain('kq-bounce')
    expect(css).toContain('@keyframes')
  })

  it('generates different CSS for different colors', () => {
    const a = buildStyles('#FF0000')
    const b = buildStyles('#00FF00')
    expect(a).not.toEqual(b)
  })
})

// ─── ChatSocket tests ─────────────────────────────────────────────────────────

// Mock socket.io-client
jest.mock('socket.io-client', () => {
  const mockSocket = {
    connected: false,
    on: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  }
  return { io: jest.fn(() => mockSocket) }
})

describe('ChatSocket', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('initialises with disconnected status', () => {
    const socket = new ChatSocket('https://api.test', 'tenant-123')
    expect(socket.getStatus()).toBe('disconnected')
  })

  it('calls status handler immediately on onStatus registration', () => {
    const socket = new ChatSocket('https://api.test', 'tenant-123')
    const handler = jest.fn()
    socket.onStatus(handler)
    expect(handler).toHaveBeenCalledWith('disconnected')
  })

  it('queues messages when not connected', () => {
    const socket = new ChatSocket('https://api.test', 'tenant-123')
    const { io } = require('socket.io-client') as { io: jest.Mock }

    // connect() will set socket internally but socket.connected stays false
    socket.connect()
    const mockSocket = io.mock.results[0].value

    socket.sendMessage({
      content: 'hello',
      tenantId: 'tenant-123',
      externalChannelId: 'session-1',
    })

    // emit should not have been called because socket.connected is false
    expect(mockSocket.emit).not.toHaveBeenCalledWith('client:message', expect.anything())
  })

  it('registers event handlers on connect', () => {
    const socket = new ChatSocket('https://api.test', 'tenant-123')
    const { io } = require('socket.io-client') as { io: jest.Mock }
    socket.connect()
    const mockSocket = io.mock.results[0].value

    const events = (mockSocket.on as jest.Mock).mock.calls.map(
      (call: [string, unknown]) => call[0],
    )
    expect(events).toContain('connect')
    expect(events).toContain('disconnect')
    expect(events).toContain('message:new')
    expect(events).toContain('typing')
  })

  it('connects to /chat namespace', () => {
    const { io } = require('socket.io-client') as { io: jest.Mock }
    const socket = new ChatSocket('https://api.example.com', 'tenant-abc')
    socket.connect()
    expect(io).toHaveBeenCalledWith(
      'https://api.example.com/chat',
      expect.objectContaining({
        auth: expect.objectContaining({ tenantId: 'tenant-abc' }),
      }),
    )
  })

  it('notifies message handlers on message:new', () => {
    const { io } = require('socket.io-client') as { io: jest.Mock }
    const socket = new ChatSocket('https://api.test', 'tenant-123')
    socket.connect()
    const mockSocket = io.mock.results[0].value

    const handler = jest.fn()
    socket.onMessage(handler)

    // Simulate server emitting message:new
    const onCalls = (mockSocket.on as jest.Mock).mock.calls as [
      string,
      (payload: unknown) => void,
    ][]
    const messageNewHandler = onCalls.find(([event]) => event === 'message:new')?.[1]
    const fakePayload = {
      message: {
        id: 'msg-1',
        dialogId: 'dlg-1',
        tenantId: 'tenant-123',
        direction: 'OUTBOUND',
        senderType: 'OPERATOR',
        content: 'Hi there!',
        attachments: [],
        pqlSignals: [],
        createdAt: new Date().toISOString(),
      },
    }
    messageNewHandler?.(fakePayload)
    expect(handler).toHaveBeenCalledWith(fakePayload)
  })

  it('notifies typing handlers on typing event', () => {
    const { io } = require('socket.io-client') as { io: jest.Mock }
    const socket = new ChatSocket('https://api.test', 'tenant-123')
    socket.connect()
    const mockSocket = io.mock.results[0].value

    const handler = jest.fn()
    socket.onTyping(handler)

    const onCalls = (mockSocket.on as jest.Mock).mock.calls as [
      string,
      (payload: unknown) => void,
    ][]
    const typingHandler = onCalls.find(([event]) => event === 'typing')?.[1]
    const fakePayload = { dialogId: 'dlg-1', isTyping: true, senderType: 'OPERATOR' }
    typingHandler?.(fakePayload)
    expect(handler).toHaveBeenCalledWith(fakePayload)
  })

  it('does not create duplicate sockets on multiple connect() calls', () => {
    const { io } = require('socket.io-client') as { io: jest.Mock }
    const socket = new ChatSocket('https://api.test', 'tenant-123')
    // Make the mock socket appear connected
    socket.connect()
    const mockSocket = io.mock.results[0].value
    mockSocket.connected = true

    socket.connect() // second call — should be a no-op
    expect(io).toHaveBeenCalledTimes(1)
  })
})

// ─── DOM sanity tests ─────────────────────────────────────────────────────────

describe('Widget DOM (manual construction)', () => {
  it('sessionStorage is available in jsdom', () => {
    expect(typeof sessionStorage).toBe('object')
    sessionStorage.setItem('kq_test', 'val')
    expect(sessionStorage.getItem('kq_test')).toBe('val')
  })

  it('shadow DOM can be attached in jsdom', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const inner = document.createElement('span')
    inner.textContent = 'test'
    shadow.appendChild(inner)
    expect(shadow.querySelector('span')?.textContent).toBe('test')
    document.body.removeChild(host)
  })
})
