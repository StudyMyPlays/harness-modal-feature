'use client'

import { Menu, Settings2 } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'
import { useChatController, useControllerState } from '@/lib/harness/client/use-chat'
import type { ChatSettings } from '@/lib/harness/session/format'
import { Composer } from './composer'
import { MessageList } from './message-list'
import { ModelPicker } from './model-picker'
import { formatTokens, formatUsd } from './usage-badge'

/** Header, conversation and composer for the active chat. */
export function ChatView({ onOpenMenu, onOpenSettings }: { onOpenMenu: () => void; onOpenSettings: () => void }) {
  const controller = useChatController()
  const activeId = useControllerState((s) => s.activeChatId)
  const chats = useControllerState((s) => s.chats)
  const events = useControllerState((s) => s.events)
  const evictedIds = useControllerState((s) => s.evictedIds)
  const streaming = useControllerState((s) => s.streaming)
  const compacting = useControllerState((s) => s.compacting)
  const models = useControllerState((s) => s.models)
  const defaultModel = useControllerState((s) => s.defaultModel)
  const notice = useControllerState((s) => s.notice)

  const chat = chats.find((c) => c.id === activeId) ?? null
  const modelId = chat?.settings.model ?? defaultModel
  const model = models.find((m) => m.id === modelId)

  useEffect(() => {
    if (!notice) return
    toast(notice)
    controller.dismissNotice()
  }, [notice, controller])

  async function patch(p: Partial<ChatSettings>) {
    const id = activeId ?? (await controller.newChat())
    await controller.updateSettings(id, p)
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-white/5 px-2 sm:px-4">
        <button
          type="button"
          aria-label="Open chats"
          onClick={onOpenMenu}
          className="text-text-2 hover:text-text-1 tap-target inline-flex size-9 items-center justify-center rounded-lg md:hidden"
        >
          <Menu className="size-5" />
        </button>
        <ModelPicker
          models={models}
          value={modelId}
          disabled={streaming}
          // Effort options differ per model, so a model change resets it.
          onChange={(id) => void patch({ model: id, reasoningEffort: null })}
        />
        <div className="ml-auto flex items-center gap-1">
          {chat && chat.totals.costUsd > 0 && (
            <span
              className="text-text-3 type-label hidden tabular-nums sm:inline"
              title={`${formatTokens(chat.totals.inputTokens)} in · ${formatTokens(chat.totals.outputTokens)} out`}
            >
              {formatUsd(chat.totals.costUsd)}
            </span>
          )}
          <button
            type="button"
            aria-label="Chat settings"
            onClick={async () => {
              if (!activeId) await controller.newChat()
              onOpenSettings()
            }}
            className="text-text-2 hover:text-text-1 tap-target inline-flex size-9 items-center justify-center rounded-lg"
          >
            <Settings2 className="size-4.5" />
          </button>
        </div>
      </header>

      {events.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <h1 className="type-greeting text-text-1 font-semibold">What are we working on?</h1>
          <p className="text-text-2 text-sm">{model?.name ?? modelId}</p>
        </div>
      ) : (
        <MessageList
          events={events}
          evictedIds={evictedIds}
          streaming={streaming}
          onRetry={() => void controller.regenerate()}
          onEditLast={(t) => void controller.editLastUserMessage(t)}
        />
      )}

      <div className="mx-auto w-full max-w-3xl shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
        {compacting && <p className="text-text-3 type-label mb-2 px-1">Summarising earlier messages…</p>}
        <Composer
          streaming={streaming}
          supportsVision={model?.supportsVision ?? true}
          webSearch={chat?.settings.webSearch ?? 'off'}
          onWebSearchChange={(mode) => void patch({ webSearch: mode })}
          onSend={(text, files) => controller.send(text, files)}
          onStop={() => controller.stop()}
        />
        <p className="text-text-3 mt-2 text-center text-[11px]">Uncensored models can be wrong. Check what matters.</p>
      </div>
    </div>
  )
}
