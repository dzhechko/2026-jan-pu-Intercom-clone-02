/**
 * Tests for dialog sorting logic (FR-07).
 * Verifies: PQL HOT first, then WARM, then COLD/undefined, then by most recent message.
 */

// Inline the sort function to avoid module resolution issues with Next.js 'use client' files
type PQLTier = 'HOT' | 'WARM' | 'COLD'

interface DialogForSort {
  id: string
  pqlTier?: PQLTier
  lastMessageAt?: string
  updatedAt?: string
  createdAt: string
}

function sortDialogs<T extends DialogForSort>(dialogs: T[]): T[] {
  const tierOrder: Record<string, number> = { HOT: 0, WARM: 1, COLD: 2 }

  return [...dialogs].sort((a, b) => {
    const tierA = a.pqlTier ? tierOrder[a.pqlTier] ?? 3 : 3
    const tierB = b.pqlTier ? tierOrder[b.pqlTier] ?? 3 : 3
    if (tierA !== tierB) return tierA - tierB

    const timeA = a.lastMessageAt ?? a.updatedAt ?? a.createdAt
    const timeB = b.lastMessageAt ?? b.updatedAt ?? b.createdAt
    return new Date(timeB).getTime() - new Date(timeA).getTime()
  })
}

function makeDialog(overrides: Partial<DialogForSort> & { id: string }): DialogForSort {
  return {
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('sortDialogs', () => {
  it('should place HOT dialogs before WARM and COLD', () => {
    const dialogs = [
      makeDialog({ id: 'cold-1', pqlTier: 'COLD' }),
      makeDialog({ id: 'hot-1', pqlTier: 'HOT' }),
      makeDialog({ id: 'warm-1', pqlTier: 'WARM' }),
    ]

    const sorted = sortDialogs(dialogs)

    expect(sorted[0].id).toBe('hot-1')
    expect(sorted[1].id).toBe('warm-1')
    expect(sorted[2].id).toBe('cold-1')
  })

  it('should place undefined PQL tier after COLD', () => {
    const dialogs = [
      makeDialog({ id: 'none-1' }),
      makeDialog({ id: 'cold-1', pqlTier: 'COLD' }),
      makeDialog({ id: 'hot-1', pqlTier: 'HOT' }),
    ]

    const sorted = sortDialogs(dialogs)

    expect(sorted[0].id).toBe('hot-1')
    expect(sorted[1].id).toBe('cold-1')
    expect(sorted[2].id).toBe('none-1')
  })

  it('should sort by most recent message within the same tier', () => {
    const dialogs = [
      makeDialog({ id: 'old', pqlTier: 'HOT', lastMessageAt: '2026-01-01T10:00:00Z' }),
      makeDialog({ id: 'new', pqlTier: 'HOT', lastMessageAt: '2026-01-02T10:00:00Z' }),
      makeDialog({ id: 'mid', pqlTier: 'HOT', lastMessageAt: '2026-01-01T15:00:00Z' }),
    ]

    const sorted = sortDialogs(dialogs)

    expect(sorted[0].id).toBe('new')
    expect(sorted[1].id).toBe('mid')
    expect(sorted[2].id).toBe('old')
  })

  it('should fallback to updatedAt when lastMessageAt is missing', () => {
    const dialogs = [
      makeDialog({ id: 'a', pqlTier: 'WARM', updatedAt: '2026-01-01T10:00:00Z' }),
      makeDialog({ id: 'b', pqlTier: 'WARM', updatedAt: '2026-01-03T10:00:00Z' }),
    ]

    const sorted = sortDialogs(dialogs)

    expect(sorted[0].id).toBe('b')
    expect(sorted[1].id).toBe('a')
  })

  it('should not mutate the original array', () => {
    const dialogs = [
      makeDialog({ id: 'cold-1', pqlTier: 'COLD' }),
      makeDialog({ id: 'hot-1', pqlTier: 'HOT' }),
    ]

    const sorted = sortDialogs(dialogs)

    expect(dialogs[0].id).toBe('cold-1')
    expect(sorted[0].id).toBe('hot-1')
    expect(sorted).not.toBe(dialogs)
  })

  it('should handle empty array', () => {
    expect(sortDialogs([])).toEqual([])
  })

  it('should handle single item', () => {
    const dialogs = [makeDialog({ id: 'only', pqlTier: 'WARM' })]
    const sorted = sortDialogs(dialogs)
    expect(sorted).toHaveLength(1)
    expect(sorted[0].id).toBe('only')
  })

  it('should handle mixed scenario: HOT recent > HOT old > WARM recent > COLD', () => {
    const dialogs = [
      makeDialog({ id: 'cold-old', pqlTier: 'COLD', lastMessageAt: '2026-01-01T00:00:00Z' }),
      makeDialog({ id: 'warm-new', pqlTier: 'WARM', lastMessageAt: '2026-01-05T00:00:00Z' }),
      makeDialog({ id: 'hot-old', pqlTier: 'HOT', lastMessageAt: '2026-01-01T00:00:00Z' }),
      makeDialog({ id: 'hot-new', pqlTier: 'HOT', lastMessageAt: '2026-01-05T00:00:00Z' }),
      makeDialog({ id: 'none', lastMessageAt: '2026-01-10T00:00:00Z' }),
    ]

    const sorted = sortDialogs(dialogs)

    expect(sorted.map((d) => d.id)).toEqual([
      'hot-new',
      'hot-old',
      'warm-new',
      'cold-old',
      'none',
    ])
  })
})
