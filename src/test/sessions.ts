import type {
  AssistantMessageEvent,
  AssistantStep,
  AttachmentRef,
  CompactionEvent,
  SessionEvent,
  StoredAttachment,
  UserMessageEvent,
} from '@/lib/harness/session/format'

/** Builders for session events in tests; ids and timestamps increase in call order. */
export function makeEvents(chatId = 'chat1') {
  let n = 0
  const base = () => {
    n += 1
    return { id: `${chatId}-e${n}`, chatId, ts: 1000 + n, v: 1 as const }
  }
  return {
    user(text: string, attachments: AttachmentRef[] = []): UserMessageEvent {
      return { ...base(), type: 'user-message', text, attachments }
    },
    assistant(
      steps: Array<Partial<AssistantStep>> | string,
      over: Partial<AssistantMessageEvent> = {},
    ): AssistantMessageEvent {
      const list = typeof steps === 'string' ? [{ text: steps }] : steps
      return {
        ...base(),
        type: 'assistant-message',
        model: 'm',
        steps: list.map((s) => ({ reasoning: '', text: '', citations: [], toolCalls: [], ...s })),
        status: 'complete',
        finishReason: 'stop',
        error: null,
        usage: null,
        costUsd: null,
        ...over,
      }
    },
    compaction(summary: string, coversThroughEventId: string): CompactionEvent {
      return { ...base(), type: 'compaction', summary, coversThroughEventId }
    },
  }
}

export function attachment(
  id: string,
  kind: 'image' | 'file',
  bytes = 10,
  name = `${id}.${kind === 'image' ? 'png' : 'pdf'}`,
): StoredAttachment {
  const mime = kind === 'image' ? 'image/png' : 'application/pdf'
  return { id, name, mime, size: bytes, kind, dataUrl: `data:${mime};base64,${'A'.repeat(bytes)}` }
}

export function refOf(a: StoredAttachment): AttachmentRef {
  return { id: a.id, name: a.name, mime: a.mime, size: a.size, kind: a.kind }
}

export function attachmentMap(...items: StoredAttachment[]) {
  return new Map(items.map((a) => [a.id, a]))
}

export type { SessionEvent }
