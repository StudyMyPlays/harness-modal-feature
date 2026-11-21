import { describe, expect, it } from 'vitest'
import { makeEvents } from '@/test/sessions'
import { selectCompactionRange, shouldCompact } from './compaction'

function conversation(turns: number) {
  const e = makeEvents()
  const events = []
  for (let i = 1; i <= turns; i++) {
    events.push(e.user(`u${i}`), e.assistant(`a${i}`))
  }
  return { e, events }
}

describe('shouldCompact', () => {
  it('shouldCompact true over threshold or overBudget', () => {
    expect(shouldCompact({ estimatedTokens: 151, overBudget: false }, 150)).toBe(true)
    expect(shouldCompact({ estimatedTokens: 150, overBudget: false }, 150)).toBe(false)
    expect(shouldCompact({ estimatedTokens: 1, overBudget: true }, 150)).toBe(true)
  })
})

describe('selectCompactionRange', () => {
  it('selectCompactionRange returns null with ≤6 messages', () => {
    expect(selectCompactionRange(conversation(3).events)).toBeNull()
  })

  it('keeps last 6 messages and covers through the event before them', () => {
    const { events } = conversation(5) // 10 messages
    const range = selectCompactionRange(events)!
    expect(range.toSummarize.map((ev) => ev.id)).toEqual(events.slice(0, 4).map((ev) => ev.id))
    expect(range.throughEventId).toBe(events[3].id)
  })

  it('chains: previous compaction summary included first', () => {
    const { e, events } = conversation(4)
    const c = e.compaction('earlier summary', events[3].id)
    const more = [e.user('u5'), e.assistant('a5'), e.user('u6'), e.assistant('a6'), e.user('u7'), e.assistant('a7')]
    const all = [...events.slice(0, 4), c, ...events.slice(4), ...more]
    const range = selectCompactionRange(all)!
    // after the compaction: u3 a3 u4 a4 + 6 more = 10 messages; keep 6, summarise 4
    expect(range.toSummarize[0]).toBe(c)
    expect(range.toSummarize.slice(1).map((ev) => (ev.type === 'user-message' ? ev.text : ''))).toEqual([
      'u3',
      '',
      'u4',
      '',
    ])
    expect(range.throughEventId).toBe(events[7].id)
  })

  it('honours a custom keepLast', () => {
    const { events } = conversation(3)
    expect(selectCompactionRange(events, 2)!.toSummarize).toHaveLength(4)
  })
})
