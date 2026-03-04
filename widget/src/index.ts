/**
 * KommuniQ Chat Widget — entry point
 *
 * Bundled with esbuild into public/widget.js (<30 KB minified).
 * Uses shadow DOM for full CSS isolation from the host page.
 *
 * Usage:
 *   <script src="https://cdn.kommuniq.ru/widget.js"></script>
 *   <script>
 *     KommuniQ.init({
 *       tenantId: 'xxx',
 *       apiUrl: 'https://api.kommuniq.ru',
 *       position: 'bottom-right',
 *       primaryColor: '#4F46E5',
 *       title: 'Support Chat',
 *       greeting: 'Hello! How can we help?'
 *     })
 *   </script>
 */

import { buildStyles } from './styles'
import { ChatSocket, InboundMessagePayload, TypingPayload } from './socket'

// ─── Config ──────────────────────────────────────────────────────────────────

export interface WidgetConfig {
  tenantId: string
  apiUrl: string
  position?: 'bottom-right' | 'bottom-left'
  primaryColor?: string
  title?: string
  greeting?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Stable per-session ID for this visitor (persisted in sessionStorage). */
function getOrCreateSessionId(): string {
  const KEY = 'kq_session_id'
  let id = sessionStorage.getItem(KEY)
  if (!id) {
    // Lightweight UUID v4-like without importing uuid library
    id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
    sessionStorage.setItem(KEY, id)
  }
  return id
}

// ─── Widget class ─────────────────────────────────────────────────────────────

class KommuniQWidget {
  private host!: HTMLElement
  private shadow!: ShadowRoot
  private windowEl!: HTMLElement
  private messagesEl!: HTMLElement
  private inputEl!: HTMLTextAreaElement
  private sendBtn!: HTMLButtonElement
  private typingEl!: HTMLElement
  private statusBar!: HTMLElement
  private unreadBadge!: HTMLElement

  private socket!: ChatSocket
  private config!: Required<WidgetConfig>
  private isOpen = false
  private dialogId: string | null = null
  private unreadCount = 0

  init(userConfig: WidgetConfig): void {
    const config: Required<WidgetConfig> = {
      tenantId: userConfig.tenantId,
      apiUrl: userConfig.apiUrl,
      position: userConfig.position ?? 'bottom-right',
      primaryColor: userConfig.primaryColor ?? '#4F46E5',
      title: userConfig.title ?? 'Support Chat',
      greeting: userConfig.greeting ?? 'Hello! How can we help?',
    }
    this.config = config

    this.buildDOM()
    this.attachEventListeners()

    this.socket = new ChatSocket(config.apiUrl, config.tenantId)
    this.socket.onMessage((payload) => this.handleInboundMessage(payload))
    this.socket.onTyping((payload) => this.handleTyping(payload))
    this.socket.onStatus((status) => this.handleStatus(status))
    this.socket.connect()
  }

  // ── DOM construction ────────────────────────────────────────────────────────

  private buildDOM(): void {
    // Host element appended to <body>
    this.host = document.createElement('div')
    this.host.id = 'kommuniq-widget'
    document.body.appendChild(this.host)

    this.shadow = this.host.attachShadow({ mode: 'open' })

    // Inject styles
    const styleEl = document.createElement('style')
    styleEl.textContent = buildStyles(this.config.primaryColor)
    this.shadow.appendChild(styleEl)

    // Launcher bubble
    const launcher = document.createElement('button')
    launcher.id = 'kq-launcher'
    launcher.setAttribute('aria-label', 'Open support chat')
    launcher.innerHTML = this.chatIconSVG()
    this.shadow.appendChild(launcher)

    // Unread badge
    this.unreadBadge = document.createElement('span')
    this.unreadBadge.id = 'kq-unread-badge'
    this.unreadBadge.classList.add('hidden')
    launcher.appendChild(this.unreadBadge)

    // Chat window
    this.windowEl = document.createElement('div')
    this.windowEl.id = 'kq-window'
    this.windowEl.classList.add('kq-hidden')
    this.windowEl.setAttribute('role', 'dialog')
    this.windowEl.setAttribute('aria-label', this.config.title)
    this.shadow.appendChild(this.windowEl)

    // Header
    const header = document.createElement('div')
    header.id = 'kq-header'
    header.innerHTML = `
      <div>
        <div id="kq-header-title">${this.escapeHtml(this.config.title)}</div>
        <div id="kq-header-subtitle">Online</div>
      </div>
      <button id="kq-close-btn" aria-label="Close chat">
        ${this.closeIconSVG()}
      </button>
    `
    this.windowEl.appendChild(header)

    // Status bar
    this.statusBar = document.createElement('div')
    this.statusBar.id = 'kq-status-bar'
    this.statusBar.classList.add('kq-connected')
    this.statusBar.textContent = 'Connecting…'
    this.windowEl.appendChild(this.statusBar)

    // Greeting
    const greeting = document.createElement('div')
    greeting.id = 'kq-greeting'
    greeting.textContent = this.config.greeting
    this.windowEl.appendChild(greeting)

    // Message list
    this.messagesEl = document.createElement('div')
    this.messagesEl.id = 'kq-messages'
    this.messagesEl.setAttribute('role', 'log')
    this.messagesEl.setAttribute('aria-live', 'polite')
    this.windowEl.appendChild(this.messagesEl)

    // Typing indicator
    this.typingEl = document.createElement('div')
    this.typingEl.id = 'kq-typing'
    this.windowEl.appendChild(this.typingEl)

    // Input area
    const inputArea = document.createElement('div')
    inputArea.id = 'kq-input-area'
    this.windowEl.appendChild(inputArea)

    this.inputEl = document.createElement('textarea')
    this.inputEl.id = 'kq-input'
    this.inputEl.rows = 1
    this.inputEl.placeholder = 'Type a message…'
    this.inputEl.setAttribute('aria-label', 'Message input')
    inputArea.appendChild(this.inputEl)

    this.sendBtn = document.createElement('button')
    this.sendBtn.id = 'kq-send-btn'
    this.sendBtn.setAttribute('aria-label', 'Send message')
    this.sendBtn.innerHTML = this.sendIconSVG()
    inputArea.appendChild(this.sendBtn)
  }

  // ── Event listeners ─────────────────────────────────────────────────────────

  private attachEventListeners(): void {
    // Launcher toggle
    const launcher = this.shadow.getElementById('kq-launcher')!
    launcher.addEventListener('click', () => this.toggle())

    // Close button
    const closeBtn = this.shadow.getElementById('kq-close-btn')!
    closeBtn.addEventListener('click', () => this.close())

    // Send button
    this.sendBtn.addEventListener('click', () => this.sendMessage())

    // Textarea: Enter to send (Shift+Enter for newline), auto-resize
    this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        this.sendMessage()
      }
    })

    this.inputEl.addEventListener('input', () => {
      this.autoResizeTextarea()
      if (this.dialogId) {
        this.socket.sendTyping(this.dialogId, this.inputEl.value.length > 0)
      }
    })
  }

  // ── Public methods ──────────────────────────────────────────────────────────

  open(): void {
    this.isOpen = true
    this.windowEl.classList.remove('kq-hidden')
    this.inputEl.focus()
    this.clearUnread()
  }

  close(): void {
    this.isOpen = false
    this.windowEl.classList.add('kq-hidden')
    const launcher = this.shadow.getElementById('kq-launcher')!
    launcher.innerHTML = this.chatIconSVG()
    launcher.appendChild(this.unreadBadge)
  }

  toggle(): void {
    this.isOpen ? this.close() : this.open()
  }

  // ── Message handling ────────────────────────────────────────────────────────

  private sendMessage(): void {
    const content = this.inputEl.value.trim()
    if (!content) return

    this.inputEl.value = ''
    this.autoResizeTextarea()

    // Optimistically render the outbound message
    this.appendMessage({
      content,
      direction: 'OUTBOUND',
      senderType: 'CLIENT',
      createdAt: new Date(),
    })

    this.socket.sendMessage({
      content,
      tenantId: this.config.tenantId,
      externalChannelId: getOrCreateSessionId(),
    })
  }

  private handleInboundMessage(payload: InboundMessagePayload): void {
    const { message, dialogId } = payload

    // Track dialog id for typing events
    if (dialogId && !this.dialogId) {
      this.dialogId = dialogId
    }
    if (message.dialogId && !this.dialogId) {
      this.dialogId = message.dialogId
    }

    // Only render inbound (operator/bot → client) messages;
    // outbound ones were already rendered optimistically.
    if (message.direction === 'INBOUND') return

    this.appendMessage({
      content: message.content,
      direction: 'INBOUND',
      senderType: message.senderType,
      createdAt: new Date(message.createdAt),
    })

    if (!this.isOpen) {
      this.incrementUnread()
    }
  }

  private appendMessage(opts: {
    content: string
    direction: 'INBOUND' | 'OUTBOUND'
    senderType: string
    createdAt: Date
  }): void {
    const msgEl = document.createElement('div')
    msgEl.classList.add(
      'kq-msg',
      opts.direction === 'OUTBOUND' ? 'kq-msg-outbound' : 'kq-msg-inbound',
    )

    const text = document.createElement('span')
    text.textContent = opts.content

    const time = document.createElement('span')
    time.classList.add('kq-msg-time')
    time.textContent = formatTime(opts.createdAt)

    msgEl.appendChild(text)
    msgEl.appendChild(time)
    this.messagesEl.appendChild(msgEl)
    this.scrollToBottom()
  }

  private handleTyping(payload: TypingPayload): void {
    if (payload.senderType !== 'OPERATOR') return

    if (payload.isTyping) {
      this.typingEl.innerHTML = `<span class="kq-dots"><span></span><span></span><span></span></span> Agent is typing…`
    } else {
      this.typingEl.innerHTML = ''
    }
  }

  private handleStatus(status: 'connecting' | 'connected' | 'disconnected'): void {
    if (status === 'connected') {
      this.statusBar.className = 'kq-connected'
      this.statusBar.textContent = ''
    } else if (status === 'disconnected') {
      this.statusBar.className = 'kq-offline'
      this.statusBar.textContent = 'Reconnecting…'
    } else {
      this.statusBar.className = 'kq-offline'
      this.statusBar.textContent = 'Connecting…'
    }
  }

  // ── Utility ─────────────────────────────────────────────────────────────────

  private scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight
  }

  private autoResizeTextarea(): void {
    this.inputEl.style.height = 'auto'
    this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 120)}px`
  }

  private incrementUnread(): void {
    this.unreadCount++
    this.unreadBadge.textContent = this.unreadCount > 99 ? '99+' : String(this.unreadCount)
    this.unreadBadge.classList.remove('hidden')
  }

  private clearUnread(): void {
    this.unreadCount = 0
    this.unreadBadge.classList.add('hidden')
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // ── SVG icons ────────────────────────────────────────────────────────────────

  private chatIconSVG(): string {
    return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
    </svg>`
  }

  private closeIconSVG(): string {
    return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
    </svg>`
  }

  private sendIconSVG(): string {
    return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
    </svg>`
  }
}

// ─── Global singleton ─────────────────────────────────────────────────────────

const KommuniQ = new KommuniQWidget()

// Expose on window
declare global {
  interface Window {
    KommuniQ: KommuniQWidget
  }
}

window.KommuniQ = KommuniQ
