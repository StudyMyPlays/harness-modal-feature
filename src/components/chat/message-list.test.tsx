// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeEvents } from '@/test/sessions'
import { MessageList } from './message-list'

afterEach(cleanup)

describe('MessageList', () => {
  it('offers Retry only on the latest reply, since retry regenerates the latest reply', () => {
    const e = makeEvents()
    const err = { message: 'busy', status: 429 }
    render(
      <MessageList
        events={[
          e.user('one'),
          e.assistant('', { status: 'error', error: err }),
          e.user('two'),
          e.assistant('', { status: 'error', error: err }),
        ]}
        evictedIds={[]}
        streaming={false}
        onRetry={() => {}}
        onEditLast={() => {}}
      />,
    )
    expect(screen.getAllByText('busy')).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1)
  })
})
