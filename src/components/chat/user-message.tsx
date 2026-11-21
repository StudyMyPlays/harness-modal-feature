'use client'

import { FileText, ImageIcon, Pencil } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { UserMessageEvent } from '@/lib/harness/session/format'

export function UserMessage({
  event,
  evictedIds,
  onEdit,
}: {
  event: UserMessageEvent
  evictedIds: string[]
  /** Present only on the last user message, when it can be edited and re-sent. */
  onEdit?: (text: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(event.text)

  if (editing && onEdit) {
    return (
      <div className="flex justify-end">
        <div className="surface-card w-full max-w-[85%] p-3 sm:max-w-[75%]">
          <textarea
            autoFocus
            aria-label="Edit message"
            value={draft}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            className="text-text-1 w-full resize-y bg-transparent text-[15px] leading-7 outline-none"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!draft.trim()}
              onClick={() => {
                setEditing(false)
                onEdit(draft.trim())
              }}
            >
              Send
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="group/user flex items-start justify-end gap-1">
      {onEdit && (
        <button
          type="button"
          aria-label="Edit message"
          onClick={() => {
            setDraft(event.text)
            setEditing(true)
          }}
          className="text-text-3 hover:text-text-1 mt-2 rounded p-1 opacity-0 transition group-hover/user:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100"
        >
          <Pencil className="size-3.5" />
        </button>
      )}
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
        {event.text && <p className="whitespace-pre-wrap break-words">{event.text}</p>}
      </div>
    </div>
  )
}
