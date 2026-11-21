'use client'

import { Archive, Save, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { saveDefaults } from '@/lib/harness/client/controller'
import { useChatController, useControllerState } from '@/lib/harness/client/use-chat'
import type { Chat, ChatSettings } from '@/lib/harness/session/format'
import type { McpServerStatus } from '@/lib/harness/tools/mcp'
import { cn } from '@/lib/utils'
import { formatUsd } from './usage-badge'

const PRESETS_KEY = 'harness.presets'

interface Preset {
  name: string
  settings: Omit<ChatSettings, 'model'> & { model?: string }
}

function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function storePresets(list: Preset[]) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(list))
  } catch {
    toast.error('Couldn’t save presets in this browser.')
  }
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-text-1 text-sm font-medium">{label}</div>
      {children}
      {hint && <p className="text-text-3 text-xs">{hint}</p>}
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition',
        checked ? 'bg-primary' : 'bg-track',
      )}
    >
      <span
        className={cn(
          'bg-background inline-block size-4 rounded-full shadow transition-transform',
          checked ? 'translate-x-4.5' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

/** Per-chat settings: system prompt, reasoning, temperature, tools, presets. */
export function SettingsSheet({
  chatId,
  open,
  onOpenChange,
}: {
  chatId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const chats = useControllerState((s) => s.chats)
  const chat = chats.find((c) => c.id === chatId) ?? null
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="surface-card w-full overflow-y-auto rounded-none sm:max-w-md">
        <SheetHeader className="pr-12">
          <SheetTitle className="type-section">Chat settings</SheetTitle>
          <SheetDescription className="text-text-2">Applies to this chat.</SheetDescription>
        </SheetHeader>
        {/* Mounted only while open, and keyed by chat, so its state starts fresh each time. */}
        {chat && <SettingsBody key={chat.id} chat={chat} />}
      </SheetContent>
    </Sheet>
  )
}

function SettingsBody({ chat }: { chat: Chat }) {
  const controller = useChatController()
  const models = useControllerState((s) => s.models)
  const balance = useControllerState((s) => s.balanceUsd)
  const compacting = useControllerState((s) => s.compacting)
  const streaming = useControllerState((s) => s.streaming)
  const model = models.find((m) => m.id === chat.settings.model)

  const [prompt, setPrompt] = useState(chat.settings.systemPrompt)
  const [servers, setServers] = useState<McpServerStatus[] | null>(null)
  const [presets, setPresets] = useState<Preset[]>(loadPresets)
  const [presetName, setPresetName] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/tools')
      .then((r) => (r.ok ? r.json() : { servers: [] }))
      .then((b: { servers: McpServerStatus[] }) => !cancelled && setServers(b.servers))
      .catch(() => !cancelled && setServers([]))
    return () => {
      cancelled = true
    }
  }, [])

  const s = chat.settings
  const update = (patch: Partial<ChatSettings>) => controller.updateSettings(chat.id, patch)

  return (
    <div className="space-y-6 px-4 pb-8">
      <Field label="System prompt" hint="Sent before every message in this chat.">
        <textarea
          value={prompt}
          rows={6}
          onChange={(e) => setPrompt(e.target.value)}
          onBlur={() => prompt !== s.systemPrompt && update({ systemPrompt: prompt })}
          placeholder="You are a helpful assistant…"
          className="surface-inner text-text-1 placeholder:text-text-3 w-full resize-y px-3 py-2 text-sm outline-none focus:[--ring-subtle:var(--color-primary)]"
        />
      </Field>

      {model && model.reasoningEffortOptions.length > 0 && (
        <Field label="Reasoning effort" hint={`Model default: ${model.defaultReasoningEffort ?? 'auto'}.`}>
          <div className="flex flex-wrap gap-1.5">
            {[null, ...model.reasoningEffortOptions].map((opt) => (
              <button
                key={opt ?? 'default'}
                type="button"
                aria-pressed={s.reasoningEffort === opt}
                onClick={() => update({ reasoningEffort: opt })}
                className={cn(
                  'rounded-[var(--radius-chip)] px-3 py-1.5 text-xs transition',
                  s.reasoningEffort === opt ? 'bg-primary text-primary-foreground' : 'bg-btn text-text-2 hover:text-text-1',
                )}
              >
                {opt ?? 'default'}
              </button>
            ))}
          </div>
        </Field>
      )}

      <Field label="Temperature" hint="Higher is more varied. Off uses the model’s default.">
        <div className="flex items-center gap-3">
          <Toggle
            label="Set temperature"
            checked={s.temperature !== null}
            onChange={(on) => update({ temperature: on ? 0.7 : null })}
          />
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            aria-label="Temperature"
            disabled={s.temperature === null}
            value={s.temperature ?? 0.7}
            onChange={(e) => update({ temperature: Number(e.target.value) })}
            className="accent-primary flex-1 disabled:opacity-40"
          />
          <span className="text-text-2 w-8 text-right text-xs tabular-nums">
            {s.temperature === null ? '—' : s.temperature.toFixed(1)}
          </span>
        </div>
      </Field>

      <Field label="Venice system prompt" hint="Venice adds its own default prompt when this is on.">
        <Toggle
          label="Include Venice system prompt"
          checked={s.includeVeniceSystemPrompt}
          onChange={(v) => update({ includeVeniceSystemPrompt: v })}
        />
      </Field>

      <Field label="Tools (MCP servers)" hint="Configured on the server with MCP_SERVERS.">
        {servers === null ? (
          <p className="text-text-3 text-xs">Loading…</p>
        ) : servers.length === 0 ? (
          <p className="text-text-3 text-xs">No MCP servers are configured.</p>
        ) : (
          <ul className="space-y-1.5">
            {servers.map((srv) => (
              <li key={srv.name} className="surface-inner flex items-center gap-2 px-3 py-2 text-sm">
                <span
                  aria-hidden
                  className={cn('size-2 rounded-full', srv.ok ? 'bg-primary' : 'bg-destructive')}
                />
                <span className="text-text-1 flex-1 truncate">{srv.name}</span>
                <span className="text-text-3 text-xs">{srv.ok ? `${srv.toolCount} tools` : srv.error}</span>
                <Toggle
                  label={`Use ${srv.name}`}
                  checked={s.mcpServers.includes(srv.name)}
                  onChange={(on) =>
                    update({
                      mcpServers: on ? [...s.mcpServers, srv.name] : s.mcpServers.filter((n) => n !== srv.name),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Field>

      <Field label="Presets" hint="Saved in this browser.">
        <div className="flex gap-2">
          <input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="Preset name"
            aria-label="Preset name"
            className="surface-inner text-text-1 placeholder:text-text-3 min-w-0 flex-1 px-3 py-1.5 text-sm outline-none"
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={!presetName.trim()}
            onClick={() => {
              const name = presetName.trim()
              const next = [...presets.filter((p) => p.name !== name), { name, settings: { ...s, systemPrompt: prompt } }]
              setPresets(next)
              storePresets(next)
              setPresetName('')
              toast.success(`Saved “${name}”.`)
            }}
          >
            <Save className="size-3.5" /> Save
          </Button>
        </div>
        {presets.length > 0 && (
          <ul className="mt-2 space-y-1">
            {presets.map((p) => (
              <li key={p.name} className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  className="text-text-1 hover:text-primary flex-1 truncate text-left"
                  onClick={() => {
                    const { model: presetModel, ...rest } = p.settings
                    const valid = presetModel && models.some((m) => m.id === presetModel)
                    update({ ...rest, ...(valid ? { model: presetModel } : {}) })
                    setPrompt(rest.systemPrompt)
                    toast.success(`Applied “${p.name}”.`)
                  }}
                >
                  {p.name}
                </button>
                <button
                  type="button"
                  aria-label={`Delete preset ${p.name}`}
                  className="text-text-3 hover:text-destructive"
                  onClick={() => {
                    const next = presets.filter((x) => x.name !== p.name)
                    setPresets(next)
                    storePresets(next)
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            saveDefaults({ ...s, systemPrompt: prompt })
            toast.success('New chats will start with these settings.')
          }}
        >
          Use for new chats
        </Button>
        <Button size="sm" variant="secondary" disabled={compacting || streaming} onClick={() => controller.compactNow()}>
          <Archive className="size-3.5" /> {compacting ? 'Summarising…' : 'Compact now'}
        </Button>
      </div>

      {balance !== null && (
        <p className="text-text-3 text-xs">
          Venice balance: <span className="text-text-1 tabular-nums">{formatUsd(balance)}</span>
        </p>
      )}
    </div>
  )
}
