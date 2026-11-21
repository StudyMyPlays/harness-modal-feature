import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadMcpTools, parseMcpServers, resetMcpCache, type McpConnection, type McpServerConfig } from './mcp'

const signal = () => new AbortController().signal

function fakeConnection(tools: string[], call: McpConnection['callTool'] = async () => 'ok'): McpConnection {
  return {
    listTools: vi.fn(async () =>
      tools.map((name) => ({ name, description: `${name} tool`, inputSchema: { type: 'object' } })),
    ),
    callTool: call,
  }
}

const docs: McpServerConfig = { name: 'docs', url: 'https://docs.example/mcp' }
const crm: McpServerConfig = { name: 'crm', url: 'https://crm.example/mcp' }

beforeEach(() => {
  resetMcpCache()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.useRealTimers())

describe('parseMcpServers', () => {
  it('reads a valid list', () => {
    expect(
      parseMcpServers(JSON.stringify([{ name: 'docs', url: 'https://docs.example/mcp', headers: { 'x-key': 'k' } }])),
    ).toEqual([{ name: 'docs', url: 'https://docs.example/mcp', headers: { 'x-key': 'k' } }])
  })

  it('returns [] for unset or invalid JSON', () => {
    expect(parseMcpServers(undefined)).toEqual([])
    expect(parseMcpServers('{nope')).toEqual([])
    expect(parseMcpServers('{"name":"x"}')).toEqual([])
  })

  it('drops non-https urls except localhost', () => {
    const parsed = parseMcpServers(
      JSON.stringify([
        { name: 'evil', url: 'http://evil.example/mcp' },
        { name: 'local', url: 'http://localhost:3001/mcp' },
        { name: 'bad', url: 'not a url' },
      ]),
    )
    expect(parsed.map((s) => s.name)).toEqual(['local'])
  })

  it('drops duplicates, bad names and non-string headers', () => {
    const parsed = parseMcpServers(
      JSON.stringify([
        { name: 'a', url: 'https://a.example' },
        { name: 'a', url: 'https://b.example' },
        { name: 'has space', url: 'https://c.example' },
        { name: 'h', url: 'https://d.example', headers: { n: 1 } },
      ]),
    )
    expect(parsed.map((s) => s.name)).toEqual(['a'])
  })
})

describe('loadMcpTools', () => {
  it('prefixes tool names and only loads enabled servers', async () => {
    const connect = vi.fn(async (s: McpServerConfig) => fakeConnection(s.name === 'docs' ? ['search'] : ['lookup']))
    const { tools, status } = await loadMcpTools([docs, crm], ['docs'], { connect })
    expect(tools.map((t) => t.spec.name)).toEqual(['mcp__docs__search'])
    expect(tools[0].spec).toEqual({
      name: 'mcp__docs__search',
      description: 'search tool',
      parameters: { type: 'object' },
    })
    expect(connect).toHaveBeenCalledTimes(1)
    expect(status).toEqual([{ name: 'docs', ok: true, toolCount: 1 }])
  })

  it('a server that rejects yields ok:false and others still load', async () => {
    const connect = vi.fn(async (s: McpServerConfig) => {
      if (s.name === 'crm') throw new Error('connection refused')
      return fakeConnection(['search'])
    })
    const { tools, status } = await loadMcpTools([docs, crm], ['docs', 'crm'], { connect })
    expect(tools.map((t) => t.spec.name)).toEqual(['mcp__docs__search'])
    expect(status).toEqual([
      { name: 'docs', ok: true, toolCount: 1 },
      { name: 'crm', ok: false, toolCount: 0, error: 'connection refused' },
    ])
  })

  it("a server that hangs past 5s yields ok:false 'timed out'", async () => {
    vi.useFakeTimers()
    const connect = vi.fn(() => new Promise<McpConnection>(() => {}))
    const p = loadMcpTools([docs], ['docs'], { connect })
    await vi.advanceTimersByTimeAsync(5000)
    expect((await p).status).toEqual([{ name: 'docs', ok: false, toolCount: 0, error: 'timed out' }])
  })

  it('caches listTools for 5 minutes', async () => {
    let now = 0
    const conn = fakeConnection(['search'])
    const connect = vi.fn(async () => conn)
    await loadMcpTools([docs], ['docs'], { connect, now: () => now })
    now += 4 * 60_000
    await loadMcpTools([docs], ['docs'], { connect, now: () => now })
    expect(conn.listTools).toHaveBeenCalledTimes(1)
    now += 2 * 60_000
    await loadMcpTools([docs], ['docs'], { connect, now: () => now })
    expect(conn.listTools).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failure', async () => {
    const connect = vi
      .fn<(s: McpServerConfig) => Promise<McpConnection>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(fakeConnection(['search']))
    await loadMcpTools([docs], ['docs'], { connect })
    const { status } = await loadMcpTools([docs], ['docs'], { connect })
    expect(status[0].ok).toBe(true)
  })

  it('tool execute calls the server tool by its own name', async () => {
    const callTool = vi.fn(async () => 'result text')
    const { tools } = await loadMcpTools([docs], ['docs'], {
      connect: async () => fakeConnection(['search'], callTool),
    })
    const s = signal()
    expect(await tools[0].execute({ q: 'x' }, { signal: s })).toBe('result text')
    expect(callTool).toHaveBeenCalledWith('search', { q: 'x' }, s)
  })

  it('reconnects after the cache expires instead of reusing the old connection', async () => {
    let now = 0
    const first = fakeConnection(['search'])
    const second = fakeConnection(['search'])
    const connect = vi.fn<(s: McpServerConfig) => Promise<McpConnection>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
    await loadMcpTools([docs], ['docs'], { connect, now: () => now })
    now += 6 * 60_000
    const { tools } = await loadMcpTools([docs], ['docs'], { connect, now: () => now })
    expect(connect).toHaveBeenCalledTimes(2)
    await tools[0].execute({}, { signal: signal() })
    expect(second.callTool).toBeDefined()
  })

  it('a failed tool call drops the cached connection so the next turn reconnects', async () => {
    const broken = fakeConnection(['search'], async () => {
      throw new Error('session expired')
    })
    const fresh = fakeConnection(['search'])
    const connect = vi.fn<(s: McpServerConfig) => Promise<McpConnection>>()
      .mockResolvedValueOnce(broken)
      .mockResolvedValueOnce(fresh)
    const { tools } = await loadMcpTools([docs], ['docs'], { connect })
    await expect(tools[0].execute({}, { signal: signal() })).rejects.toThrow('session expired')
    await loadMcpTools([docs], ['docs'], { connect })
    expect(connect).toHaveBeenCalledTimes(2)
  })

  it('replaces characters models reject and keeps names unique', async () => {
    const long = 'x'.repeat(80)
    const { tools, status } = await loadMcpTools([docs], ['docs'], {
      connect: async () => fakeConnection(['files.read', 'a/b c', `${long}1`, `${long}2`, 'dup', 'dup']),
    })
    const names = tools.map((t) => t.spec.name)
    for (const n of names) expect(n).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    expect(names).toContain('mcp__docs__files_read')
    expect(new Set(names).size).toBe(names.length)
    expect(names).toHaveLength(5)
    expect(status[0]).toMatchObject({ ok: true, toolCount: 5 })
  })

  it('calls the server tool by its original name after sanitising', async () => {
    const callTool = vi.fn(async () => 'ok')
    const { tools } = await loadMcpTools([docs], ['docs'], {
      connect: async () => fakeConnection(['files.read'], callTool),
    })
    await tools[0].execute({}, { signal: signal() })
    expect(callTool).toHaveBeenCalledWith('files.read', {}, expect.anything())
  })

  it('cuts tool names to 64 characters', async () => {
    const long = 'a'.repeat(80)
    const { tools } = await loadMcpTools([docs], ['docs'], { connect: async () => fakeConnection([long]) })
    expect(tools[0].spec.name).toHaveLength(64)
  })
})

describe('mcpResultToText', () => {
  it('callTool joins text content and notes omitted non-text items', async () => {
    const { mcpResultToText } = await import('./mcp')
    expect(
      mcpResultToText({
        content: [
          { type: 'text', text: 'one' },
          { type: 'image', data: 'AAA', mimeType: 'image/png' },
          { type: 'text', text: 'two' },
        ],
      }),
    ).toBe('one\n[image content omitted]\ntwo')
  })

  it('marks an isError result so the model knows the tool failed', async () => {
    const { mcpResultToText } = await import('./mcp')
    expect(mcpResultToText({ isError: true, content: [{ type: 'text', text: 'bad input' }] })).toBe(
      'Error: bad input',
    )
  })
})
