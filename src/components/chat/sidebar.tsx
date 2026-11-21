'use client'

import { Check, MessageSquarePlus, Pencil, Search, Settings2, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { useChatController, useControllerState } from '@/lib/harness/client/use-chat'
import type { Chat } from '@/lib/harness/session/format'
import { cn } from '@/lib/utils'

const DAY = 86_400_000

export function groupChats(chats: Chat[], now: number): { label: string; chats: Chat[] }[] {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const today = start.getTime()
  const groups = [
    { label: 'Today', test: (t: number) => t >= today },
    { label: 'Yesterday', test: (t: number) => t >= today - DAY },
    { label: 'Previous 7 days', test: (t: number) => t >= today - 7 * DAY },
    { label: 'Older', test: () => true },
  ].map((g) => ({ ...g, chats: [] as Chat[] }))
  for (const c of [...chats].sort((a, b) => b.updatedAt - a.updatedAt)) {
    groups.find((g) => g.test(c.updatedAt))!.chats.push(c)
  }
  return groups.filter((g) => g.chats.length).map(({ label, chats }) => ({ label, chats }))
}

interface SidebarViewProps {
  chats: Chat[]
  activeId: string | null
  now: number
  onNew: () => void
  onOpen: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onSettings: () => void
}

function ChatRow({
  chat,
  active,
  onOpen,
  onRename,
  onDelete,
}: {
  chat: Chat
  active: boolean
  onOpen: () => void
  onRename: (title: string) => void
  onDelete: () => void
}) {
  const [mode, setMode] = useState<'view' | 'rename' | 'confirm'>('view')
  const [draft, setDraft] = useState(chat.title)

  if (mode === 'rename') {
    return (
      <input
        autoFocus
        aria-label="Chat title"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setMode('view')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (draft.trim()) onRename(draft.trim())
            setMode('view')
          } else if (e.key === 'Escape') {
            setMode('view')
          }
        }}
        className="surface-inner text-text-1 w-full px-2.5 py-1.5 text-sm outline-none"
      />
    )
  }

  if (mode === 'confirm') {
    return (
      <div
        role="group"
        aria-label={`Delete ${chat.title}?`}
        className="bg-destructive/10 flex items-center gap-1 rounded-[var(--radius-row)] px-2.5 py-1.5 text-sm"
      >
        <span className="text-text-1 flex-1 truncate">Delete “{chat.title}”?</span>
        <button
          type="button"
          aria-label="Delete"
          onClick={onDelete}
          className="text-destructive hover:bg-destructive/20 rounded p-1"
        >
          <Check className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Cancel"
          onClick={() => setMode('view')}
          className="text-text-2 hover:text-text-1 rounded p-1"
        >
          <X className="size-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'group/row relative flex items-center rounded-[var(--radius-row)] transition',
        active ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? 'page' : undefined}
        className={cn('min-w-0 flex-1 truncate px-2.5 py-2 text-left text-sm', active ? 'text-text-1' : 'text-text-2')}
      >
        {chat.title}
      </button>
      <div className="flex shrink-0 items-center pr-1 opacity-0 transition group-focus-within/row:opacity-100 group-hover/row:opacity-100 [@media(pointer:coarse)]:opacity-100">
        <button
          type="button"
          aria-label={`Rename ${chat.title}`}
          onClick={() => {
            setDraft(chat.title)
            setMode('rename')
          }}
          className="text-text-3 hover:text-text-1 rounded p-1"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Delete ${chat.title}`}
          onClick={() => setMode('confirm')}
          className="text-text-3 hover:text-destructive rounded p-1"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

/** The chat list, without any wiring: what the tests render. */
export function SidebarView({ chats, activeId, now, onNew, onOpen, onRename, onDelete, onSettings }: SidebarViewProps) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const visible = q ? chats.filter((c) => c.title.toLowerCase().includes(q)) : chats

  return (
    <nav aria-label="Chats" className="flex h-full flex-col gap-3 p-3">
      <button
        type="button"
        onClick={onNew}
        className="surface-card text-text-1 hover:text-primary flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition"
      >
        <MessageSquarePlus className="text-primary size-4" />
        New chat
      </button>

      <label className="surface-inner flex items-center gap-2 px-2.5 py-1.5">
        <Search className="text-text-3 size-3.5" />
        <input
          type="search"
          aria-label="Search chats"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="text-text-1 placeholder:text-text-3 w-full bg-transparent text-sm outline-none"
        />
      </label>

      <div className="scrollbar-hide -mx-1 flex-1 space-y-4 overflow-y-auto px-1">
        {groupChats(visible, now).map((g) => (
          <section key={g.label}>
            <h2 className="text-text-3 type-label mb-1 px-2.5 font-medium">{g.label}</h2>
            <ul className="space-y-0.5">
              {g.chats.map((c) => (
                <li key={c.id}>
                  <ChatRow
                    chat={c}
                    active={c.id === activeId}
                    onOpen={() => onOpen(c.id)}
                    onRename={(t) => onRename(c.id, t)}
                    onDelete={() => onDelete(c.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
        {visible.length === 0 && (
          <p className="text-text-3 px-2.5 text-sm">{q ? 'No chats match.' : 'No chats yet.'}</p>
        )}
      </div>

      <button
        type="button"
        onClick={onSettings}
        className="text-text-2 hover:text-text-1 flex items-center gap-2 rounded-[var(--radius-row)] px-2.5 py-2 text-sm transition hover:bg-white/[0.04]"
      >
        <Settings2 className="size-4" />
        Chat settings
      </button>
    </nav>
  )
}

/** The sidebar wired to the chat controller. */
export function Sidebar({ onNavigate, onSettings }: { onNavigate?: () => void; onSettings: () => void }) {
  const controller = useChatController()
  const chats = useControllerState((s) => s.chats)
  const activeId = useControllerState((s) => s.activeChatId)
  const [now] = useState(() => Date.now())
  return (
    <SidebarView
      chats={chats}
      activeId={activeId}
      now={now}
      onNew={() => {
        void controller.newChat()
        onNavigate?.()
      }}
      onOpen={(id) => {
        void controller.openChat(id)
        onNavigate?.()
      }}
      onRename={(id, t) => void controller.renameChat(id, t)}
      onDelete={(id) => void controller.deleteChat(id)}
      onSettings={onSettings}
    />
  )
}
