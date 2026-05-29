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
  pendingAI: null,
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
      pendingAI: null,
    })
    expect(res.releaseAI).toBeNull()
  })

  it('appends id and resets startedAt when cycle exists', () => {
    const existing: Cycle = {
      startedAt: 500,
      userMsgIds: ['a'],
      pendingAI: aiMsg(),
    }
    const res = cycleReducer(existing, {
      type: 'startOrExtend',
      userMsgId: 'b',
      now: 2000,
    })
    expect(res.cycle).toEqual({
      startedAt: 2000,
      userMsgIds: ['a', 'b'],
      pendingAI: aiMsg(),
    })
  })

  it('does not duplicate ids', () => {
    const existing: Cycle = {
      startedAt: 500,
      userMsgIds: ['a'],
      pendingAI: null,
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
    ).toEqual({ cycle: null, releaseAI: null })
  })

  it('replaces tempId with realId', () => {
    const existing: Cycle = {
      startedAt: 500,
      userMsgIds: ['temp-1', 'temp-2'],
      pendingAI: null,
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
      pendingAI: null,
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
    ).toEqual({ cycle: null, releaseAI: null })
  })

  it('removes id, keeps cycle when set non-empty', () => {
    const existing: Cycle = {
      startedAt: 500,
      userMsgIds: ['a', 'b'],
      pendingAI: aiMsg(),
    }
    const res = cycleReducer(existing, { type: 'cancelFor', userMsgId: 'a' })
    expect(res.cycle).toEqual({
      startedAt: 500,
      userMsgIds: ['b'],
      pendingAI: aiMsg(),
    })
  })

  it('nullifies cycle when set becomes empty (drops pendingAI)', () => {
    const existing: Cycle = {
      startedAt: 500,
      userMsgIds: ['a'],
      pendingAI: aiMsg(),
    }
    const res = cycleReducer(existing, { type: 'cancelFor', userMsgId: 'a' })
    expect(res.cycle).toBeNull()
    expect(res.releaseAI).toBeNull()
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
    expect(res.releaseAI).toBe(msg)
  })

  it('holds when elapsed < TICK_BLUE_MS', () => {
    const existing: Cycle = {
      startedAt: 1000,
      userMsgIds: ['a'],
      pendingAI: null,
    }
    const msg = aiMsg()
    const res = cycleReducer(existing, {
      type: 'holdOrRelease',
      msg,
      now: 1000 + TICK_BLUE_MS - 1,
    })
    expect(res.releaseAI).toBeNull()
    expect(res.cycle?.pendingAI).toBe(msg)
  })

  it('releases when elapsed >= TICK_BLUE_MS', () => {
    const existing: Cycle = {
      startedAt: 1000,
      userMsgIds: ['a'],
      pendingAI: null,
    }
    const msg = aiMsg()
    const res = cycleReducer(existing, {
      type: 'holdOrRelease',
      msg,
      now: 1000 + TICK_BLUE_MS,
    })
    expect(res.releaseAI).toBe(msg)
    expect(res.cycle).toBe(existing)
  })

  it('replaces pendingAI when one already exists', () => {
    const first = aiMsg({ id: 'a1', content: 'first' })
    const existing: Cycle = {
      startedAt: 1000,
      userMsgIds: ['a'],
      pendingAI: first,
    }
    const second = aiMsg({ id: 'a2', content: 'second' })
    const res = cycleReducer(existing, {
      type: 'holdOrRelease',
      msg: second,
      now: 1100,
    })
    expect(res.releaseAI).toBeNull()
    expect(res.cycle?.pendingAI).toBe(second)
  })
})

describe('cycleReducer / tickElapsed', () => {
  it('no-op when cycle is null', () => {
    expect(cycleReducer(null, { type: 'tickElapsed', now: 9999 })).toEqual({
      cycle: null,
      releaseAI: null,
    })
  })

  it('no-op when pendingAI is null', () => {
    const existing: Cycle = {
      startedAt: 1000,
      userMsgIds: ['a'],
      pendingAI: null,
    }
    const res = cycleReducer(existing, {
      type: 'tickElapsed',
      now: 1000 + TICK_BLUE_MS,
    })
    expect(res.cycle).toBe(existing)
    expect(res.releaseAI).toBeNull()
  })

  it('no-op when pendingAI present but elapsed < TICK_BLUE_MS', () => {
    const msg = aiMsg()
    const existing: Cycle = {
      startedAt: 1000,
      userMsgIds: ['a'],
      pendingAI: msg,
    }
    const res = cycleReducer(existing, {
      type: 'tickElapsed',
      now: 1000 + TICK_BLUE_MS - 1,
    })
    expect(res.releaseAI).toBeNull()
    expect(res.cycle).toBe(existing)
  })

  it('releases pendingAI and nullifies cycle when elapsed >= TICK_BLUE_MS', () => {
    const msg = aiMsg()
    const existing: Cycle = {
      startedAt: 1000,
      userMsgIds: ['a'],
      pendingAI: msg,
    }
    const res = cycleReducer(existing, {
      type: 'tickElapsed',
      now: 1000 + TICK_BLUE_MS,
    })
    expect(res.releaseAI).toBe(msg)
    expect(res.cycle).toBeNull()
  })
})
