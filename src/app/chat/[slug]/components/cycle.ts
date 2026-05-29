// src/app/chat/[slug]/components/cycle.ts
import type { ChatMessage } from '../ChatClient'

export const TICK_CLOCK_MS = 3_000
export const TICK_GRAY_MS = 13_000
export const TICK_BLUE_MS = 16_000

export type TickState = 'idle' | 'clock' | 'gray' | 'blue'

export interface Cycle {
  startedAt: number
  userMsgIds: string[]
  pendingAI: ChatMessage | null
}

export function tickStateFor(
  msgId: string,
  cycle: Cycle | null,
  now: number,
): TickState {
  if (cycle === null) return 'idle'
  if (!cycle.userMsgIds.includes(msgId)) return 'idle'
  const elapsed = now - cycle.startedAt
  if (elapsed < TICK_CLOCK_MS) return 'clock'
  if (elapsed < TICK_GRAY_MS) return 'gray'
  return 'blue'
}

export function isTypingActive(cycle: Cycle | null, now: number): boolean {
  if (cycle === null) return false
  return now - cycle.startedAt >= TICK_BLUE_MS
}

export type CycleAction =
  | { type: 'startOrExtend'; userMsgId: string; now: number }
  | { type: 'renameInCycle'; tempId: string; realId: string }
  | { type: 'cancelFor'; userMsgId: string }
  | { type: 'holdOrRelease'; msg: ChatMessage; now: number }
  | { type: 'tickElapsed'; now: number }

export interface CycleResult {
  cycle: Cycle | null
  releaseAI: ChatMessage | null
}

export function cycleReducer(
  cycle: Cycle | null,
  action: CycleAction,
): CycleResult {
  switch (action.type) {
    case 'startOrExtend': {
      if (cycle === null) {
        return {
          cycle: {
            startedAt: action.now,
            userMsgIds: [action.userMsgId],
            pendingAI: null,
          },
          releaseAI: null,
        }
      }
      const ids = cycle.userMsgIds.includes(action.userMsgId)
        ? cycle.userMsgIds
        : [...cycle.userMsgIds, action.userMsgId]
      return {
        cycle: { ...cycle, startedAt: action.now, userMsgIds: ids },
        releaseAI: null,
      }
    }
    case 'renameInCycle': {
      if (cycle === null) return { cycle: null, releaseAI: null }
      if (!cycle.userMsgIds.includes(action.tempId)) {
        return { cycle, releaseAI: null }
      }
      return {
        cycle: {
          ...cycle,
          userMsgIds: cycle.userMsgIds.map((id) =>
            id === action.tempId ? action.realId : id,
          ),
        },
        releaseAI: null,
      }
    }
    case 'cancelFor': {
      if (cycle === null) return { cycle: null, releaseAI: null }
      const ids = cycle.userMsgIds.filter((id) => id !== action.userMsgId)
      if (ids.length === 0) {
        return { cycle: null, releaseAI: null }
      }
      return { cycle: { ...cycle, userMsgIds: ids }, releaseAI: null }
    }
    case 'holdOrRelease': {
      if (cycle === null) {
        return { cycle: null, releaseAI: action.msg }
      }
      const elapsed = action.now - cycle.startedAt
      if (elapsed >= TICK_BLUE_MS) {
        return { cycle, releaseAI: action.msg }
      }
      return {
        cycle: { ...cycle, pendingAI: action.msg },
        releaseAI: null,
      }
    }
    case 'tickElapsed': {
      if (cycle === null || cycle.pendingAI === null) {
        return { cycle, releaseAI: null }
      }
      const elapsed = action.now - cycle.startedAt
      if (elapsed < TICK_BLUE_MS) {
        return { cycle, releaseAI: null }
      }
      return { cycle: null, releaseAI: cycle.pendingAI }
    }
  }
}
