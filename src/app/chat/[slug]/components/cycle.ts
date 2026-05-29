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
