import { describe, expect, it } from 'vitest'
import { collect, streamOf } from '@/test/streams'
import { parseSse } from './sse'

const run = (chunks: string[]) => collect(parseSse(streamOf(chunks)))

describe('parseSse', () => {
  it('yields data payloads split across chunk boundaries', async () => {
    expect(await run(['data: {"a":', '1}\n\ndata: {"b":2}\n\n'])).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('handles CRLF line endings', async () => {
    expect(await run(['data: x\r\n\r\ndata: y\r', '\n\r\n'])).toEqual(['x', 'y'])
  })

  it('ignores comment lines and stops at [DONE]', async () => {
    expect(await run([': keep-alive\n\ndata: a\n\ndata: [DONE]\n\ndata: late\n\n'])).toEqual(['a'])
  })

  it('joins multi-line data fields with newline', async () => {
    expect(await run(['data: line1\ndata: line2\n\n'])).toEqual(['line1\nline2'])
  })

  it('flushes a final event without trailing blank line', async () => {
    expect(await run(['data: a\n\ndata: last'])).toEqual(['a', 'last'])
  })

  it('ignores non-data fields and blank events', async () => {
    expect(await run(['event: ping\nid: 3\n\n\n\ndata:no-space\n\n'])).toEqual(['no-space'])
  })
})
