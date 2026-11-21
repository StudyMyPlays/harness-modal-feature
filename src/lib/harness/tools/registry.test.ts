import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LlmToolCall } from '../llm/types'
import { createToolRegistry, executeToolCall, type HarnessTool } from './registry'

function tool(name: string, execute: HarnessTool['execute']): HarnessTool {
  return { spec: { name, description: name, parameters: { type: 'object' } }, execute }
}

function call(name: string, args: string): LlmToolCall {
  return { id: 'c1', type: 'function', function: { name, arguments: args } }
}

const signal = () => new AbortController().signal

afterEach(() => vi.useRealTimers())

describe('createToolRegistry', () => {
  it('lists specs and looks tools up by name', () => {
    const echo = tool('echo', async () => 'x')
    const reg = createToolRegistry([echo])
    expect(reg.specs()).toEqual([echo.spec])
    expect(reg.get('echo')).toBe(echo)
    expect(reg.get('nope')).toBeUndefined()
  })

  it('throws on a duplicate tool name', () => {
    expect(() => createToolRegistry([tool('a', async () => ''), tool('a', async () => '')])).toThrow(/a/)
  })
})

describe('executeToolCall', () => {
  it('runs a tool with parsed JSON args', async () => {
    const execute = vi.fn(async (args: unknown) => `got ${(args as { q: string }).q}`)
    const reg = createToolRegistry([tool('search', execute)])
    expect(await executeToolCall(reg, call('search', '{"q":"cats"}'), { signal: signal() })).toEqual({
      ok: true,
      content: 'got cats',
      truncated: false,
    })
  })

  it('treats empty arguments as an empty object', async () => {
    const execute = vi.fn(async () => 'ok')
    await executeToolCall(createToolRegistry([tool('t', execute)]), call('t', ''), { signal: signal() })
    expect(execute).toHaveBeenCalledWith({}, expect.anything())
  })

  it("unknown tool returns ok:false 'Unknown tool: <name>'", async () => {
    expect(await executeToolCall(createToolRegistry([]), call('ghost', '{}'), { signal: signal() })).toEqual({
      ok: false,
      content: 'Unknown tool: ghost',
      truncated: false,
    })
  })

  it("malformed JSON args returns ok:false starting 'Invalid JSON arguments'", async () => {
    const execute = vi.fn(async () => 'never')
    const r = await executeToolCall(createToolRegistry([tool('t', execute)]), call('t', '{"q":'), { signal: signal() })
    expect(r.ok).toBe(false)
    expect(r.content.startsWith('Invalid JSON arguments')).toBe(true)
    expect(execute).not.toHaveBeenCalled()
  })

  it('tool that throws returns ok:false with the error message', async () => {
    const reg = createToolRegistry([
      tool('t', async () => {
        throw new Error('server exploded')
      }),
    ])
    expect(await executeToolCall(reg, call('t', '{}'), { signal: signal() })).toEqual({
      ok: false,
      content: 'Tool failed: server exploded',
      truncated: false,
    })
  })

  it("times out after timeoutMs with ok:false 'Tool timed out after 20s'", async () => {
    vi.useFakeTimers()
    const reg = createToolRegistry([tool('slow', () => new Promise(() => {}))])
    const p = executeToolCall(reg, call('slow', '{}'), { signal: signal() })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(await p).toEqual({ ok: false, content: 'Tool timed out after 20s', truncated: false })
  })

  it('passes an abort signal to the tool that fires on timeout', async () => {
    vi.useFakeTimers()
    let seen: AbortSignal | undefined
    const reg = createToolRegistry([
      tool('slow', (_a, ctx) => {
        seen = ctx.signal
        return new Promise(() => {})
      }),
    ])
    const p = executeToolCall(reg, call('slow', '{}'), { signal: signal(), timeoutMs: 1000 })
    await vi.advanceTimersByTimeAsync(1000)
    await p
    expect(seen?.aborted).toBe(true)
  })

  it('truncates content over maxChars and sets truncated:true', async () => {
    const reg = createToolRegistry([tool('big', async () => 'x'.repeat(20))])
    const r = await executeToolCall(reg, call('big', '{}'), { signal: signal(), maxChars: 10 })
    expect(r.truncated).toBe(true)
    expect(r.content.startsWith('x'.repeat(10))).toBe(true)
    expect(r.content).toContain('[truncated')
  })

  it('defaults to a 16000 character cap', async () => {
    const reg = createToolRegistry([tool('big', async () => 'x'.repeat(16_001))])
    expect((await executeToolCall(reg, call('big', '{}'), { signal: signal() })).truncated).toBe(true)
  })

  it("aborted signal returns ok:false 'Cancelled'", async () => {
    const ctrl = new AbortController()
    const reg = createToolRegistry([tool('slow', () => new Promise(() => {}))])
    const p = executeToolCall(reg, call('slow', '{}'), { signal: ctrl.signal })
    ctrl.abort()
    expect(await p).toEqual({ ok: false, content: 'Cancelled', truncated: false })
  })
})
