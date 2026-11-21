import type { Metadata, Viewport } from 'next'
import { Geist_Mono, Inter_Tight } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

// be-promptful's phone face; desktop uses the system stack.
const interTight = Inter_Tight({
  variable: '--font-inter-tight',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Harness',
  description: 'A private chat harness for Venice models.',
}

export const viewport: Viewport = {
  themeColor: '#09090b',
  colorScheme: 'dark',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistMono.variable} ${interTight.variable} h-full antialiased`}>
      <body className="flex h-dvh flex-col overflow-hidden">
        {children}
        <Toaster />
      </body>
    </html>
  )
}
