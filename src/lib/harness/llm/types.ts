/**
 * The model-adapter seam (DeepSeek Harness's `llm` package): the message and
 * stream vocabulary every adapter speaks. Venice is the only adapter in v1;
 * another provider is a new `LlmAdapter`, nothing above this file changes.
 */

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } }

export interface LlmToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: LlmToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema for the arguments object. */
  parameters: Record<string, unknown>
}

export type WebSearchMode = 'off' | 'on' | 'auto'

export interface LlmRequest {
  model: string
  messages: LlmMessage[]
  tools?: ToolSpec[]
  reasoningEffort?: string
  temperature?: number
  maxTokens?: number
  webSearch: WebSearchMode
  includeVeniceSystemPrompt: boolean
  /** The caller's cancellation (the browser went away, or the user pressed Stop). */
  signal: AbortSignal
  /** Hard ceiling for this one call. */
  timeoutMs: number
}

export interface Usage {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
}

export interface Citation {
  title: string
  url: string
  content?: string
  date?: string
}

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'other'

export type LlmEvent =
  | { type: 'reasoning-delta'; text: string }
  | { type: 'text-delta'; text: string }
  | { type: 'citations'; citations: Citation[] }
  /** Emitted once per call, complete, after every argument delta has arrived. */
  | { type: 'tool-calls'; calls: LlmToolCall[] }
  | { type: 'usage'; usage: Usage }
  | { type: 'meta'; balanceUsd: number | null }
  | { type: 'finish'; reason: FinishReason }

export interface LlmAdapter {
  stream(req: LlmRequest): AsyncIterable<LlmEvent>
}

export type LlmErrorKind = 'upstream' | 'timeout' | 'empty' | 'transport' | 'aborted'

/**
 * A failed model call, reduced to what went wrong. The message is ours, never
 * the provider's body, which can name account state and must not reach a client.
 */
export class LlmError extends Error {
  constructor(
    public readonly kind: LlmErrorKind,
    public readonly status?: number,
  ) {
    super(status ? `${kind} (${status})` : kind)
    this.name = 'LlmError'
  }

  get retryable(): boolean {
    if (this.kind === 'transport') return true
    if (this.kind !== 'upstream' || this.status === undefined) return false
    return this.status === 429 || this.status >= 500
  }
}
