// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MessageBubble } from '../MessageBubble'
import type { ChatMessage } from '../../ChatClient'

const baseMsg = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  role: 'user',
  content: 'hello',
  message_type: 'text',
  media_url: null,
  created_at: '2026-05-29T12:00:00Z',
  ...overrides,
})

describe('MessageBubble tick rendering', () => {
  it("renders blue double-check when role='user' + tickState='idle'", () => {
    const { container } = render(
      <MessageBubble message={baseMsg()} tickState="idle" />,
    )
    const tick = container.querySelector('[aria-label="lida"]')
    expect(tick).not.toBeNull()
  })

  it("renders clock when role='user' + tickState='clock'", () => {
    const { container } = render(
      <MessageBubble message={baseMsg()} tickState="clock" />,
    )
    expect(container.querySelector('[aria-label="enviando"]')).not.toBeNull()
  })

  it("renders gray double-check when role='user' + tickState='gray'", () => {
    const { container } = render(
      <MessageBubble message={baseMsg()} tickState="gray" />,
    )
    const tick = container.querySelector('[aria-label="entregue"]')
    expect(tick).not.toBeNull()
    expect((tick as HTMLElement).style.color).toBe('rgb(134, 150, 160)')
  })

  it("renders blue double-check when role='user' + tickState='blue'", () => {
    const { container } = render(
      <MessageBubble message={baseMsg()} tickState="blue" />,
    )
    const tick = container.querySelector('[aria-label="lida"]')
    expect(tick).not.toBeNull()
    expect((tick as HTMLElement).style.color).toBe('rgb(52, 183, 241)')
  })

  it("renders fixed blue tick when role='assistant' regardless of tickState", () => {
    const { container } = render(
      <MessageBubble message={baseMsg({ role: 'assistant' })} tickState="clock" />,
    )
    const tick = container.querySelector('[aria-label="lida"]')
    expect(tick).not.toBeNull()
    expect((tick as HTMLElement).style.color).toBe('rgb(52, 183, 241)')
  })

  it("renders system bubble with no tick and no time", () => {
    const { container } = render(
      <MessageBubble
        message={baseMsg({ role: 'system', content: 'aviso' })}
        tickState="blue"
      />,
    )
    expect(container.textContent).toContain('aviso')
    expect(container.querySelector('[aria-label="lida"]')).toBeNull()
  })
})
