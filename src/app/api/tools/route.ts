import { NextResponse, type NextRequest } from 'next/server'
import { guardRequest } from '@/lib/harness/guard'
import { loadMcpTools, parseMcpServers } from '@/lib/harness/tools/mcp'

export const runtime = 'nodejs'

/** Every configured MCP server's status and tools, for the settings panel. */
export async function GET(req: NextRequest) {
  const guard = await guardRequest(req, { name: 'tools', limit: 30, windowMs: 60_000, budgetUnits: 0 })
  if (!guard.ok) return guard.response
  const servers = parseMcpServers(guard.cfg.mcpServersRaw)
  const { tools, status } = await loadMcpTools(
    servers,
    servers.map((s) => s.name),
  )
  return NextResponse.json({
    servers: status,
    tools: tools.map((t) => ({ name: t.spec.name, description: t.spec.description })),
  })
}
