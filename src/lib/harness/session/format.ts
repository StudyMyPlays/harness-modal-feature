import type { Citation, Usage, WebSearchMode } from '../llm/types'
import type { TurnFinish } from '../protocol'
import type { ToolResult } from '../tools/registry'

/**
 * The session log (DeepSeek Harness's `session-format`): an append-only list
 * of events per chat, owned by the browser in v1. Every event carries `v`, the
 * format version, so a migration chain can be added when the shape changes.
 */
export interface ChatSettings {
  model: string
  systemPrompt: string
  reasoningEffort: string | null
  temperature: number | null
  webSearch: WebSearchMode
  includeVeniceSystemPrompt: boolean
  mcpServers: string[]
}

export interface Chat {
  id: string
  title: string
  /** Who set the title: null until the first reply, then the title model, the fallback, or the user. */
  titleSource: 'auto' | 'user' | 'fallback' | null
  createdAt: number
  updatedAt: number
  settings: ChatSettings
  totals: { inputTokens: number; outputTokens: number; costUsd: number }
}

export interface AttachmentRef {
  id: string
  name: string
  mime: string
  size: number
  kind: 'image' | 'file'
}

export interface StoredAttachment extends AttachmentRef {
  dataUrl: string
}

export interface AssistantStep {
  reasoning: string
  text: string
  citations: Citation[]
  toolCalls: { id: string; name: string; args: string; result: ToolResult | null }[]
}

export interface EventBase {
  id: string
  chatId: string
  ts: number
  v: 1
}

export type UserMessageEvent = EventBase & { type: 'user-message'; text: string; attachments: AttachmentRef[] }

export type AssistantMessageEvent = EventBase & {
  type: 'assistant-message'
  model: string
  steps: AssistantStep[]
  status: 'streaming' | 'complete' | 'interrupted' | 'error'
  finishReason: TurnFinish | null
  error: { message: string; status: number } | null
  usage: Usage | null
  costUsd: number | null
}

export type CompactionEvent = EventBase & { type: 'compaction'; summary: string; coversThroughEventId: string }

export type SessionEvent = UserMessageEvent | AssistantMessageEvent | CompactionEvent

/** Per request, history plus attachments: Vercel's 4.5 MB body limit less JSON overhead. */
export const ATTACHMENT_BUDGET_BYTES = 4_000_000
export const MAX_FILE_BYTES = 4 * 1024 * 1024
