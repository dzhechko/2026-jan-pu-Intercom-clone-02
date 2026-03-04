'use client'

import { useEffect, useRef } from 'react'
import { SHORTCUT_MAP, type ShortcutDef } from '../hooks/useKeyboardShortcuts'

interface ShortcutHelpProps {
  open: boolean
  onClose: () => void
}

const CATEGORIES: { key: ShortcutDef['category']; label: string }[] = [
  { key: 'navigation', label: 'Navigation' },
  { key: 'messaging', label: 'Messaging' },
  { key: 'actions', label: 'Actions' },
]

export function ShortcutHelp({ open, onClose }: ShortcutHelpProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [open, onClose])

  // Auto-focus close button and trap focus inside modal
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
  }, [open])

  if (!open) return null

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose()
    }
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-help-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="shortcut-help-overlay"
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 id="shortcut-help-title" className="text-base font-semibold text-gray-900">Keyboard Shortcuts</h2>
          <button
            ref={closeRef}
            onClick={onClose}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                e.preventDefault()
                closeRef.current?.focus()
              }
            }}
            className="text-gray-400 hover:text-gray-600 transition-colors text-lg"
            data-testid="shortcut-help-close"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-5 max-h-[60vh] overflow-y-auto">
          {CATEGORIES.map(({ key, label }) => {
            const items = SHORTCUT_MAP.filter((s) => s.category === key)
            if (items.length === 0) return null

            return (
              <div key={key}>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  {label}
                </h3>
                <div className="space-y-1.5">
                  {items.map((shortcut) => (
                    <div
                      key={shortcut.key}
                      className="flex items-center justify-between"
                    >
                      <span className="text-sm text-gray-700">{shortcut.description}</span>
                      <kbd className="inline-block px-2 py-0.5 text-xs font-mono text-gray-600 bg-gray-100 border border-gray-200 rounded">
                        {shortcut.label}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50">
          <p className="text-xs text-gray-400 text-center">
            Press <kbd className="px-1 py-0.5 text-xs font-mono bg-gray-100 border border-gray-200 rounded">?</kbd> or <kbd className="px-1 py-0.5 text-xs font-mono bg-gray-100 border border-gray-200 rounded">Esc</kbd> to close
          </p>
        </div>
      </div>
    </div>
  )
}
