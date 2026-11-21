import { describe, expect, it } from 'vitest'
import { attachment, attachmentMap, makeEvents, refOf } from '@/test/sessions'
import { estimateTokens, projectForModel } from './projection'

const opts = { systemPrompt: 'Be brief.', supportsVision: true }

describe('projectForModel', () => {
  it('plain chat projects to system, user, assistant strings', () => {
    const e = makeEvents()
    const p = projectForModel([e.user('hi'), e.assistant('hello'), e.user('again')], new Map(), opts)
    expect(p.messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'again' },
    ])
    expect(p.overBudget).toBe(false)
    expect(p.evictedAttachmentIds).toEqual([])
  })

  it('omits the system message when the prompt is empty', () => {
    const e = makeEvents()
    expect(projectForModel([e.user('hi')], new Map(), { ...opts, systemPrompt: '  ' }).messages).toEqual([
      { role: 'user', content: 'hi' },
    ])
  })

  it('tool steps project to assistant tool_calls + tool messages in order', () => {
    const e = makeEvents()
    const p = projectForModel(
      [
        e.user('find cats'),
        e.assistant([
          {
            text: 'Searching.',
            toolCalls: [
              { id: 'c1', name: 'search', args: '{"q":"cats"}', result: { ok: true, content: 'cats!', truncated: false } },
              { id: 'c2', name: 'clock', args: '{}', result: null },
            ],
          },
          { text: 'Cats are great.' },
        ]),
      ],
      new Map(),
      { ...opts, systemPrompt: '' },
    )
    expect(p.messages).toEqual([
      { role: 'user', content: 'find cats' },
      {
        role: 'assistant',
        content: 'Searching.',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'search', arguments: '{"q":"cats"}' } },
          { id: 'c2', type: 'function', function: { name: 'clock', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'cats!' },
      { role: 'tool', tool_call_id: 'c2', content: 'Cancelled' },
      { role: 'assistant', content: 'Cats are great.' },
    ])
  })

  it('a tool step with no text sends content null', () => {
    const e = makeEvents()
    const p = projectForModel(
      [
        e.user('x'),
        e.assistant([
          { toolCalls: [{ id: 'c1', name: 't', args: '{}', result: { ok: true, content: 'r', truncated: false } }] },
          { text: 'done' },
        ]),
      ],
      new Map(),
      { ...opts, systemPrompt: '' },
    )
    expect(p.messages[1]).toMatchObject({ role: 'assistant', content: null })
  })

  it('reasoning is not sent', () => {
    const e = makeEvents()
    const p = projectForModel([e.user('x'), e.assistant([{ reasoning: 'SECRET THOUGHTS', text: 'answer' }])], new Map(), opts)
    expect(JSON.stringify(p.messages)).not.toContain('SECRET THOUGHTS')
  })

  it('empty interrupted assistant message is skipped; non-empty kept', () => {
    const e = makeEvents()
    const p = projectForModel(
      [
        e.user('a'),
        e.assistant('', { status: 'interrupted' }),
        e.user('b'),
        e.assistant('', { status: 'error', error: { message: 'x', status: 502 } }),
        e.user('c'),
        e.assistant('half an ans', { status: 'interrupted' }),
        e.user('d'),
      ],
      new Map(),
      { ...opts, systemPrompt: '' },
    )
    expect(p.messages.map((m) => m.content)).toEqual(['a', 'b', 'c', 'half an ans', 'd'])
  })

  it('latest compaction replaces covered events with summary message', () => {
    const e = makeEvents()
    const u1 = e.user('old 1')
    const a1 = e.assistant('old reply 1')
    const c1 = e.compaction('first summary', a1.id)
    const u2 = e.user('old 2')
    const a2 = e.assistant('old reply 2')
    const c2 = e.compaction('second summary', a2.id)
    const u3 = e.user('new')
    const p = projectForModel([u1, a1, c1, u2, a2, c2, u3], new Map(), { ...opts, systemPrompt: '' })
    expect(p.messages).toEqual([
      { role: 'user', content: '[Summary of earlier conversation]\nsecond summary' },
      { role: 'user', content: 'new' },
    ])
  })

  it('user attachments become image_url and file parts', () => {
    const e = makeEvents()
    const img = attachment('img', 'image')
    const pdf = attachment('pdf', 'file')
    const p = projectForModel([e.user('look', [refOf(img), refOf(pdf)])], attachmentMap(img, pdf), {
      ...opts,
      systemPrompt: '',
    })
    expect(p.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'look' },
        { type: 'image_url', image_url: { url: img.dataUrl } },
        { type: 'file', file: { filename: 'pdf.pdf', file_data: pdf.dataUrl } },
      ],
    })
  })

  it('images become placeholder text when supportsVision is false', () => {
    const e = makeEvents()
    const img = attachment('img', 'image', 10, 'cat.png')
    const p = projectForModel([e.user('what', [refOf(img)])], attachmentMap(img), {
      systemPrompt: '',
      supportsVision: false,
    })
    expect(p.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'what' },
        { type: 'text', text: '[Image "cat.png" can’t be read by this model]' },
      ],
    })
  })

  it('oldest attachments evicted first until under budget; ids reported', () => {
    const e = makeEvents()
    const a = attachment('a', 'file', 400, 'a.pdf')
    const b = attachment('b', 'file', 400, 'b.pdf')
    const c = attachment('c', 'file', 400, 'c.pdf')
    const events = [e.user('1', [refOf(a)]), e.assistant('ok'), e.user('2', [refOf(b)]), e.assistant('ok'), e.user('3', [refOf(c)])]
    const full = projectForModel(events, attachmentMap(a, b, c), { ...opts, systemPrompt: '' })
    // Room for everything but one attachment.
    const p = projectForModel(events, attachmentMap(a, b, c), { ...opts, systemPrompt: '', budgetBytes: full.bytes - 100 })
    expect(p.evictedAttachmentIds).toEqual(['a'])
    expect(p.overBudget).toBe(false)
    expect(p.bytes).toBeLessThanOrEqual(full.bytes - 100)
    expect(p.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '1' },
        { type: 'text', text: '[Attachment "a.pdf" was shared earlier and is no longer in context]' },
      ],
    })
  })

  it('last user message attachments never evicted; overBudget true when they alone exceed', () => {
    const e = makeEvents()
    const old = attachment('old', 'file', 500)
    const now = attachment('now', 'file', 5000)
    const p = projectForModel(
      [e.user('1', [refOf(old)]), e.assistant('ok'), e.user('2', [refOf(now)])],
      attachmentMap(old, now),
      { ...opts, systemPrompt: '', budgetBytes: 1000 },
    )
    expect(p.evictedAttachmentIds).toEqual(['old'])
    expect(p.overBudget).toBe(true)
    expect(JSON.stringify(p.messages)).toContain(now.dataUrl)
  })

  it('missing attachment data becomes eviction placeholder', () => {
    const e = makeEvents()
    const gone = attachment('gone', 'file', 10, 'gone.pdf')
    const p = projectForModel([e.user('x', [refOf(gone)])], new Map(), { ...opts, systemPrompt: '' })
    expect(p.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'x' },
        { type: 'text', text: '[Attachment "gone.pdf" was shared earlier and is no longer in context]' },
      ],
    })
    expect(p.evictedAttachmentIds).toEqual(['gone'])
  })

  it('estimatedTokens = ceil(total text chars / 4)', () => {
    const e = makeEvents()
    const p = projectForModel([e.user('abcde'), e.assistant('xyz')], new Map(), { ...opts, systemPrompt: 'ab' })
    expect(p.estimatedTokens).toBe(Math.ceil(10 / 4))
    expect(estimateTokens('abcde')).toBe(2)
  })

  it('bytes is the UTF-8 length of the serialised messages', () => {
    const e = makeEvents()
    const p = projectForModel([e.user('é')], new Map(), { ...opts, systemPrompt: '' })
    expect(p.bytes).toBe(new TextEncoder().encode(JSON.stringify(p.messages)).length)
  })
})
