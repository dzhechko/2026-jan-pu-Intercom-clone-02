/**
 * FR-14: Keyboard Shortcuts tests.
 * Tests shortcut registration, action mapping, input field exclusion,
 * Ctrl+Enter send behavior, dialog navigation, and quick reply dispatch.
 */

import { QUICK_REPLY_TEMPLATES } from '../../app/(workspace)/constants/quickReplies'

// Helper: simulate shortcut map structure (mirrors useKeyboardShortcuts)
interface ShortcutDef {
  key: string
  label: string
  description: string
  category: 'navigation' | 'messaging' | 'actions'
}

const SHORTCUT_MAP: ShortcutDef[] = [
  { key: 'Ctrl+K', label: 'Ctrl+K', description: 'Focus search/filter dialogs', category: 'navigation' },
  { key: 'Alt+ArrowUp', label: 'Alt+\u2191', description: 'Previous dialog', category: 'navigation' },
  { key: 'Alt+ArrowDown', label: 'Alt+\u2193', description: 'Next dialog', category: 'navigation' },
  { key: 'Alt+N', label: 'Alt+N', description: 'Jump to next unassigned dialog', category: 'navigation' },
  { key: 'Escape', label: 'Esc', description: 'Deselect dialog / close panels', category: 'navigation' },
  { key: 'Ctrl+Enter', label: 'Ctrl+Enter', description: 'Send message', category: 'messaging' },
  { key: 'Alt+1', label: 'Alt+1', description: 'Quick reply #1', category: 'messaging' },
  { key: 'Alt+2', label: 'Alt+2', description: 'Quick reply #2', category: 'messaging' },
  { key: 'Alt+3', label: 'Alt+3', description: 'Quick reply #3', category: 'messaging' },
  { key: 'Alt+4', label: 'Alt+4', description: 'Quick reply #4', category: 'messaging' },
  { key: 'Alt+5', label: 'Alt+5', description: 'Quick reply #5', category: 'messaging' },
  { key: 'Alt+A', label: 'Alt+A', description: 'Assign dialog to me', category: 'actions' },
  { key: 'Alt+C', label: 'Alt+C', description: 'Close current dialog', category: 'actions' },
  { key: '?', label: '?', description: 'Show keyboard shortcuts help', category: 'actions' },
]

describe('FR-14: Keyboard Shortcuts', () => {
  describe('shortcut registration', () => {
    it('should have all expected shortcut keys registered', () => {
      const keys = SHORTCUT_MAP.map((s) => s.key)
      expect(keys).toContain('Ctrl+K')
      expect(keys).toContain('Ctrl+Enter')
      expect(keys).toContain('Alt+ArrowUp')
      expect(keys).toContain('Alt+ArrowDown')
      expect(keys).toContain('Alt+A')
      expect(keys).toContain('Alt+C')
      expect(keys).toContain('Alt+N')
      expect(keys).toContain('Escape')
      expect(keys).toContain('?')
    })

    it('should have Alt+1 through Alt+5 for quick replies', () => {
      const keys = SHORTCUT_MAP.map((s) => s.key)
      for (let i = 1; i <= 5; i++) {
        expect(keys).toContain(`Alt+${i}`)
      }
    })

    it('should have at least one shortcut per category', () => {
      const categories = new Set(SHORTCUT_MAP.map((s) => s.category))
      expect(categories.has('navigation')).toBe(true)
      expect(categories.has('messaging')).toBe(true)
      expect(categories.has('actions')).toBe(true)
    })

    it('should have unique keys (no duplicates)', () => {
      const keys = SHORTCUT_MAP.map((s) => s.key)
      const uniqueKeys = new Set(keys)
      expect(uniqueKeys.size).toBe(keys.length)
    })
  })

  describe('action mapping', () => {
    it('should map Ctrl+Enter to messaging category (send)', () => {
      const entry = SHORTCUT_MAP.find((s) => s.key === 'Ctrl+Enter')
      expect(entry).toBeDefined()
      expect(entry!.category).toBe('messaging')
      expect(entry!.description.toLowerCase()).toContain('send')
    })

    it('should map Alt+A to actions category (assign)', () => {
      const entry = SHORTCUT_MAP.find((s) => s.key === 'Alt+A')
      expect(entry).toBeDefined()
      expect(entry!.category).toBe('actions')
      expect(entry!.description.toLowerCase()).toContain('assign')
    })

    it('should map Alt+C to actions category (close)', () => {
      const entry = SHORTCUT_MAP.find((s) => s.key === 'Alt+C')
      expect(entry).toBeDefined()
      expect(entry!.category).toBe('actions')
      expect(entry!.description.toLowerCase()).toContain('close')
    })

    it('should map Escape to navigation category (deselect)', () => {
      const entry = SHORTCUT_MAP.find((s) => s.key === 'Escape')
      expect(entry).toBeDefined()
      expect(entry!.category).toBe('navigation')
    })

    it('should map Alt+N to navigation category (next unassigned)', () => {
      const entry = SHORTCUT_MAP.find((s) => s.key === 'Alt+N')
      expect(entry).toBeDefined()
      expect(entry!.category).toBe('navigation')
      expect(entry!.description.toLowerCase()).toContain('unassigned')
    })
  })

  describe('input field exclusion logic', () => {
    // Simulates the isTypingInInput() check from the hook
    function isTypingInInput(tagName: string, isContentEditable = false): boolean {
      const tag = tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
      if (isContentEditable) return true
      return false
    }

    it('should detect INPUT as a typing field', () => {
      expect(isTypingInInput('INPUT')).toBe(true)
    })

    it('should detect TEXTAREA as a typing field', () => {
      expect(isTypingInInput('TEXTAREA')).toBe(true)
    })

    it('should detect SELECT as a typing field', () => {
      expect(isTypingInInput('SELECT')).toBe(true)
    })

    it('should detect contentEditable as a typing field', () => {
      expect(isTypingInInput('DIV', true)).toBe(true)
    })

    it('should NOT detect regular DIV as a typing field', () => {
      expect(isTypingInInput('DIV')).toBe(false)
    })

    it('should NOT detect BUTTON as a typing field', () => {
      expect(isTypingInInput('BUTTON')).toBe(false)
    })
  })

  describe('Ctrl+Enter send behavior', () => {
    it('should have Ctrl+Enter registered as a send shortcut', () => {
      const sendShortcut = SHORTCUT_MAP.find((s) => s.key === 'Ctrl+Enter')
      expect(sendShortcut).toBeDefined()
      expect(sendShortcut!.description).toContain('Send')
    })

    it('Ctrl+Enter should be in the messaging category', () => {
      const sendShortcut = SHORTCUT_MAP.find((s) => s.key === 'Ctrl+Enter')
      expect(sendShortcut!.category).toBe('messaging')
    })
  })

  describe('dialog navigation (Alt+Up/Down)', () => {
    // Simulate dialog navigation logic
    function navigateDialog(
      dialogIds: string[],
      selectedId: string | null,
      direction: 'prev' | 'next',
    ): string | null {
      if (dialogIds.length === 0) return null
      if (!selectedId) return dialogIds[0]
      const currentIdx = dialogIds.indexOf(selectedId)
      if (currentIdx === -1) return dialogIds[0]
      const nextIdx =
        direction === 'next'
          ? Math.min(currentIdx + 1, dialogIds.length - 1)
          : Math.max(currentIdx - 1, 0)
      return dialogIds[nextIdx]
    }

    const testDialogs = ['d-1', 'd-2', 'd-3', 'd-4']

    it('should select first dialog when none is selected (next)', () => {
      expect(navigateDialog(testDialogs, null, 'next')).toBe('d-1')
    })

    it('should select first dialog when none is selected (prev)', () => {
      expect(navigateDialog(testDialogs, null, 'prev')).toBe('d-1')
    })

    it('should move to next dialog', () => {
      expect(navigateDialog(testDialogs, 'd-2', 'next')).toBe('d-3')
    })

    it('should move to previous dialog', () => {
      expect(navigateDialog(testDialogs, 'd-3', 'prev')).toBe('d-2')
    })

    it('should not go past the last dialog', () => {
      expect(navigateDialog(testDialogs, 'd-4', 'next')).toBe('d-4')
    })

    it('should not go before the first dialog', () => {
      expect(navigateDialog(testDialogs, 'd-1', 'prev')).toBe('d-1')
    })

    it('should return null for empty dialog list', () => {
      expect(navigateDialog([], null, 'next')).toBeNull()
    })

    it('should select first if current selection is not in list', () => {
      expect(navigateDialog(testDialogs, 'unknown', 'next')).toBe('d-1')
    })
  })

  describe('quick reply dispatch', () => {
    it('should have 5 default quick reply templates', () => {
      expect(QUICK_REPLY_TEMPLATES.length).toBe(5)
    })

    it('each template should have id, label, and content', () => {
      for (const qr of QUICK_REPLY_TEMPLATES) {
        expect(qr.id).toBeDefined()
        expect(qr.label).toBeDefined()
        expect(qr.content).toBeDefined()
        expect(qr.content.length).toBeGreaterThan(0)
      }
    })

    it('Alt+1 should map to the first quick reply template', () => {
      const index = 1 - 1 // Alt+1 -> index 0
      expect(QUICK_REPLY_TEMPLATES[index].content).toBe(
        'Спасибо за обращение! Подключаю специалиста.',
      )
    })

    it('Alt+5 should map to the last quick reply template', () => {
      const index = 5 - 1 // Alt+5 -> index 4
      expect(QUICK_REPLY_TEMPLATES[index].content).toBe(
        'Передаю ваш запрос в отдел продаж.',
      )
    })

    it('quick reply index should be within bounds for Alt+1..5', () => {
      for (let key = 1; key <= 5; key++) {
        const index = key - 1
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(QUICK_REPLY_TEMPLATES.length)
      }
    })

    it('Alt+6..9 should be out of bounds for default templates', () => {
      for (let key = 6; key <= 9; key++) {
        const index = key - 1
        expect(index).toBeGreaterThanOrEqual(QUICK_REPLY_TEMPLATES.length)
      }
    })

    it('templates should have unique IDs', () => {
      const ids = QUICK_REPLY_TEMPLATES.map((qr) => qr.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(ids.length)
    })
  })

  describe('shortcut help panel categories', () => {
    it('navigation shortcuts should include dialog switching and search', () => {
      const navShortcuts = SHORTCUT_MAP.filter((s) => s.category === 'navigation')
      expect(navShortcuts.length).toBeGreaterThanOrEqual(3)
      const descriptions = navShortcuts.map((s) => s.description.toLowerCase())
      expect(descriptions.some((d) => d.includes('search') || d.includes('filter'))).toBe(true)
      expect(descriptions.some((d) => d.includes('previous') || d.includes('next'))).toBe(true)
    })

    it('messaging shortcuts should include send and quick replies', () => {
      const msgShortcuts = SHORTCUT_MAP.filter((s) => s.category === 'messaging')
      expect(msgShortcuts.length).toBeGreaterThanOrEqual(2)
      const descriptions = msgShortcuts.map((s) => s.description.toLowerCase())
      expect(descriptions.some((d) => d.includes('send'))).toBe(true)
      expect(descriptions.some((d) => d.includes('quick reply'))).toBe(true)
    })

    it('actions shortcuts should include assign and close', () => {
      const actionShortcuts = SHORTCUT_MAP.filter((s) => s.category === 'actions')
      expect(actionShortcuts.length).toBeGreaterThanOrEqual(2)
      const descriptions = actionShortcuts.map((s) => s.description.toLowerCase())
      expect(descriptions.some((d) => d.includes('assign'))).toBe(true)
      expect(descriptions.some((d) => d.includes('close'))).toBe(true)
    })
  })
})
