'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSocket } from './hooks/useSocket'
import { useDialogs } from './hooks/useDialogs'
import { useMessages } from './hooks/useMessages'
import { useKeyboardShortcuts, type KeyboardShortcutActions } from './hooks/useKeyboardShortcuts'
import { DialogList } from './components/DialogList'
import { ChatArea } from './components/ChatArea'
import { RightPanel } from './components/RightPanel'
import { ShortcutHelp } from './components/ShortcutHelp'
import { NotificationBell } from './components/NotificationBell'
import { useNotifications } from './hooks/useNotifications'
import { QUICK_REPLY_TEMPLATES } from './constants/quickReplies'
import type { OperatorProfile, Dialog } from './types'

const TOKEN_KEY = 'kommuniq_token'
const OPERATOR_KEY = 'kommuniq_operator'

export default function WorkspacePage() {
  const [token, setToken] = useState('')
  const [operator, setOperator] = useState<OperatorProfile | null>(null)
  const [selectedDialogId, setSelectedDialogId] = useState<string | null>(null)

  // Load auth from localStorage
  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY) ?? ''
    const storedOp = localStorage.getItem(OPERATOR_KEY)
    setToken(storedToken)
    if (storedOp) {
      try {
        setOperator(JSON.parse(storedOp))
      } catch {
        // Ignore parse errors
      }
    }
  }, [])

  // Socket connection
  const { connected, emit, on } = useSocket({
    token,
    tenantId: operator?.tenantId ?? '',
    operatorId: operator?.id ?? '',
  })

  // FR-11: Notifications
  const { notifications, unreadCount, markAsRead } = useNotifications({
    token,
    on,
  })

  // Dialogs
  const { dialogs, loading: dialogsLoading, clearUnread } = useDialogs({
    token,
    on,
  })

  // Messages for selected dialog
  const { messages, loading: messagesLoading, typingIndicator, sendMessage, sendTyping } =
    useMessages({
      dialogId: selectedDialogId,
      token,
      tenantId: operator?.tenantId ?? '',
      on,
      emit,
    })

  // Select a dialog
  const handleSelectDialog = useCallback(
    (id: string) => {
      setSelectedDialogId(id)
      clearUnread(id)
    },
    [clearUnread],
  )

  // Get selected dialog object
  const selectedDialog: Dialog | null =
    dialogs.find((d) => d.id === selectedDialogId) ?? null

  // Dialog actions
  const handleAssign = useCallback(
    async (dialogId: string) => {
      if (!operator) return
      emit('dialog:assign', {
        dialogId,
        tenantId: operator.tenantId,
        operatorId: operator.id,
      })
    },
    [operator, emit],
  )

  const handleCloseDialog = useCallback(
    async (dialogId: string) => {
      try {
        await fetch(`/api/proxy/dialogs/${dialogId}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status: 'CLOSED' }),
        })
      } catch (err) {
        console.error('[Workspace] close dialog error:', err)
      }
    },
    [token],
  )

  const handleChangeStatus = useCallback(
    async (dialogId: string, status: string) => {
      try {
        await fetch(`/api/proxy/dialogs/${dialogId}/status`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ status }),
        })
      } catch (err) {
        console.error('[Workspace] change status error:', err)
      }
    },
    [token],
  )

  const handleQuickReply = useCallback(
    (content: string) => {
      if (selectedDialogId) {
        sendMessage(content)
      }
    },
    [selectedDialogId, sendMessage],
  )

  const handleLogout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(OPERATOR_KEY)
    window.location.href = '/login'
  }, [])

  // FR-14: Keyboard shortcuts state
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sendMessageRef = useRef<(() => void) | null>(null)

  // Dialog navigation helpers
  const dialogIds = useMemo(() => dialogs.map((d) => d.id), [dialogs])

  const navigateDialog = useCallback(
    (direction: 'prev' | 'next') => {
      if (dialogIds.length === 0) return
      if (!selectedDialogId) {
        handleSelectDialog(dialogIds[0])
        return
      }
      const currentIdx = dialogIds.indexOf(selectedDialogId)
      if (currentIdx === -1) {
        handleSelectDialog(dialogIds[0])
        return
      }
      const nextIdx =
        direction === 'next'
          ? Math.min(currentIdx + 1, dialogIds.length - 1)
          : Math.max(currentIdx - 1, 0)
      handleSelectDialog(dialogIds[nextIdx])
    },
    [dialogIds, selectedDialogId, handleSelectDialog],
  )

  const jumpToNextUnassigned = useCallback(() => {
    const unassigned = dialogs.find(
      (d) => d.status === 'OPEN' && !d.assignedOperatorId && d.id !== selectedDialogId,
    )
    if (unassigned) {
      handleSelectDialog(unassigned.id)
    }
  }, [dialogs, selectedDialogId, handleSelectDialog])

  // FR-14: Keyboard shortcut actions
  const shortcutActions = useMemo<KeyboardShortcutActions>(
    () => ({
      onSendMessage: () => sendMessageRef.current?.(),
      onFocusSearch: () => searchInputRef.current?.focus(),
      onPreviousDialog: () => navigateDialog('prev'),
      onNextDialog: () => navigateDialog('next'),
      onNextUnassigned: jumpToNextUnassigned,
      onAssignDialog: () => {
        if (selectedDialogId && selectedDialog && selectedDialog.status === 'OPEN') {
          handleAssign(selectedDialogId)
        }
      },
      onCloseDialog: () => {
        if (selectedDialogId && selectedDialog && selectedDialog.status !== 'CLOSED' && selectedDialog.status !== 'ARCHIVED') {
          handleCloseDialog(selectedDialogId)
        }
      },
      onEscape: () => {
        if (shortcutHelpOpen) {
          setShortcutHelpOpen(false)
        } else {
          setSelectedDialogId(null)
        }
      },
      onQuickReply: (index: number) => {
        if (selectedDialogId && index >= 0 && index < QUICK_REPLY_TEMPLATES.length) {
          sendMessage(QUICK_REPLY_TEMPLATES[index].content)
        }
      },
      onToggleHelp: () => setShortcutHelpOpen((prev) => !prev),
    }),
    [
      navigateDialog,
      jumpToNextUnassigned,
      selectedDialogId,
      selectedDialog,
      handleAssign,
      handleCloseDialog,
      sendMessage,
      shortcutHelpOpen,
    ],
  )

  useKeyboardShortcuts({ actions: shortcutActions })

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Top bar */}
      <header className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold text-gray-900">KommuniQ</h1>
          <span className="text-xs text-gray-400">Operator Workspace</span>
          <span
            className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`}
            title={connected ? 'Connected' : 'Disconnected'}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShortcutHelpOpen(true)}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors border border-gray-200 rounded px-1.5 py-0.5 font-mono"
            title="Keyboard shortcuts (?)"
            data-testid="shortcut-help-trigger"
          >
            ?
          </button>
          <NotificationBell
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkAsRead={markAsRead}
            onSelectDialog={handleSelectDialog}
          />
          <span className="text-xs text-gray-500">{operator?.email}</span>
          <button
            onClick={handleLogout}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Log out
          </button>
        </div>
      </header>

      {/* Three-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar: Dialog list */}
        <aside className="w-80 bg-white border-r border-gray-200 flex flex-col shrink-0">
          <div className="px-4 py-3 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-700">Conversations</h2>
            <p className="text-xs text-gray-400">{dialogs.length} open</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            <DialogList
              dialogs={dialogs}
              selectedId={selectedDialogId}
              onSelect={handleSelectDialog}
              loading={dialogsLoading}
            />
          </div>
        </aside>

        {/* Center: Chat area */}
        <main className="flex-1 bg-white flex flex-col min-w-0">
          <ChatArea
            messages={messages}
            loading={messagesLoading}
            typingIndicator={typingIndicator}
            onSendMessage={sendMessage}
            onTyping={sendTyping}
            dialogId={selectedDialogId}
            sendMessageRef={sendMessageRef}
          />
        </main>

        {/* Right panel: PQL + Quick replies + Actions */}
        <aside className="w-72 bg-white border-l border-gray-200 flex flex-col shrink-0">
          <RightPanel
            dialog={selectedDialog}
            operatorId={operator?.id ?? ''}
            token={token}
            onAssign={handleAssign}
            onClose={handleCloseDialog}
            onChangeStatus={handleChangeStatus}
            onQuickReply={handleQuickReply}
          />
        </aside>
      </div>

      {/* FR-14: Keyboard shortcuts help modal */}
      <ShortcutHelp open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />
    </div>
  )
}
