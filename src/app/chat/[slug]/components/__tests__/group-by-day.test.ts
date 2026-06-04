import { describe, it, expect } from 'vitest'
import { groupMessagesByDay } from '../group-by-day'
import type { ChatMessage } from '../../ChatClient'

const msg = (id: string, isoDate: string): ChatMessage => ({
  id,
  role: 'user',
  content: id,
  message_type: 'text',
  media_url: null,
  created_at: isoDate,
  reply_to_message_id: null,
})

// All timestamps anchored to local-noon to avoid TZ flakiness near midnight.
const NOW = new Date(2026, 4, 29, 12, 0, 0).getTime() // 2026-05-29 12:00 local

describe('groupMessagesByDay', () => {
  it('returns empty array for empty input', () => {
    expect(groupMessagesByDay([], NOW)).toEqual([])
  })

  it('labels today messages as "Hoje"', () => {
    const today = new Date(2026, 4, 29, 9, 0, 0).toISOString()
    const groups = groupMessagesByDay([msg('a', today)], NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Hoje')
    expect(groups[0].messages.map((m) => m.id)).toEqual(['a'])
  })

  it('labels yesterday messages as "Ontem"', () => {
    const yesterday = new Date(2026, 4, 28, 18, 0, 0).toISOString()
    const groups = groupMessagesByDay([msg('a', yesterday)], NOW)
    expect(groups[0].label).toBe('Ontem')
  })

  it('labels older messages as DD/MM/YYYY (zero-padded)', () => {
    const old = new Date(2026, 0, 3, 10, 0, 0).toISOString() // 03/01/2026
    const groups = groupMessagesByDay([msg('a', old)], NOW)
    expect(groups[0].label).toBe('03/01/2026')
  })

  it('groups multiple messages from the same day under one label', () => {
    const today1 = new Date(2026, 4, 29, 8, 0, 0).toISOString()
    const today2 = new Date(2026, 4, 29, 14, 0, 0).toISOString()
    const groups = groupMessagesByDay(
      [msg('a', today1), msg('b', today2)],
      NOW,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].messages.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('creates separate groups for messages on different days, preserving order', () => {
    const old = new Date(2026, 4, 20, 10, 0, 0).toISOString()
    const yesterday = new Date(2026, 4, 28, 10, 0, 0).toISOString()
    const today = new Date(2026, 4, 29, 10, 0, 0).toISOString()
    const groups = groupMessagesByDay(
      [msg('a', old), msg('b', yesterday), msg('c', today)],
      NOW,
    )
    expect(groups.map((g) => g.label)).toEqual([
      '20/05/2026',
      'Ontem',
      'Hoje',
    ])
    expect(groups.map((g) => g.messages.map((m) => m.id))).toEqual([
      ['a'],
      ['b'],
      ['c'],
    ])
  })
})
