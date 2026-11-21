import type { ContentPart, LlmMessage } from '../llm/types'
import { ATTACHMENT_BUDGET_BYTES, type AttachmentRef, type SessionEvent, type StoredAttachment } from './format'

/**
 * Session log → the messages the model sees (DeepSeek Harness's
 * `session-projection`). The log keeps everything for the UI; the projection
 * applies compaction, drops reasoning, and evicts old attachments so a request
 * fits the body limit.
 */

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

const evictedText = (name: string) => `[Attachment "${name}" was shared earlier and is no longer in context]`
const unreadableImage = (name: string) => `[Image "${name}" can’t be read by this model]`

export interface Projection {
  messages: LlmMessage[]
  evictedAttachmentIds: string[]
  estimatedTokens: number
  bytes: number
  overBudget: boolean
}

/** Events the model should see as themselves, plus the summary standing in for the rest. */
export function liveEvents(events: SessionEvent[]): { summary: string | null; live: SessionEvent[] } {
  let latest: Extract<SessionEvent, { type: 'compaction' }> | null = null
  for (const e of events) if (e.type === 'compaction') latest = e
  const messages = events.filter((e) => e.type !== 'compaction')
  if (!latest) return { summary: null, live: messages }
  const cut = messages.findIndex((e) => e.id === latest.coversThroughEventId)
  return { summary: latest.summary, live: cut === -1 ? messages : messages.slice(cut + 1) }
}

interface AttachmentSlot {
  ref: AttachmentRef
  message: Extract<LlmMessage, { role: 'user' }>
  index: number
  inLastUser: boolean
}

function byteLength(messages: LlmMessage[]): number {
  return new TextEncoder().encode(JSON.stringify(messages)).length
}

export function projectForModel(
  events: SessionEvent[],
  attachments: Map<string, StoredAttachment>,
  opts: { systemPrompt: string; supportsVision: boolean; budgetBytes?: number },
): Projection {
  const budget = opts.budgetBytes ?? ATTACHMENT_BUDGET_BYTES
  const { summary, live } = liveEvents(events)
  const messages: LlmMessage[] = []
  const slots: AttachmentSlot[] = []
  const evicted: string[] = []
  let textChars = 0
  const text = (s: string) => {
    textChars += s.length
    return s
  }

  const system = opts.systemPrompt.trim()
  if (system) messages.push({ role: 'system', content: text(system) })
  if (summary) messages.push({ role: 'user', content: text(`[Summary of earlier conversation]\n${summary}`) })

  let lastUserIdx = -1
  live.forEach((e, i) => {
    if (e.type === 'user-message') lastUserIdx = i
  })

  live.forEach((e, i) => {
    if (e.type === 'user-message') {
      if (e.attachments.length === 0) {
        messages.push({ role: 'user', content: text(e.text) })
        return
      }
      const parts: ContentPart[] = [{ type: 'text', text: text(e.text) }]
      const message: Extract<LlmMessage, { role: 'user' }> = { role: 'user', content: parts }
      for (const ref of e.attachments) {
        const stored = attachments.get(ref.id)
        if (!stored) {
          parts.push({ type: 'text', text: text(evictedText(ref.name)) })
          evicted.push(ref.id)
          continue
        }
        if (ref.kind === 'image' && !opts.supportsVision) {
          parts.push({ type: 'text', text: text(unreadableImage(ref.name)) })
          continue
        }
        parts.push(
          ref.kind === 'image'
            ? { type: 'image_url', image_url: { url: stored.dataUrl } }
            : { type: 'file', file: { filename: ref.name, file_data: stored.dataUrl } },
        )
        slots.push({ ref, message, index: parts.length - 1, inLastUser: i === lastUserIdx })
      }
      messages.push(message)
      return
    }
    if (e.type !== 'assistant-message') return
    const steps = e.steps
    const hasContent = steps.some((s) => s.text || s.toolCalls.length)
    if (!hasContent) return
    steps.forEach((step) => {
      if (step.toolCalls.length) {
        messages.push({
          role: 'assistant',
          content: step.text ? text(step.text) : null,
          tool_calls: step.toolCalls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: text(c.args) },
          })),
        })
        for (const c of step.toolCalls) {
          messages.push({ role: 'tool', tool_call_id: c.id, content: text(c.result?.content ?? 'Cancelled') })
        }
      } else if (step.text) {
        messages.push({ role: 'assistant', content: text(step.text) })
      }
    })
  })

  let bytes = byteLength(messages)
  for (const slot of slots) {
    if (bytes <= budget) break
    if (slot.inLastUser) continue
    const parts = slot.message.content as ContentPart[]
    parts[slot.index] = { type: 'text', text: text(evictedText(slot.ref.name)) }
    evicted.push(slot.ref.id)
    bytes = byteLength(messages)
  }

  return {
    messages,
    evictedAttachmentIds: evicted,
    estimatedTokens: Math.ceil(textChars / 4),
    bytes,
    overBudget: bytes > budget,
  }
}
