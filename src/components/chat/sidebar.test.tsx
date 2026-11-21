// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { chat } from '@/lib/harness/session/store.contract'
import { SidebarView, groupChats } from './sidebar'

afterEach(cleanup)

const DAY = 86_400_000
// Saturday 2026-11-21 15:00 local
const now = new Date(2026, 10, 21, 15, 0).getTime()

const chats = [
  { ...chat('today', now - 3600_000), title: 'Lisbon trip' },
  { ...chat('yday', now - DAY), title: 'Cover letter' },
  { ...chat('week', now - 4 * DAY), title: 'Python bug' },
  { ...chat('old', now - 40 * DAY), title: 'Recipe ideas' },
]

function setup() {
  const props = {
    chats,
    activeId: 'today',
    now,
    onNew: vi.fn(),
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onSettings: vi.fn(),
  }
  render(<SidebarView {...props} />)
  return props
}

describe('groupChats', () => {
  it('groups chats by date bucket', () => {
    expect(groupChats(chats, now).map((g) => [g.label, g.chats.map((c) => c.id)])).toEqual([
      ['Today', ['today']],
      ['Yesterday', ['yday']],
      ['Previous 7 days', ['week']],
      ['Older', ['old']],
    ])
  })

  it('leaves out empty groups', () => {
    expect(groupChats([chats[0]], now).map((g) => g.label)).toEqual(['Today'])
  })
})

describe('SidebarView', () => {
  it('renders groups with headings and marks the active chat', () => {
    setup()
    expect(screen.getByText('Today')).toBeTruthy()
    expect(screen.getByText('Older')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Lisbon trip' }).getAttribute('aria-current')).toBe('page')
  })

  it('search filters by title', () => {
    setup()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search chats' }), { target: { value: 'LETTER' } })
    expect(screen.getByRole('button', { name: 'Cover letter' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Lisbon trip' })).toBeNull()
  })

  it('opens a chat and starts a new one', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Python bug' }))
    expect(props.onOpen).toHaveBeenCalledWith('week')
    fireEvent.click(screen.getByRole('button', { name: /new chat/i }))
    expect(props.onNew).toHaveBeenCalled()
  })

  it('delete asks for confirmation before calling controller.deleteChat', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Python bug' }))
    expect(props.onDelete).not.toHaveBeenCalled()
    const confirm = screen.getByRole('group', { name: 'Delete Python bug?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(props.onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete Python bug' }))
    fireEvent.click(within(screen.getByRole('group', { name: 'Delete Python bug?' })).getByRole('button', { name: 'Delete' }))
    expect(props.onDelete).toHaveBeenCalledWith('week')
  })

  it('renames inline with Enter, and Escape cancels', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Rename Cover letter' }))
    const field = screen.getByRole('textbox', { name: 'Chat title' })
    fireEvent.change(field, { target: { value: 'Bakery cover letter' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(props.onRename).toHaveBeenCalledWith('yday', 'Bakery cover letter')
    fireEvent.click(screen.getByRole('button', { name: 'Rename Cover letter' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Chat title' }), { key: 'Escape' })
    expect(props.onRename).toHaveBeenCalledTimes(1)
  })
})
