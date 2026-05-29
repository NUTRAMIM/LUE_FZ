import { describe, it, expect } from 'vitest'
import {
  tickStateFor,
  isTypingActive,
  TICK_CLOCK_MS,
  TICK_GRAY_MS,
  TICK_BLUE_MS,
  type Cycle,
} from '../cycle'

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
