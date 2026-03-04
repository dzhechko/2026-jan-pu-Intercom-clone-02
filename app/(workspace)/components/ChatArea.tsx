'use client'

import { useState, useRef, useEffect, FormEvent } from 'react'
import type { Message, SenderType } from '../types'

function senderBadge(senderType: SenderType) {
  const map: Record<SenderType, { label: string; color: string }> = {
    CLIENT: { label: 'Client', color: 'bg-gray-200 text-gray-600' },
    OPERATOR: { label: 'Operator', color: 'bg-blue-100 text-blue-700' },
    BOT: { label: 'Bot', color: 'bg-purple-100 text-purple-700' },
  }
  const badge = map[senderType]
  return (
    <span className={`text-[10px] px-1 py-0.5 rounded ${badge.color}`}>
      {badge.label}
    </span>
  )
}

function formatTime(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

interface ChatAreaProps {
  messages: Message[]
  loading: boolean
  typingIndicator: boolean
  onSendMessage: (content: string) => Promise<void>
  onTyping: (isTyping: boolean) => void
  dialogId: string | null
}

export function ChatArea({
  messages,
  loading,
  typingIndicator,
  onSendMessage,
  onTyping,
  dialogId,
}: ChatAreaProps) {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, typingIndicator])

  // Clear input when dialog changes
  useEffect(() => {
    setInput('')
  }, [dialogId])

  const handleInputChange = (value: string) => {
    setInput(value)

    // Send typing indicator with debounce
    onTyping(true)
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = setTimeout(() => onTyping(false), 2000)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!input.trim() || sending) return

    const content = input.trim()
    setInput('')
    setSending(true)
    onTyping(false)

    try {
      await onSendMessage(content)
    } catch (err) {
      console.error('[ChatArea] send error:', err)
      setInput(content) // Restore on failure
    } finally {
      setSending(false)
    }
  }

  if (!dialogId) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="text-center">
          <p className="text-lg font-medium mb-1">Select a conversation</p>
          <p className="text-sm">Choose a dialog from the sidebar to start</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {loading && (
          <div className="text-center text-gray-400 text-sm py-4">Loading messages...</div>
        )}

        {!loading && messages.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-4">No messages yet</div>
        )}

        {messages.map((msg) => {
          const isInbound = msg.direction === 'INBOUND'
          return (
            <div
              key={msg.id}
              className={`flex ${isInbound ? 'justify-start' : 'justify-end'}`}
              data-testid={`message-${msg.id}`}
            >
              <div
                className={`max-w-[70%] rounded-lg px-3 py-2 ${
                  isInbound
                    ? 'bg-gray-100 text-gray-900'
                    : 'bg-blue-500 text-white'
                }`}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  {senderBadge(msg.senderType)}
                  <span className={`text-[10px] ${isInbound ? 'text-gray-400' : 'text-blue-100'}`}>
                    {formatTime(msg.createdAt)}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
              </div>
            </div>
          )
        })}

        {typingIndicator && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg px-3 py-2 text-sm text-gray-500">
              <span className="inline-flex gap-1">
                <span className="animate-bounce">.</span>
                <span className="animate-bounce" style={{ animationDelay: '0.1s' }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>.</span>
              </span>
              {' '}typing
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <form onSubmit={handleSubmit} className="border-t border-gray-200 px-4 py-3 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          disabled={sending}
          data-testid="message-input"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          data-testid="send-button"
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </form>
    </div>
  )
}
