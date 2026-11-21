import { Client } from '@modelcontextprotocol/sdk/client'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { HarnessTool } from './registry'

/**
 * MCP tools as harness tools (DeepSeek Harness's `mcp-client`).
 *
 * Only remote Streamable-HTTP servers: a Vercel function cannot spawn the
 * child process a stdio server needs. Servers are configured by whoever
 * deploys the app (env `MCP_SERVERS`), so their auth headers stay server-side.
 */
export interface McpServerConfig {
  name: string
  url: string
  headers?: Record<string, string>
}

export interface McpServerStatus {
  name: string
  ok: boolean
  toolCount: number
  error?: string
}

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

export interface McpConnection {
  listTools(): Promise<McpToolInfo[]>
  callTool(name: string, args: unknown, signal: AbortSignal): Promise<string>
}

const NAME_RE = /^[a-z0-9_-]{1,32}$/i
const CACHE_TTL_MS = 5 * 60_000
const CONNECT_TIMEOUT_MS = 5_000
const MAX_TOOL_NAME = 64

function allowedUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
}

export function parseMcpServers(raw: string | undefined): McpServerConfig[] {
  if (!raw?.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.error('MCP_SERVERS is not valid JSON; no MCP servers loaded.')
    return []
  }
  if (!Array.isArray(parsed)) {
    console.error('MCP_SERVERS must be a JSON array; no MCP servers loaded.')
    return []
  }
  const out: McpServerConfig[] = []
  const seen = new Set<string>()
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue
    const { name, url, headers } = item as Record<string, unknown>
    if (typeof name !== 'string' || !NAME_RE.test(name) || seen.has(name)) continue
    if (typeof url !== 'string' || !allowedUrl(url)) continue
    if (headers !== undefined) {
      if (!headers || typeof headers !== 'object') continue
      if (!Object.values(headers).every((v) => typeof v === 'string')) continue
    }
    seen.add(name)
    out.push({ name, url, ...(headers ? { headers: headers as Record<string, string> } : {}) })
  }
  return out
}

/** An MCP `CallToolResult` as text the model can read. */
export function mcpResultToText(result: { content?: unknown; isError?: unknown }): string {
  const items = Array.isArray(result.content) ? result.content : []
  const text = items
    .map((item: { type?: unknown; text?: unknown }) =>
      item?.type === 'text' && typeof item.text === 'string' ? item.text : `[${String(item?.type)} content omitted]`,
    )
    .join('\n')
  return result.isError ? `Error: ${text}` : text
}

async function connectHttp(server: McpServerConfig): Promise<McpConnection> {
  const client = new Client({ name: 'venice-harness', version: '0.1.0' })
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers: server.headers ?? {} },
  })
  await client.connect(transport)
  return {
    async listTools() {
      const { tools } = await client.listTools()
      return tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
      }))
    },
    async callTool(name, args, signal) {
      const result = await client.callTool(
        { name, arguments: (args ?? {}) as Record<string, unknown> },
        undefined,
        { signal },
      )
      return mcpResultToText(result as { content?: unknown; isError?: unknown })
    },
  }
}

interface CacheEntry {
  at: number
  conn: McpConnection
  tools: McpToolInfo[]
}

const cache = new Map<string, CacheEntry>()

export function resetMcpCache(): void {
  cache.clear()
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

async function loadServer(
  server: McpServerConfig,
  connect: (s: McpServerConfig) => Promise<McpConnection>,
  now: number,
): Promise<CacheEntry> {
  const key = `${server.name}\n${server.url}`
  const hit = cache.get(key)
  if (hit && now - hit.at < CACHE_TTL_MS) return hit
  const entry = await withTimeout(
    (async () => {
      const conn = hit?.conn ?? (await connect(server))
      return { at: now, conn, tools: await conn.listTools() }
    })(),
    CONNECT_TIMEOUT_MS,
  )
  cache.set(key, entry)
  return entry
}

/**
 * The tools of every enabled server, loaded in parallel. A server that fails
 * or hangs is reported in `status` and skipped; the others still load.
 */
export async function loadMcpTools(
  servers: McpServerConfig[],
  enabled: string[],
  deps: { connect?: (s: McpServerConfig) => Promise<McpConnection>; now?: () => number } = {},
): Promise<{ tools: HarnessTool[]; status: McpServerStatus[] }> {
  const connect = deps.connect ?? connectHttp
  const now = (deps.now ?? Date.now)()
  const active = servers.filter((s) => enabled.includes(s.name))
  const results = await Promise.allSettled(active.map((s) => loadServer(s, connect, now)))

  const tools: HarnessTool[] = []
  const status: McpServerStatus[] = []
  results.forEach((r, i) => {
    const server = active[i]
    if (r.status === 'rejected') {
      const error = r.reason instanceof Error ? r.reason.message : String(r.reason)
      console.error(`MCP server "${server.name}" failed to load:`, error)
      status.push({ name: server.name, ok: false, toolCount: 0, error })
      return
    }
    const { conn, tools: list } = r.value
    for (const t of list) {
      tools.push({
        spec: {
          name: `mcp__${server.name}__${t.name}`.slice(0, MAX_TOOL_NAME),
          description: t.description ?? '',
          parameters: t.inputSchema,
        },
        execute: (args, ctx) => conn.callTool(t.name, args, ctx.signal),
      })
    }
    status.push({ name: server.name, ok: true, toolCount: list.length })
  })
  return { tools, status }
}
