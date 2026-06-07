import { describe, it, expect } from 'vitest'
import {
  tickStateFor,
  isTypingActive,
  TICK_CLOCK_MS,
  TICK_GRAY_MS,
  TICK_BLUE_MS,
  type Cycle,
  cycleReducer,
} from '../cycle'
import type { ChatMessage } from '../../ChatClient'

const baseCycle = (overrides: Partial<Cycle> = {}): Cycle => ({
  startedAt: 1000,
  userMsgIds: ['m1'],
  pendingAIs: [],
  ...overrides,
})

describe('tickStateFor', () => {
  it("returns 'idle' when cycle is null", () => {
    expect(tickStateFor('m1', null, 9999)).toBe('idle')
  })

  it("returns 'idle' when msgId is not in userMsgIds", () => {
    expect(tickStateFor('other', baseCycle(), 1000)).toBe('idle')
  })

  it("returns 'clock' when elapsed = 0", () => {
    expect(tickStateFor('m1', baseCycle(), 1000)).toBe('clock')
  })

  it("returns 'clock' when elapsed = TICK_CLOCK_MS - 1", () => {
    expect(tickStateFor('m1', baseCycle(), 1000 + TICK_CLOCK_MS - 1)).toBe(
      'clock',
    )
  })

  it("returns 'gray' when elapsed = TICK_CLOCK_MS", () => {
    expect(tickStateFor('m1', baseCycle(), 1000 + TICK_CLOCK_MS)).toBe('gray')
  })

  it("returns 'gray' when elapsed = TICK_GRAY_MS - 1", () => {
    expect(tickStateFor('m1', baseCycle(), 1000 + TICK_GRAY_MS - 1)).toBe(
      'gray',
    )
  })

  it("returns 'blue' when elapsed = TICK_GRAY_MS", () => {
    expect(tickStateFor('m1', baseCycle(), 1000 + TICK_GRAY_MS)).toBe('blue')
  })

  it("returns 'blue' for very large elapsed", () => {
    expect(tickStateFor('m1', baseCycle(), 1_000_000_000)).toBe('blue')
  })
})

describe('isTypingActive', () => {
  it('returns false when cycle is null', () => {
    expect(isTypingActive(null, 9999)).toBe(false)
  })

  it('returns false when elapsed < TICK_BLUE_MS', () => {
    expect(isTypingActive(baseCycle(), 1000 + TICK_BLUE_MS - 1)).toBe(false)
  })

  it('returns true when elapsed = TICK_BLUE_MS', () => {
    expect(isTypingActive(baseCycle(), 1000 + TICK_BLUE_MS)).toBe(true)
  })

  it('returns true for very large elapsed', () => {
    expect(isTypingActive(baseCycle(), 1_000_000_000)).toBe(true)
  })
})

const aiMsg = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'ai-1',
  role: 'assistant',
  content: 'hi',
  message_type: 'text',
  media_url: null,
  created_at: '2026-05-29T00:00:00Z',
  reply_to_message_id: null,
  ...overrides,
})

describe('cycleReducer / startOrExtend', () => {
  it('creates a new cycle from null', () => {
    const res = cycleReducer(null, {
      type: 'startOrExtend',
      userMsgId: 'a',
      now: 1000,
    })
    expect(res.cycle).toEqual({
      startedAt: 1000,
      userMsgIds: ['a'],
      pendingAIs: [],
    })
    expect(res.releaseAI).toEqual([])
  })

  it('appends id and resets startedAt when cycle exists', () => {
    const existing: Cycle = {
      startedAt: 500,
      userMsgIds: ['a'],
      pendingAIs: [aiMsg()],
    }
    const res = cycleReducer(existing, {
      type: 'startOrExtend',
      userMsgId: 'b',
      now: 2000,
    })
    expect(res.cycle).toEqual({
      startedAt: 2000,
      userMsgIds: ['a', 'b'],
      pendingAIs: [aiMsg()],
    })
  })

  it('does not duplicate ids', () => {
    const existing: Cycle = {
      startedAt: 500,
      userMsgIds: ['a'],
      pendingAIs: [],
    }
    const res = cycleReducer(existing, {
      type: 'startOrExtend',
      userMsgId: 'a',
      now: 2000,
    })
    expect(res.cycle?.userMsgIds).toEqual(['a'])
    expect(res.cycle?.startedAt).toBe(2000)
  })
})

describe('cycleReducer / renameInCycle', () => {
  it('no-op when cycle is null', () => {
    expect(
      cycleReducer(null, {
        type: 'renameInCycle',
        tempId: 't',
        realId: 'r',
      }),
    ).toEqual({ cycle: null, releaseAI: [] })
  })

  it('replaces tempId with realId', () => {
    const existing: Cycle = {
      startedAt: 500,
      userMsgIds: ['temp-1', 'temp-2'],
      pendingAIs: [],
    }
    const res = cycleReducer(existing, {
      type: 'renameInCycle',
      tempId: 'temp-1',
      realId: 'real-1',
    })
    expect(res.cycle?.userMsgIds).toEqual(['real-1', 'temp-2'])
  })

  it('no-op when tempId not present', () => {
    const existing: Cycle = {
      startedAt: 500,
      userMsgIds: ['a'],
      pendingAIs: [],
    }
    const res = cycleReducer(existing, {
      type: 'renameInCycle',
      tempId: 'x',
      realId: 'y',
    })
    expect(res.cycle?.userMsgIds).toEqual(['a'])
  })
})

describe('cycleReducer / cancelFor', () => {
  it('no-op when cycle is null', () => {
    expect(
      cycleReducer(null, { type: 'cancelFor', userMsgId: 'x' }),
    ).toEqual({ cycle: null, releaseAI: [] })
  })

  it('removes id, keeps cycle when set non-empty', () => {
    const existing: Cycle = {
      startedAt: 500,
      userMsgIds: ['a', 'b'],
      pendingAIs: [aiMsg()],
    }
    const res = cycleReducer(existing, { type: 'cancelFor', userMsgId: 'a' })
    expect(res.cycle).toEqual({
      startedAt: 500,
      userMsgIds: ['b'],
      pendingAIs: [aiMsg()],
    })
  })

  it('nullifies cycle when set becomes empty (drops pendingAIs)', () => {
    const existing: Cycle = {
      startedAt: 500,
      userMsgIds: ['a'],
      pendingAIs: [aiMsg()],
    }
    const res = cycleReducer(existing, { type: 'cancelFor', userMsgId: 'a' })
    expect(res.cycle).toBeNull()
    expect(res.releaseAI).toEqual([])
  })
})

describe('cycleReducer / holdOrRelease', () => {
  it('releases immediately when cycle is null', () => {
    const msg = aiMsg()
    const res = cycleReducer(null, {
      type: 'holdOrRelease',
      msg,
      now: 9999,
    })
    expect(res.cycle).toBeNull()
    expect(res.releaseAI).toEqual([msg])
  })

  it('holds when elapsed < TICK_BLUE_MS', () => {
    const existing: Cycle = {
      startedAt: 1000,
      userMsgIds: ['a'],
      pendingAIs: [],
    }
    const msg = aiMsg()
    const res = cycleReducer(existing, {
      type: 'holdOrRelease',
      msg,
      now: 1000 + TICK_BLUE_MS - 1,
    })
    expect(res.releaseAI).toEqual([])
    expect(res.cycle?.pendingAIs).toEqual([msg])
  })

  it('releases pending plus new msg when elapsed >= TICK_BLUE_MS', () => {
    const held = aiMsg({ id: 'held', content: 'held' })
    const existing: Cycle = {
      startedAt: 1000,
      userMsgIds: ['a'],
      pendingAIs: [held],
    }
    const msg = aiMsg()
    const res = cycleReducer(existing, {
      type: 'holdOrRelease',
      msg,
      now: 1000 + TICK_BLUE_MS,
    })
    expect(res.releaseAI).toEqual([held, msg])
    expect(res.cycle).toBeNull()
  })

  it('accumulates multiple held messages instead of replacing', () => {
    const first = aiMsg({ id: 'a1', content: 'first' })
    const existing: Cycle = {
      startedAt: 1000,
      userMsgIds: ['a'],
      pendingAIs: [first],
    }
    const second = aiMsg({ id: 'a2', content: 'second' })
    const res = cycleReducer(existing, {
      type: 'holdOrRelease',
      msg: second,
      now: 1100,
    })
    expect(res.releaseAI).toEqual([])
    expect(res.cycle?.pendingAIs).toEqual([first, second])
  })
})

describe('cycleReducer / tickElapsed', () => {
  it('no-op when cycle is null', () => {
    expect(cycleReducer(null, { type: 'tickElapsed', now: 9999 })).toEqual({
      cycle: null,
      releaseAI: [],
    })
  })

  it('no-op when pendingAIs is empty', () => {
    const existing: Cycle = {
      startedAt: 1000,
      userMsgIds: ['a'],
      pendingAIs: [],
    }
    const res = cycleReducer(existing, {
      type: 'tickElapsed',
      now: 1000 + TICK_BLUE_MS,
    })
    expect(res.cycle).toBe(existing)
    expect(res.releaseAI).toEqual([])
  })

  it('no-op when pendingAIs present but elapsed < TICK_BLUE_MS', () => {
    const msg = aiMsg()
    const existing: Cycle = {
      startedAt: 1000,
      userMsgIds: ['a'],
      pendingAIs: [msg],
    }
    const res = cycleReducer(existing, {
      type: 'tickElapsed',
      now: 1000 + TICK_BLUE_MS - 1,
    })
    expect(res.releaseAI).toEqual([])
    expect(res.cycle).toBe(existing)
  })

  it('releases all pendingAIs and nullifies cycle when elapsed >= TICK_BLUE_MS', () => {
    const p1 = aiMsg({ id: 'p1', content: 'prod-1' })
    const p2 = aiMsg({ id: 'p2', content: 'prod-2' })
    const text = aiMsg({ id: 't', content: 'texto' })
    const existing: Cycle = {
      startedAt: 1000,
      userMsgIds: ['a'],
      pendingAIs: [p1, p2, text],
    }
    const res = cycleReducer(existing, {
      type: 'tickElapsed',
      now: 1000 + TICK_BLUE_MS,
    })
    expect(res.releaseAI).toEqual([p1, p2, text])
    expect(res.cycle).toBeNull()
  })
})
