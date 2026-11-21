import { describe, expect, it } from 'vitest'
import { classifyFile, fallbackTitle } from './files'

const f = (name: string, type = '', size = 10) => ({ name, type, size })

describe('classifyFile', () => {
  it('accepts supported images by MIME type', () => {
    expect(classifyFile(f('a.png', 'image/png'), true)).toEqual({ ok: true, kind: 'image' })
    expect(classifyFile(f('a.webp', 'image/webp'), true)).toEqual({ ok: true, kind: 'image' })
  })

  it('accepts Venice document and code types by extension', () => {
    for (const name of ['r.pdf', 'd.docx', 's.xlsx', 'n.md', 'x.json', 'main.py', 'app.tsx', 'q.sql', 'c.YAML']) {
      expect(classifyFile(f(name), true)).toEqual({ ok: true, kind: 'file' })
    }
  })

  it('refuses unsupported types', () => {
    expect(classifyFile(f('song.mp3', 'audio/mpeg'), true)).toEqual({
      ok: false,
      error: '"song.mp3" isn’t a supported file type.',
    })
    expect(classifyFile(f('pic.svg', 'image/svg+xml'), true).ok).toBe(false)
  })

  it('refuses files over 4 MB', () => {
    expect(classifyFile(f('big.pdf', 'application/pdf', 4 * 1024 * 1024 + 1), true)).toEqual({
      ok: false,
      error: '"big.pdf" is over 4 MB.',
    })
    expect(classifyFile(f('ok.pdf', 'application/pdf', 4 * 1024 * 1024), true).ok).toBe(true)
  })

  it('refuses images when the model has no vision', () => {
    expect(classifyFile(f('a.png', 'image/png'), false)).toEqual({ ok: false, error: 'This model can’t read images.' })
  })
})

describe('fallbackTitle', () => {
  it('cuts at a word boundary within 40 characters with an ellipsis', () => {
    expect(fallbackTitle('Help me write a cover letter for a job at a bakery downtown')).toBe(
      'Help me write a cover letter for a job…',
    )
  })

  it('keeps short text whole and collapses whitespace', () => {
    expect(fallbackTitle('  hello\n  world ')).toBe('hello world')
  })

  it('names attachment-only messages', () => {
    expect(fallbackTitle('   ')).toBe('New chat')
  })
})
