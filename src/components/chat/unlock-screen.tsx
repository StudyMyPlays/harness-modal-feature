'use client'

import { Lock } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [passcode, setPasscode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  return (
    <main className="flex flex-1 items-center justify-center px-4">
      <form
        className="surface-card w-full max-w-sm space-y-4 p-6"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          try {
            const res = await fetch('/api/unlock', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ passcode }),
            })
            if (res.ok) return onUnlocked()
            if (res.status === 401) setError('That passcode isn’t right.')
            else if (res.status === 429) setError('Too many tries. Wait a minute and try again.')
            else setError('Couldn’t unlock right now. Try again.')
          } catch {
            setError('Couldn’t reach the server.')
          } finally {
            setBusy(false)
          }
        }}
      >
        <div className="bg-primary/10 text-primary inline-flex size-10 items-center justify-center rounded-full">
          <Lock className="size-5" />
        </div>
        <div>
          <h1 className="type-title text-text-1 font-semibold">Harness</h1>
          <p className="text-text-2 mt-1 text-sm">Enter the passcode to continue.</p>
        </div>
        <input
          type="password"
          autoFocus
          aria-label="Passcode"
          autoComplete="current-password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          className="surface-inner text-text-1 w-full px-3 py-2 text-sm outline-none"
        />
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy || !passcode}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </Button>
      </form>
    </main>
  )
}
