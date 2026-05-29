# Chat Status Ticks + Typing Indicator + Enter-as-Newline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No chat público (`/chat/[slug]`), do lado do lead: (a) Enter no campo passa a quebrar linha — só o botão envia. (b) Cada mensagem do lead exibe um ciclo visual no canto inferior direito: relógio (0–3s) → tick cinza (3–13s) → tick azul (13s+). (c) 3s depois do tick virar azul, um indicador "digitando" aparece no header (subtitle) e como balão fantasma no fim da lista — a resposta da IA é segurada localmente até completar o ciclo.

**Architecture:** Estado de ciclo isolado em `cycle.ts` (puro, testável). `ChatClient` orquestra: mantém o ciclo em `useReducer` separado, dispara `setInterval(500ms)` enquanto há ciclo ativo, intercepta msgs `assistant`/`operator` do realtime pra segurar ou liberar, e usa um `useRef` (`pendingTempsRef`) pra resolver o race condition de id `temp-` → real entre o INSERT do realtime e o retorno do server action. Componentes filhos (`MessageBubble`, `ChatHeader`, `MessageList`) recebem props derivadas e ficam puramente visuais. CSS de "digitando" reusa a classe `.typing` que já existe em `globals.css:260-278`.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Vitest 4, @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-05-29-chat-status-ticks-typing-design.md`

---

## Task 1: `cycle.ts` — types, `tickStateFor`, `isTypingActive`

**Files:**
- Create: `src/app/chat/[slug]/components/cycle.ts`
- Create: `src/app/chat/[slug]/components/__tests__/cycle.test.ts`

- [ ] **Step 1: Create `cycle.ts` with types and constants only**

```ts
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
  _msgId: string,
  _cycle: Cycle | null,
  _now: number,
): TickState {
  throw new Error('not implemented')
}

export function isTypingActive(_cycle: Cycle | null, _now: number): boolean {
  throw new Error('not implemented')
}
```

- [ ] **Step 2: Write failing tests for `tickStateFor` and `isTypingActive`**

```ts
// src/app/chat/[slug]/components/__tests__/cycle.test.ts
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
```

- [ ] **Step 3: Run tests and confirm they fail**

Run: `npm test -- cycle.test`
Expected: 12 tests fail with `Error: not implemented`.

- [ ] **Step 4: Implement `tickStateFor` and `isTypingActive`**

Replace the stubs in `cycle.ts`:

```ts
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
```

- [ ] **Step 5: Run tests and confirm they pass**

Run: `npm test -- cycle.test`
Expected: 12 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/chat/[slug]/components/cycle.ts src/app/chat/[slug]/components/__tests__/cycle.test.ts
git commit -m "feat(chat): add cycle.ts with tickStateFor and isTypingActive"
```

---

## Task 2: `cycle.ts` — `cycleReducer`

**Files:**
- Modify: `src/app/chat/[slug]/components/cycle.ts`
- Modify: `src/app/chat/[slug]/components/__tests__/cycle.test.ts`

- [ ] **Step 1: Add `CycleAction`, `CycleResult` types, stubbed `cycleReducer`**

Append to `cycle.ts`:

```ts
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
  _cycle: Cycle | null,
  _action: CycleAction,
): CycleResult {
  throw new Error('not implemented')
}
```

- [ ] **Step 2: Write failing tests for `cycleReducer`**

Append to `__tests__/cycle.test.ts`:

```ts
import { cycleReducer } from '../cycle'
import type { ChatMessage } from '../../ChatClient'

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
```

- [ ] **Step 3: Run tests and confirm new ones fail**

Run: `npm test -- cycle.test`
Expected: the 12 first-task tests pass; all `cycleReducer` tests fail with `Error: not implemented`.

- [ ] **Step 4: Implement `cycleReducer`**

Replace the stub in `cycle.ts`:

```ts
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
```

- [ ] **Step 5: Run tests and confirm all pass**

Run: `npm test -- cycle.test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/chat/[slug]/components/cycle.ts src/app/chat/[slug]/components/__tests__/cycle.test.ts
git commit -m "feat(chat): add cycleReducer for tick state management"
```

---

## Task 3: `MessageBubble` — Tick icons (Clock + DoubleCheck) and `tickState` prop

**Files:**
- Modify: `src/app/chat/[slug]/components/MessageBubble.tsx`
- Create: `src/app/chat/[slug]/components/__tests__/MessageBubble.test.tsx`

- [ ] **Step 1: Add `tickState` prop and `TickIcon`/`ClockSvg`/`DoubleCheckSvg` (still wire only for `role === 'user'`)**

Edit `MessageBubble.tsx`:

At the top, change the import line:

```ts
import type { ChatMessage } from '../ChatClient'
import type { TickState } from './cycle'
```

Change the component signature:

```ts
export function MessageBubble({
  message,
  tickState = 'idle',
}: {
  message: ChatMessage
  tickState?: TickState
}) {
```

Replace the existing `<p className="mt-1 text-right text-[10px] text-gray-500">{formatTime(...)}</p>` block with:

```tsx
<p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-gray-500">
  <span>{formatTime(message.created_at)}</span>
  {isUser && <TickIcon state={tickState} />}
</p>
```

Append, at the bottom of `MessageBubble.tsx` (outside `MessageBubble`):

```tsx
function TickIcon({ state }: { state: TickState }) {
  if (state === 'clock') {
    return (
      <span className="text-gray-500" aria-label="enviando">
        <ClockSvg />
      </span>
    )
  }
  const color = state === 'blue' ? '#34B7F1' : '#8696A0'
  const label = state === 'blue' ? 'lida' : 'entregue'
  return (
    <span style={{ color }} aria-label={label}>
      <DoubleCheckSvg />
    </span>
  )
}

function ClockSvg() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5V8L10.5 9.5" strokeLinecap="round" />
    </svg>
  )
}

function DoubleCheckSvg() {
  return (
    <svg
      viewBox="0 0 18 12"
      width="14"
      height="10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 6.5L4 9.5L10 2" />
      <path d="M9 9.5L17 2" />
    </svg>
  )
}
```

(Note: `state === 'idle'` falls through to the double-check branch with `gray` color — but the spec says idle = blue fixed. Fix this in the implementation: change `const color = state === 'blue' ? '#34B7F1' : '#8696A0'` to:

```ts
const color = state === 'blue' || state === 'idle' ? '#34B7F1' : '#8696A0'
```

And `const label = state === 'blue' || state === 'idle' ? 'lida' : 'entregue'`.)

- [ ] **Step 2: Write failing tests for `MessageBubble` with each `tickState`**

```tsx
// src/app/chat/[slug]/components/__tests__/MessageBubble.test.tsx
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

  it("renders no tick when role='assistant'", () => {
    const { container } = render(
      <MessageBubble message={baseMsg({ role: 'assistant' })} tickState="blue" />,
    )
    expect(container.querySelector('[aria-label="lida"]')).toBeNull()
    expect(container.querySelector('[aria-label="entregue"]')).toBeNull()
    expect(container.querySelector('[aria-label="enviando"]')).toBeNull()
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
```

- [ ] **Step 3: Run tests**

Run: `npm test -- MessageBubble.test`
Expected: all 6 tests pass.

If any fail, re-read Step 1 — the most common mistake is forgetting to fold `'idle'` into the blue branch.

- [ ] **Step 4: Commit**

```bash
git add src/app/chat/[slug]/components/MessageBubble.tsx src/app/chat/[slug]/components/__tests__/MessageBubble.test.tsx
git commit -m "feat(chat): add tick state icons to MessageBubble"
```

---

## Task 4: `ChatHeader` — `isTyping` prop

**Files:**
- Modify: `src/app/chat/[slug]/components/ChatHeader.tsx`

- [ ] **Step 1: Add `isTyping` prop and swap subtitle text**

Replace the entire file content:

```tsx
export function ChatHeader({
  storeName,
  logoUrl,
  isTyping = false,
}: {
  storeName: string
  logoUrl?: string | null
  isTyping?: boolean
}) {
  const initials = storeName
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <header className="flex items-center gap-3 bg-[#075E54] px-4 py-3 text-white shadow">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={storeName}
          className="h-10 w-10 rounded-full bg-white/20 object-cover"
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">
          {initials}
        </div>
      )}
      <div className="flex flex-col">
        <span className="text-base font-medium leading-tight">{storeName}</span>
        <span className="text-xs leading-tight text-white/80">
          {isTyping ? 'digitando...' : 'online'}
        </span>
      </div>
    </header>
  )
}
```

- [ ] **Step 2: Run the full test suite to make sure nothing else broke**

Run: `npm test`
Expected: all tests pass (no `ChatHeader` tests exist; this is just a regression check).

- [ ] **Step 3: Commit**

```bash
git add src/app/chat/[slug]/components/ChatHeader.tsx
git commit -m "feat(chat): toggle 'digitando...' subtitle in ChatHeader"
```

---

## Task 5: `MessageList` — `TypingBubble` and prop drilling

**Files:**
- Modify: `src/app/chat/[slug]/components/MessageList.tsx`

- [ ] **Step 1: Replace the file content with `Cycle`, `now`, `isTyping` props and `TypingBubble`**

Replace the entire file:

```tsx
import type { RefObject } from 'react'
import type { ChatMessage } from '../ChatClient'
import { MessageBubble } from './MessageBubble'
import { tickStateFor, type Cycle } from './cycle'

export function MessageList({
  messages,
  scrollAnchorRef,
  cycle,
  now,
  isTyping,
}: {
  messages: ChatMessage[]
  scrollAnchorRef: RefObject<HTMLDivElement | null>
  cycle: Cycle | null
  now: number
  isTyping: boolean
}) {
  return (
    <div
      className="flex-1 overflow-y-auto px-3 py-2"
      style={{
        backgroundImage: "url('/chat-bg-pattern.svg')",
        backgroundRepeat: 'repeat',
        backgroundSize: '280px 280px',
      }}
    >
      {messages.length === 0 && (
        <p className="mt-8 text-center text-sm text-gray-500">
          Comece a conversa enviando uma mensagem.
        </p>
      )}
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          tickState={tickStateFor(m.id, cycle, now)}
        />
      ))}
      {isTyping && <TypingBubble />}
      <div ref={scrollAnchorRef} />
    </div>
  )
}

function TypingBubble() {
  return (
    <div className="mb-0.5 flex justify-start" aria-label="digitando">
      <div className="rounded-lg bg-white px-3 py-2 shadow-sm">
        <span className="typing">
          <span />
          <span />
          <span />
        </span>
      </div>
    </div>
  )
}
```

(The `.typing` class is already defined in `src/app/globals.css:260-278` — no CSS changes needed.)

- [ ] **Step 2: Run the full test suite as a regression check**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/chat/[slug]/components/MessageList.tsx
git commit -m "feat(chat): thread tickState and render TypingBubble in MessageList"
```

---

## Task 6: `ChatInput` — Enter as newline + cycle callbacks

**Files:**
- Modify: `src/app/chat/[slug]/components/ChatInput.tsx`

- [ ] **Step 1: Replace the file content — remove `handleKey`, add cycle callbacks, drop `onKeyDown`**

Replace the entire file:

```tsx
'use client'

import { useState } from 'react'
import { sendMessage } from '@/actions/chat'
import type { ChatMessage } from '../ChatClient'

export function ChatInput({
  slug,
  sending,
  onSending,
  onError,
  onLocalAdd,
  onReplaceTemp,
  onCycleStart,
  onCycleRename,
  onCycleCancel,
}: {
  slug: string
  sending: boolean
  onSending: (s: boolean) => void
  onError: (e: string | null) => void
  onLocalAdd: (m: ChatMessage) => void
  onReplaceTemp: (tempId: string, realId: string) => void
  onCycleStart: (tempId: string, content: string) => void
  onCycleRename: (tempId: string, realId: string) => void
  onCycleCancel: (tempId: string) => void
}) {
  const [text, setText] = useState('')

  async function handleSend() {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    onSending(true)
    onError(null)

    const tempId = `temp-${Date.now()}`
    onLocalAdd({
      id: tempId,
      role: 'user',
      content: trimmed,
      message_type: 'text',
      media_url: null,
      created_at: new Date().toISOString(),
    })
    onCycleStart(tempId, trimmed)
    setText('')

    const result = await sendMessage({
      slug,
      text: trimmed,
      messageType: 'text',
    })

    if (!result.success) {
      onCycleCancel(tempId)
      onError(result.error ?? 'Erro ao enviar.')
    } else if (result.messageId) {
      onReplaceTemp(tempId, result.messageId)
      onCycleRename(tempId, result.messageId)
    }
    onSending(false)
  }

  const canSend = text.trim().length > 0 && !sending

  return (
    <footer
      className="flex items-end gap-2 bg-white px-3 py-2 shadow-inner"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)' }}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={1}
        placeholder="Mensagem"
        className="max-h-32 flex-1 resize-none rounded-2xl bg-gray-100 px-4 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#075E54]"
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={!canSend}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#075E54] text-white transition-colors hover:bg-[#054d44] disabled:opacity-50"
        aria-label="Enviar"
      >
        <PaperPlaneIcon />
      </button>
    </footer>
  )
}

function PaperPlaneIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  )
}
```

Key changes from the previous version: `handleKey` removed entirely; `onKeyDown` removed from the `<textarea>`; three new props added; `onCycleStart` is called right after `onLocalAdd`; `onCycleCancel` runs on failure; `onCycleRename` runs alongside `onReplaceTemp` on success.

- [ ] **Step 2: Run the full test suite as a regression check**

Run: `npm test`
Expected: all tests pass.

The project does not have a build-time TS check in CI — TS errors surface during `next dev` or `next build`. Skip explicit type-check here; Task 7 will catch any prop-mismatch failures because `ChatClient` is where the callbacks are wired.

- [ ] **Step 3: Commit**

```bash
git add src/app/chat/[slug]/components/ChatInput.tsx
git commit -m "feat(chat): Enter inserts newline, button-only send, wire cycle callbacks"
```

---

## Task 7: `ChatClient` — orchestrate cycle state, timer, realtime hold/release

**Files:**
- Modify: `src/app/chat/[slug]/ChatClient.tsx`

This is the largest task. Read the whole step 1 before making any edit; the file is rewritten in one pass.

- [ ] **Step 1: Replace the file content with the new orchestration**

Replace the entire file:

```tsx
'use client'

import { useReducer, useEffect, useRef, useState, useCallback } from 'react'
import { createClient as createBrowserSupabase } from '@/lib/supabase/client'
import { ChatHeader } from './components/ChatHeader'
import { MessageList } from './components/MessageList'
import { ChatInput } from './components/ChatInput'
import {
  cycleReducer,
  isTypingActive,
  type Cycle,
  type CycleAction,
} from './components/cycle'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'operator' | 'system'
  content: string
  message_type: 'text' | 'image' | 'audio'
  media_url: string | null
  created_at: string
}

interface State {
  messages: ChatMessage[]
  sending: boolean
  error: string | null
}

type Action =
  | { type: 'add'; message: ChatMessage }
  | { type: 'replaceTemp'; tempId: string; realId: string }
  | { type: 'sending'; sending: boolean }
  | { type: 'error'; error: string | null }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'add': {
      if (state.messages.some((m) => m.id === action.message.id)) return state
      if (action.message.role === 'user') {
        const dupTempIdx = state.messages.findIndex(
          (m) =>
            m.id.startsWith('temp-') &&
            m.role === 'user' &&
            m.message_type === action.message.message_type &&
            m.content === action.message.content,
        )
        if (dupTempIdx !== -1) {
          const next = state.messages.slice()
          next[dupTempIdx] = action.message
          return { ...state, messages: next }
        }
      }
      return { ...state, messages: [...state.messages, action.message] }
    }
    case 'replaceTemp':
      if (state.messages.some((m) => m.id === action.realId)) {
        return {
          ...state,
          messages: state.messages.filter((m) => m.id !== action.tempId),
        }
      }
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.id === action.tempId ? { ...m, id: action.realId } : m,
        ),
      }
    case 'sending':
      return { ...state, sending: action.sending }
    case 'error':
      return { ...state, error: action.error }
  }
}

export function ChatClient({
  slug,
  storeId,
  conversationId,
  storeName,
  storeLogoUrl,
  initialMessages,
}: {
  slug: string
  storeId: string
  conversationId: string
  storeName: string
  storeLogoUrl: string | null
  initialMessages: ChatMessage[]
}) {
  const [state, dispatch] = useReducer(reducer, {
    messages: initialMessages,
    sending: false,
    error: null,
  })

  const [cycle, setCycle] = useState<Cycle | null>(null)
  const cycleRef = useRef<Cycle | null>(null)
  cycleRef.current = cycle

  const [now, setNow] = useState<number>(() => Date.now())

  const pendingTempsRef = useRef<Array<{ tempId: string; content: string }>>([])

  const dispatchCycle = useCallback((action: CycleAction) => {
    const res = cycleReducer(cycleRef.current, action)
    cycleRef.current = res.cycle
    setCycle(res.cycle)
    if (res.releaseAI) {
      dispatch({ type: 'add', message: res.releaseAI })
    }
  }, [])

  useEffect(() => {
    if (cycle === null) return
    const id = setInterval(() => {
      const n = Date.now()
      setNow(n)
      dispatchCycle({ type: 'tickElapsed', now: n })
    }, 500)
    return () => clearInterval(id)
  }, [cycle, dispatchCycle])

  const visitorKeyRef = useRef(crypto.randomUUID())

  useEffect(() => {
    const supabase = createBrowserSupabase()
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          const row = payload.new as {
            id: string
            conversation_id: string
            role: ChatMessage['role']
            content: string
            message_type: ChatMessage['message_type']
            media_path: string | null
            created_at: string
          }

          let media_url: string | null = null
          if (row.media_path) {
            const res = await fetch('/api/chat/media-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: row.media_path }),
            })
            if (res.ok) {
              const j = await res.json()
              media_url = j.url ?? null
            }
          }

          const msg: ChatMessage = {
            id: row.id,
            role: row.role,
            content: row.content,
            message_type: row.message_type,
            media_url,
            created_at: row.created_at,
          }

          if (row.role === 'user') {
            const idx = pendingTempsRef.current.findIndex(
              (p) => p.content === row.content,
            )
            if (idx !== -1) {
              const { tempId } = pendingTempsRef.current[idx]
              pendingTempsRef.current.splice(idx, 1)
              dispatchCycle({
                type: 'renameInCycle',
                tempId,
                realId: row.id,
              })
            }
            dispatch({ type: 'add', message: msg })
            return
          }

          if (row.role === 'assistant' || row.role === 'operator') {
            dispatchCycle({
              type: 'holdOrRelease',
              msg,
              now: Date.now(),
            })
            return
          }

          dispatch({ type: 'add', message: msg })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId, dispatchCycle])

  useEffect(() => {
    const supabase = createBrowserSupabase()
    const channel = supabase.channel(`store:${storeId}:visitors`, {
      config: { presence: { key: visitorKeyRef.current } },
    })
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel.track({ online_at: new Date().toISOString() })
      }
    })
    return () => {
      supabase.removeChannel(channel)
    }
  }, [storeId])

  const isTyping = isTypingActive(cycle, now)

  const scrollAnchor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.messages.length, isTyping])

  const handleCycleStart = useCallback(
    (tempId: string, content: string) => {
      pendingTempsRef.current.push({ tempId, content })
      dispatchCycle({
        type: 'startOrExtend',
        userMsgId: tempId,
        now: Date.now(),
      })
    },
    [dispatchCycle],
  )

  const handleCycleRename = useCallback(
    (tempId: string, realId: string) => {
      pendingTempsRef.current = pendingTempsRef.current.filter(
        (p) => p.tempId !== tempId,
      )
      dispatchCycle({ type: 'renameInCycle', tempId, realId })
    },
    [dispatchCycle],
  )

  const handleCycleCancel = useCallback(
    (tempId: string) => {
      pendingTempsRef.current = pendingTempsRef.current.filter(
        (p) => p.tempId !== tempId,
      )
      dispatchCycle({ type: 'cancelFor', userMsgId: tempId })
    },
    [dispatchCycle],
  )

  return (
    <div className="flex h-dvh flex-col bg-[#ECE5DD]">
      <ChatHeader
        storeName={storeName}
        logoUrl={storeLogoUrl}
        isTyping={isTyping}
      />
      <MessageList
        messages={state.messages}
        scrollAnchorRef={scrollAnchor}
        cycle={cycle}
        now={now}
        isTyping={isTyping}
      />
      <ChatInput
        slug={slug}
        sending={state.sending}
        onSending={(sending) => dispatch({ type: 'sending', sending })}
        onError={(error) => dispatch({ type: 'error', error })}
        onLocalAdd={(message) => dispatch({ type: 'add', message })}
        onReplaceTemp={(tempId, realId) =>
          dispatch({ type: 'replaceTemp', tempId, realId })
        }
        onCycleStart={handleCycleStart}
        onCycleRename={handleCycleRename}
        onCycleCancel={handleCycleCancel}
      />
      {state.error && (
        <div className="bg-red-50 px-4 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
    </div>
  )
}
```

Things to confirm by visual scan:

- `cycleRef` mirrors `cycle` so callbacks (passed to `setInterval` / realtime handler / `ChatInput`) always operate on the latest cycle without re-subscribing.
- The interval effect re-creates each time `cycle` reference changes. The reducer bails out (returns the same reference) for no-op `tickElapsed` calls, so in steady state the timer is not torn down. When the cycle is mutated (new user msg, AI release, cancel), recreating the interval is acceptable — it just resets the 500ms cadence.
- The realtime handler dispatches `renameInCycle` before `dispatch({ type: 'add', ... })` for `role === 'user'` so the cycle's `userMsgIds` already has `realId` by the time the next render reads it.
- `setCycle` triggers a render that flows `now` and `cycle` through to children; `now` is also bumped explicitly by the timer to drive sub-state transitions inside the cycle (clock → gray → blue).

- [ ] **Step 2: Run the full test suite as a regression check**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 3: Start the dev server**

Run: `npm run dev`
Expected: server boots on `http://localhost:3000` (or another port if occupied). No TypeScript errors in the console.

If TS errors appear, the most likely culprits are:
- Mismatched callback signatures between `ChatClient` and `ChatInput` — re-check Task 6 + the props passed in Step 1.
- Missing import of `useCallback` or `useState` — re-check the top of the file.

- [ ] **Step 4: Commit**

```bash
git add src/app/chat/[slug]/ChatClient.tsx
git commit -m "feat(chat): orchestrate tick cycle, hold-or-release AI, typing indicator"
```

---

## Task 8: Manual smoke test in dev server

**Files:** none (verification only)

- [ ] **Step 1: Make sure dev server is running**

Run: `npm run dev`

- [ ] **Step 2: Open the lead chat for any test store**

The slug is whatever is configured locally. Visit `http://localhost:3000/chat/<slug>` in a browser. Wait for the WhatsApp-style background to load.

- [ ] **Step 3: Verify Enter behavior**

Type a multi-line message, pressing Enter at the end of each line. Confirm:
- Enter inserts a newline; the message is not sent.
- Clicking the airplane button sends the message.

- [ ] **Step 4: Verify tick lifecycle**

Send a short message. Watch the bottom-right of the bubble. Confirm the sequence:
- 0–3s: clock icon.
- 3–13s: gray double-check.
- 13s+: blue double-check.

- [ ] **Step 5: Verify "digitando" appears at 16s**

After the bubble shows the blue check, wait ~3 more seconds. Confirm:
- The header subtitle changes from `online` to `digitando...`.
- A white bubble with 3 bouncing gray dots appears on the left side of the message list.

- [ ] **Step 6: Verify fast AI reply (the n8n workflow may answer in <16s)**

Send a message that the AI is likely to answer quickly (a simple greeting). Confirm:
- The full 16s cycle still runs.
- The AI message is rendered at ~16s, NOT immediately when the realtime INSERT arrives.
- The "digitando" indicator briefly flashes at 16s before the AI bubble appears.

- [ ] **Step 7: Verify slow AI reply (or simulate by sending a query that takes long)**

If hard to provoke naturally, send several messages with a 1-second wait between each. Confirm:
- The cycle resets each time a new message is sent.
- All user messages in the burst share the same tick state at any given moment.
- Only one `digitando` balloon is visible at a time.

- [ ] **Step 8: Verify page reload**

Refresh the browser. Confirm:
- All previous lead messages render with the blue double-check (idle = blue).
- No clock, no gray transition, no `digitando` triggers — they're at the final state.

- [ ] **Step 9: Note any visual regressions**

If something doesn't match the spec (e.g., layout shift in the header when subtitle changes, scroll not following the typing bubble, tick icon misaligned with the timestamp), note it as a follow-up. The plan does not include style fixes — they're cheap to address in a follow-up commit.

- [ ] **Step 10: Commit (only if Step 9 surfaced fixes)**

```bash
git add <files>
git commit -m "fix(chat): <specific fix>"
```

If no fixes needed, skip this step.

---

## Self-review checklist (already run before handing off)

- Spec coverage: ✓ all 7 decisions traced to tasks (Enter→Task 6, ticks→Tasks 1–3,5,7, typing balloon→Tasks 5+7, typing header→Tasks 4+7, hold AI→Tasks 2+7, reload=idle→Task 3, burst share→Tasks 2+7).
- Placeholder scan: no TBDs, no "implement later".
- Type consistency: `Cycle`, `CycleAction`, `CycleResult`, `TickState`, `tickStateFor`, `cycleReducer`, `isTypingActive` — same names used everywhere.
- Edge cases from spec: failure → `onCycleCancel` (Task 6+7); rename race → `pendingTempsRef` (Task 7); idle=blue (Task 3); operator routed like assistant (Task 7); system passes through (Task 7).
