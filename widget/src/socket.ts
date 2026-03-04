/**
 * Socket.io connection handler for the KommuniQ chat widget.
 *
 * - Connects to the /chat namespace
 * - Queues outbound messages while offline (up to 50 items)
 * - Exponential backoff reconnection (managed by socket.io-client)
 * - Typed event emitter wrapper
 */
import { io, Socket } from 'socket.io-client'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface OutboundMessage {
  content: string
  tenantId: string
  externalChannelId: string
  contactEmail?: string
  metadata?: Record<string, unknown>
}

export interface InboundMessagePayload {
  message: {
    id: string
    dialogId: string
    tenantId: string
    direction: 'INBOUND' | 'OUTBOUND'
    senderType: 'CLIENT' | 'OPERATOR' | 'BOT'
    content: string
    attachments: unknown[]
    pqlSignals: unknown[]
    createdAt: string
  }
  dialogId?: string
}

export interface TypingPayload {
  dialogId: string
  isTyping: boolean
  senderType: 'CLIENT' | 'OPERATOR'
}

export type MessageHandler = (payload: InboundMessagePayload) => void
export type TypingHandler = (payload: TypingPayload) => void
export type StatusHandler = (status: ConnectionStatus) => void

const QUEUE_MAX = 50

export class ChatSocket {
  private socket: Socket | null = null
  private queue: OutboundMessage[] = []
  private onMessageHandlers: MessageHandler[] = []
  private onTypingHandlers: TypingHandler[] = []
  private onStatusHandlers: StatusHandler[] = []
  private currentStatus: ConnectionStatus = 'disconnected'
  private typingTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly apiUrl: string,
    private readonly tenantId: string,
    private readonly dialogId?: string,
  ) {}

  connect(): void {
    if (this.socket?.connected) return

    this.setStatus('connecting')

    this.socket = io(`${this.apiUrl}/chat`, {
      path: '/socket.io/',
      auth: {
        tenantId: this.tenantId,
        dialogId: this.dialogId,
      },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.3,
    })

    this.socket.on('connect', () => {
      this.setStatus('connected')
      this.flushQueue()
    })

    this.socket.on('disconnect', () => {
      this.setStatus('disconnected')
    })

    this.socket.on('connect_error', () => {
      this.setStatus('disconnected')
    })

    this.socket.on('message:new', (payload: InboundMessagePayload) => {
      this.onMessageHandlers.forEach((h) => h(payload))
    })

    this.socket.on('typing', (payload: TypingPayload) => {
      this.onTypingHandlers.forEach((h) => h(payload))
    })

    this.socket.on('error', (err: { code: string; details?: unknown }) => {
      console.warn('[KommuniQ widget] socket error', err)
    })
  }

  /**
   * Send a client message. Queues if disconnected.
   */
  sendMessage(params: OutboundMessage): void {
    if (this.socket?.connected) {
      this.socket.emit('client:message', params)
    } else {
      if (this.queue.length < QUEUE_MAX) {
        this.queue.push(params)
      }
    }
  }

  /**
   * Emit a typing indicator (debounced: stops after 3s of inactivity).
   */
  sendTyping(dialogId: string, isTyping: boolean): void {
    if (!this.socket?.connected) return
    this.socket.emit('typing', {
      dialogId,
      tenantId: this.tenantId,
      isTyping,
      senderType: 'CLIENT',
    })

    if (isTyping) {
      if (this.typingTimer) clearTimeout(this.typingTimer)
      this.typingTimer = setTimeout(() => {
        this.sendTyping(dialogId, false)
      }, 3000)
    }
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
    this.setStatus('disconnected')
  }

  onMessage(handler: MessageHandler): void {
    this.onMessageHandlers.push(handler)
  }

  onTyping(handler: TypingHandler): void {
    this.onTypingHandlers.push(handler)
  }

  onStatus(handler: StatusHandler): void {
    this.onStatusHandlers.push(handler)
    // Immediately notify with current status
    handler(this.currentStatus)
  }

  getStatus(): ConnectionStatus {
    return this.currentStatus
  }

  private setStatus(status: ConnectionStatus): void {
    this.currentStatus = status
    this.onStatusHandlers.forEach((h) => h(status))
  }

  private flushQueue(): void {
    const queued = this.queue.splice(0)
    queued.forEach((msg) => {
      this.socket!.emit('client:message', msg)
    })
  }
}
