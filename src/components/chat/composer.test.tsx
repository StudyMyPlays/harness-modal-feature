// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Composer } from './composer'

afterEach(cleanup)

function setup(over: Partial<Parameters<typeof Composer>[0]> = {}) {
  const props = {
    onSend: vi.fn(),
    onStop: vi.fn(),
    streaming: false,
    supportsVision: true,
    webSearch: 'off' as const,
    onWebSearchChange: vi.fn(),
    ...over,
  }
  render(<Composer {...props} />)
  return { props, input: screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement }
}

function attach(name: string, type: string, size: number) {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  fireEvent.change(screen.getByLabelText('Attach files'), { target: { files: [file] } })
  return file
}

describe('Composer', () => {
  it('Enter sends trimmed text and clears; Shift+Enter inserts newline', () => {
    const { props, input } = setup()
    fireEvent.change(input, { target: { value: '  hello  ' } })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(props.onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onSend).toHaveBeenCalledWith('hello', [])
    expect(input.value).toBe('')
  })

  it('does not send on Enter while composing with an IME', () => {
    const { props, input } = setup()
    fireEvent.change(input, { target: { value: 'こんにちは' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(props.onSend).not.toHaveBeenCalled()
  })

  it('send disabled for empty text and no files', () => {
    const { input } = setup()
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(input, { target: { value: '   ' } })
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('sends attachments with the text', () => {
    const { props, input } = setup()
    const file = attach('notes.pdf', 'application/pdf', 100)
    expect(screen.getByText('notes.pdf')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'read this' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(props.onSend).toHaveBeenCalledWith('read this', [file])
    expect(screen.queryByText('notes.pdf')).toBeNull()
  })

  it('removes an attachment chip', () => {
    setup()
    attach('notes.pdf', 'application/pdf', 100)
    fireEvent.click(screen.getByRole('button', { name: 'Remove notes.pdf' }))
    expect(screen.queryByText('notes.pdf')).toBeNull()
  })

  it('oversize file shows inline error and is not attached', () => {
    setup()
    attach('huge.pdf', 'application/pdf', 4 * 1024 * 1024 + 1)
    expect(screen.getByRole('alert').textContent).toBe('"huge.pdf" is over 4 MB.')
    expect(screen.queryByRole('button', { name: 'Remove huge.pdf' })).toBeNull()
  })

  it('image refused when supportsVision false', () => {
    setup({ supportsVision: false })
    attach('cat.png', 'image/png', 100)
    expect(screen.getByRole('alert').textContent).toBe('This model can’t read images.')
  })

  it('while streaming the send button is a Stop button calling onStop', () => {
    const { props } = setup({ streaming: true })
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(props.onStop).toHaveBeenCalled()
  })

  it('Enter does not send while streaming', () => {
    const { props, input } = setup({ streaming: true })
    fireEvent.change(input, { target: { value: 'queued' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(props.onSend).not.toHaveBeenCalled()
  })

  it('web search toggle cycles off→auto→on', () => {
    const onWebSearchChange = vi.fn()
    const { unmount } = render(
      <Composer onSend={() => {}} onStop={() => {}} streaming={false} supportsVision webSearch="off" onWebSearchChange={onWebSearchChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /web search: off/i }))
    expect(onWebSearchChange).toHaveBeenLastCalledWith('auto')
    unmount()
    render(
      <Composer onSend={() => {}} onStop={() => {}} streaming={false} supportsVision webSearch="auto" onWebSearchChange={onWebSearchChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /web search: auto/i }))
    expect(onWebSearchChange).toHaveBeenLastCalledWith('on')
    cleanup()
    render(
      <Composer onSend={() => {}} onStop={() => {}} streaming={false} supportsVision webSearch="on" onWebSearchChange={onWebSearchChange} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /web search: on/i }))
    expect(onWebSearchChange).toHaveBeenLastCalledWith('off')
  })
})
