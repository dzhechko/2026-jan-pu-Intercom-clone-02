'use client'

import { useEffect, useCallback, useMemo } from 'react'

/**
 * FR-14: Keyboard shortcut categories and definitions.
 */
export interface ShortcutDef {
  key: string
  label: string
  description: string
  category: 'navigation' | 'messaging' | 'actions'
}

export const SHORTCUT_MAP: ShortcutDef[] = [
  // Navigation
  { key: 'Ctrl+K', label: 'Ctrl+K', description: 'Focus search/filter dialogs', category: 'navigation' },
  { key: 'Alt+ArrowUp', label: 'Alt+\u2191', description: 'Previous dialog', category: 'navigation' },
  { key: 'Alt+ArrowDown', label: 'Alt+\u2193', description: 'Next dialog', category: 'navigation' },
  { key: 'Alt+N', label: 'Alt+N', description: 'Jump to next unassigned dialog', category: 'navigation' },
  { key: 'Escape', label: 'Esc', description: 'Deselect dialog / close panels', category: 'navigation' },
  // Messaging
  { key: 'Ctrl+Enter', label: 'Ctrl+Enter', description: 'Send message', category: 'messaging' },
  { key: 'Alt+1', label: 'Alt+1', description: 'Quick reply #1', category: 'messaging' },
  { key: 'Alt+2', label: 'Alt+2', description: 'Quick reply #2', category: 'messaging' },
  { key: 'Alt+3', label: 'Alt+3', description: 'Quick reply #3', category: 'messaging' },
  { key: 'Alt+4', label: 'Alt+4', description: 'Quick reply #4', category: 'messaging' },
  { key: 'Alt+5', label: 'Alt+5', description: 'Quick reply #5', category: 'messaging' },
  // Actions
  { key: 'Alt+A', label: 'Alt+A', description: 'Assign dialog to me', category: 'actions' },
  { key: 'Alt+C', label: 'Alt+C', description: 'Close current dialog', category: 'actions' },
  { key: '?', label: '?', description: 'Show keyboard shortcuts help', category: 'actions' },
]

export interface KeyboardShortcutActions {
  /** Send current message (Ctrl+Enter) */
  onSendMessage?: () => void
  /** Focus search input (Ctrl+K) */
  onFocusSearch?: () => void
  /** Navigate to previous dialog (Alt+Up) */
  onPreviousDialog?: () => void
  /** Navigate to next dialog (Alt+Down) */
  onNextDialog?: () => void
  /** Jump to next unassigned dialog (Alt+N) */
  onNextUnassigned?: () => void
  /** Assign current dialog (Alt+A) */
  onAssignDialog?: () => void
  /** Close current dialog (Alt+C) */
  onCloseDialog?: () => void
  /** Deselect / close panels (Escape) */
  onEscape?: () => void
  /** Send quick reply by index 0-based (Alt+1..5) */
  onQuickReply?: (index: number) => void
  /** Toggle shortcut help panel (?) */
  onToggleHelp?: () => void
}

interface UseKeyboardShortcutsOptions {
  actions: KeyboardShortcutActions
  enabled?: boolean
}

/**
 * Returns true if the active element is a text input where normal typing should not be intercepted.
 */
function isTypingInInput(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}

export function useKeyboardShortcuts({ actions, enabled = true }: UseKeyboardShortcutsOptions) {
  const shortcuts = useMemo(() => SHORTCUT_MAP, [])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return

      const ctrlOrMeta = e.ctrlKey || e.metaKey
      const typing = isTypingInInput()

      // Ctrl+Enter / Cmd+Enter — send message (works even in input)
      if (ctrlOrMeta && e.key === 'Enter') {
        e.preventDefault()
        actions.onSendMessage?.()
        return
      }

      // Ctrl+K — focus search (always, prevent default browser behavior)
      if (ctrlOrMeta && e.key === 'k') {
        e.preventDefault()
        actions.onFocusSearch?.()
        return
      }

      // Block remaining shortcuts when typing in input fields
      if (typing) return

      // Alt+ArrowUp — previous dialog
      if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault()
        actions.onPreviousDialog?.()
        return
      }

      // Alt+ArrowDown — next dialog
      if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault()
        actions.onNextDialog?.()
        return
      }

      // Alt+N — next unassigned dialog
      if (e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault()
        actions.onNextUnassigned?.()
        return
      }

      // Alt+A — assign dialog
      if (e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        actions.onAssignDialog?.()
        return
      }

      // Alt+C — close dialog
      if (e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault()
        actions.onCloseDialog?.()
        return
      }

      // Alt+1..5 — quick reply
      if (e.altKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const index = parseInt(e.key, 10) - 1
        actions.onQuickReply?.(index)
        return
      }

      // Escape — deselect / close
      if (e.key === 'Escape') {
        actions.onEscape?.()
        return
      }

      // ? — toggle help (only when not in input)
      if (e.key === '?' && !e.altKey && !ctrlOrMeta) {
        e.preventDefault()
        actions.onToggleHelp?.()
        return
      }
    },
    [enabled, actions],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return { shortcuts }
}
