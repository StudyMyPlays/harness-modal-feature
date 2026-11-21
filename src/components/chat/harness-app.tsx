'use client'

import { useEffect, useState } from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useChatController, useControllerState } from '@/lib/harness/client/use-chat'
import { ChatView } from './chat-view'
import { SettingsSheet } from './settings-sheet'
import { Sidebar } from './sidebar'
import { UnlockScreen } from './unlock-screen'

type Gate = 'checking' | 'locked' | 'open'

/** The whole app: the passcode gate, then sidebar + chat. */
export function HarnessApp() {
  const controller = useChatController()
  const ready = useControllerState((s) => s.ready)
  const activeId = useControllerState((s) => s.activeChatId)
  const [gate, setGate] = useState<Gate>('checking')
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/unlock')
      .then((r) => r.json())
      .then((b: { required: boolean; unlocked: boolean }) => {
        if (!cancelled) setGate(b.required && !b.unlocked ? 'locked' : 'open')
      })
      .catch(() => !cancelled && setGate('open'))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (gate === 'open' && !controller.getState().ready) void controller.init()
  }, [gate, controller])

  if (gate === 'locked') return <UnlockScreen onUnlocked={() => setGate('open')} />
  if (gate === 'checking' || !ready) {
    return (
      <main className="flex flex-1 items-center justify-center" aria-busy="true">
        <div className="typing-dots text-text-2 text-2xl">
          <span>•</span>
          <span>•</span>
          <span>•</span>
        </div>
      </main>
    )
  }

  const openSettings = () => setSettingsOpen(true)
  return (
    <div className="app-shell flex min-h-0 flex-1">
      <aside className="hidden w-[260px] shrink-0 border-r border-white/5 md:block">
        <Sidebar onSettings={openSettings} />
      </aside>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="bg-surface w-[85vw] max-w-[300px] p-0">
          <SheetTitle className="sr-only">Chats</SheetTitle>
          <Sidebar
            onNavigate={() => setMenuOpen(false)}
            onSettings={() => {
              setMenuOpen(false)
              openSettings()
            }}
          />
        </SheetContent>
      </Sheet>
      <ChatView onOpenMenu={() => setMenuOpen(true)} onOpenSettings={openSettings} />
      <SettingsSheet chatId={activeId} open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
