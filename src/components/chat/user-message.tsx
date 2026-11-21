import { FileText, ImageIcon } from 'lucide-react'
import type { UserMessageEvent } from '@/lib/harness/session/format'

export function UserMessage({ event, evictedIds }: { event: UserMessageEvent; evictedIds: string[] }) {
  return (
    <div className="flex justify-end">
      <div className="surface-inner text-text-1 max-w-[85%] px-4 py-2.5 text-[15px] leading-7 sm:max-w-[75%]">
        {event.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {event.attachments.map((a) => (
              <span
                key={a.id}
                className="bg-btn text-text-2 inline-flex max-w-full items-center gap-1.5 rounded-[var(--radius-chip)] px-2 py-1 text-xs"
              >
                {a.kind === 'image' ? <ImageIcon className="size-3.5" /> : <FileText className="size-3.5" />}
                <span className="truncate">{a.name}</span>
                {evictedIds.includes(a.id) && <span className="text-text-3">· out of context</span>}
              </span>
            ))}
          </div>
        )}
        {event.text && <p className="whitespace-pre-wrap">{event.text}</p>}
      </div>
    </div>
  )
}
