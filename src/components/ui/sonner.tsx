'use client'

import { Toaster as Sonner, type ToasterProps } from 'sonner'

/** Toasts styled as in be-promptful (components/app-shell.tsx). */
function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      position="bottom-right"
      mobileOffset={{
        bottom: 'calc(env(safe-area-inset-bottom) + 16px)',
        left: '16px',
        right: '16px',
      }}
      toastOptions={{
        style: {
          background: 'hsl(0 0% 4%)',
          border: '1px solid hsl(0 0% 15%)',
          color: 'hsl(0 0% 98%)',
        },
        classNames: {
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
