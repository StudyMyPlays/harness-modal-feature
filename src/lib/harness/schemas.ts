import { z } from 'zod'
import type { LlmMessage, WebSearchMode } from './llm/types'

/**
 * Runtime validation for what the browser sends. The body is untrusted JSON:
 * every field is checked here so nothing downstream is handed the wrong type.
 */
const contentPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('image_url'),
    image_url: z.object({ url: z.string().startsWith('data:image/') }),
  }),
  z.object({
    type: z.literal('file'),
    file: z.object({ filename: z.string().min(1).max(255), file_data: z.string().startsWith('data:') }),
  }),
])

const toolCallSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.literal('function'),
  function: z.object({ name: z.string().min(1).max(64), arguments: z.string() }),
})

export const llmMessageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('system'), content: z.string() }),
  z.object({ role: z.literal('user'), content: z.union([z.string(), z.array(contentPartSchema).min(1).max(50)]) }),
  z.object({
    role: z.literal('assistant'),
    content: z.string().nullable(),
    tool_calls: z.array(toolCallSchema).max(32).optional(),
  }),
  z.object({ role: z.literal('tool'), tool_call_id: z.string().min(1).max(200), content: z.string() }),
])

export const chatSettingsSchema = z.object({
  reasoningEffort: z.string().max(20).optional(),
  temperature: z.number().min(0).max(2).optional(),
  webSearch: z.enum(['off', 'on', 'auto']),
  includeVeniceSystemPrompt: z.boolean(),
  mcpServers: z.array(z.string().max(32)).max(20),
})

export const chatRequestSchema = z.object({
  model: z.string().min(1).max(200),
  messages: z
    .array(llmMessageSchema)
    .min(1)
    .max(2000)
    .refine((m) => m.at(-1)?.role === 'user', 'The last message must be from the user.'),
  settings: chatSettingsSchema,
})

export interface ChatRequest {
  model: string
  messages: LlmMessage[]
  settings: {
    reasoningEffort?: string
    temperature?: number
    webSearch: WebSearchMode
    includeVeniceSystemPrompt: boolean
    mcpServers: string[]
  }
}

/** Text-only conversation for the compaction route. */
export const compactRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .min(1)
    .max(4000),
})

export const titleRequestSchema = z.object({
  userText: z.string().min(1),
  assistantText: z.string(),
})
