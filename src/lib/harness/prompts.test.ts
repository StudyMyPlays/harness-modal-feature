import { describe, expect, it } from 'vitest'
import { harnessPreamble } from './prompts'

const now = new Date('2026-11-21T10:00:00Z')

describe('harnessPreamble', () => {
  it('includes the ISO date', () => {
    expect(harnessPreamble({ now, webSearch: 'off', toolNames: [] })).toContain('2026-11-21')
  })

  it('mentions web search only when not off', () => {
    expect(harnessPreamble({ now, webSearch: 'off', toolNames: [] })).not.toMatch(/web search/i)
    expect(harnessPreamble({ now, webSearch: 'auto', toolNames: [] })).toMatch(/web search/i)
    expect(harnessPreamble({ now, webSearch: 'on', toolNames: [] })).toMatch(/web search/i)
  })

  it('lists tool names only when present', () => {
    expect(harnessPreamble({ now, webSearch: 'off', toolNames: [] })).not.toMatch(/tools/i)
    expect(harnessPreamble({ now, webSearch: 'off', toolNames: ['mcp__docs__search'] })).toContain('mcp__docs__search')
  })
})

describe('sanitizeTitle', () => {
  it.each([
    ['"Hello World."', 'Hello World'],
    ['Title: A B C D E F G H', 'A B C D E F'],
    ['  many   spaces\nhere ', 'many spaces here'],
    ['   ', null],
    ['“Curly quotes”', 'Curly quotes'],
  ])('%j → %j', async (raw, expected) => {
    const { sanitizeTitle } = await import('./prompts')
    expect(sanitizeTitle(raw)).toBe(expected)
  })

  it('caps at 60 characters', async () => {
    const { sanitizeTitle } = await import('./prompts')
    expect(sanitizeTitle('Supercalifragilisticexpialidocious '.repeat(3))!.length).toBeLessThanOrEqual(60)
  })
})
