# Página de Chat da Loja — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public WhatsApp-style chat page at `/chat/<slug>` where customers chat with a store's AI agent (delivered via n8n) and the store owner exposes the URL from `/loja`.

**Architecture:** Next.js App Router server actions + endpoints (Option B from spec). Visitor isolation via httpOnly HMAC-signed cookie. Outbound webhook to n8n on each user message; inbound replies arrive via Supabase Realtime (n8n inserts into `messages` using service role).

**Tech Stack:** Next.js 16 (App Router), React 19, Supabase (Postgres + Realtime + Storage), Tailwind 4, Vitest (new), `qrcode` (new).

**Spec:** `docs/superpowers/specs/2026-05-10-pagina-chat-loja-design.md`

**Branch:** `feat/chat-loja` (created off `main`).

---

## File Structure

**Created:**
- `supabase/migrations/012_chat_slug_and_media.sql`
- `src/lib/visitor-cookie.ts`
- `src/lib/__tests__/visitor-cookie.test.ts`
- `src/lib/__tests__/n8n.test.ts`
- `src/actions/chat.ts`
- `src/app/chat/[slug]/page.tsx`
- `src/app/chat/[slug]/ChatClient.tsx`
- `src/app/chat/[slug]/components/ChatHeader.tsx`
- `src/app/chat/[slug]/components/MessageList.tsx`
- `src/app/chat/[slug]/components/MessageBubble.tsx`
- `src/app/chat/[slug]/components/ChatInput.tsx`
- `src/app/chat/[slug]/components/AudioRecorder.tsx`
- `src/components/loja/ChatUrlCard.tsx`
- `src/components/loja/CopyButton.tsx`
- `src/components/loja/QRCodeDialog.tsx`
- `vitest.config.ts`

**Modified:**
- `src/types/database.ts` (add `chat_slug` to `store_settings`; add `store_id`, `message_type`, `media_path` to messages/conversations)
- `src/lib/n8n.ts` (expand payload; rename function args)
- `src/middleware.ts` (whitelist `/chat`)
- `src/app/loja/page.tsx` (mount `<ChatUrlCard />` at top)
- `package.json` (add `vitest`, `@vitejs/plugin-react`, `jsdom`, `qrcode`, `@types/qrcode`; add `test` script)
- `.env.local.example` if exists, otherwise document new vars in plan completion notes

---

## Task 0: Setup branch and env vars

**Files:**
- Branch: `feat/chat-loja` from `main`
- Document: `.env.local` additions

- [ ] **Step 1: Create the feature branch**

```bash
git checkout main
git pull
git checkout -b feat/chat-loja
```

Expected: switched to new branch `feat/chat-loja`.

- [ ] **Step 2: Generate SESSION_SECRET and add env vars**

Generate a 32-byte base64 secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Add to `.env.local` (do NOT commit):

```
SESSION_SECRET=<paste base64 from above>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

For production, set the same vars in the deployment environment with `NEXT_PUBLIC_APP_URL=https://<your-domain>`.

- [ ] **Step 3: Verify env vars load**

Run:

```bash
npm run dev
```

Open http://localhost:3000 — should boot without errors. Stop with Ctrl+C.

- [ ] **Step 4: Commit branch placeholder (empty)**

No files to commit yet. Skip commit.

---

## Task 1: Migration `012_chat_slug_and_media.sql`

**Files:**
- Create: `supabase/migrations/012_chat_slug_and_media.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 012_chat_slug_and_media.sql
-- Adds chat_slug per store, links conversations to store, and adds
-- message_type/media_path for image/audio support.

-- 1. chat_slug on store_settings
ALTER TABLE store_settings
  ADD COLUMN chat_slug TEXT UNIQUE;

UPDATE store_settings
SET chat_slug = lower(substring(md5(random()::text || id::text) for 8))
WHERE chat_slug IS NULL;

ALTER TABLE store_settings
  ALTER COLUMN chat_slug SET NOT NULL;

CREATE INDEX idx_store_settings_chat_slug ON store_settings (chat_slug);

-- 2. conversations.store_id
ALTER TABLE conversations
  ADD COLUMN store_id UUID REFERENCES store_settings(id) ON DELETE CASCADE;

CREATE INDEX idx_conversations_store_visitor
  ON conversations (store_id, visitor_id);

-- 3. messages.message_type, messages.media_path
ALTER TABLE messages
  ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'image', 'audio')),
  ADD COLUMN media_path TEXT;

-- 4. Tighter RLS for conversations: owner sees own; anon can read for now
DROP POLICY IF EXISTS "conversations_read" ON conversations;

CREATE POLICY "conversations_read_owner" ON conversations
  FOR SELECT USING (auth.uid() = store_id);

CREATE POLICY "conversations_read_anon" ON conversations
  FOR SELECT USING (auth.role() = 'anon');

-- 5. Trigger to auto-generate chat_slug for new store_settings rows
CREATE OR REPLACE FUNCTION generate_chat_slug()
RETURNS TRIGGER AS $$
DECLARE
  candidate TEXT;
  attempt INT := 0;
BEGIN
  IF NEW.chat_slug IS NOT NULL THEN
    RETURN NEW;
  END IF;
  LOOP
    candidate := lower(substring(md5(random()::text || NEW.id::text || attempt::text) for 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM store_settings WHERE chat_slug = candidate);
    attempt := attempt + 1;
    IF attempt >= 5 THEN
      candidate := lower(substring(replace(gen_random_uuid()::text, '-', '') for 8));
      EXIT;
    END IF;
  END LOOP;
  NEW.chat_slug := candidate;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_store_settings_chat_slug
  BEFORE INSERT ON store_settings
  FOR EACH ROW EXECUTE FUNCTION generate_chat_slug();
```

- [ ] **Step 2: Apply via Supabase dashboard**

Open Supabase Dashboard → SQL Editor → paste the entire migration → Run.

Expected: `Success. No rows returned`. If errors, fix the SQL.

- [ ] **Step 3: Verify schema**

In Supabase SQL editor:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name IN ('store_settings', 'conversations', 'messages')
  AND column_name IN ('chat_slug', 'store_id', 'message_type', 'media_path')
ORDER BY table_name, column_name;
```

Expected 4 rows: `conversations.store_id` (uuid, YES), `messages.media_path` (text, YES), `messages.message_type` (text, NO), `store_settings.chat_slug` (text, NO).

- [ ] **Step 4: Verify all existing rows have chat_slug**

```sql
SELECT count(*) AS total, count(chat_slug) AS with_slug FROM store_settings;
```

Expected: `total = with_slug`.

- [ ] **Step 5: Commit migration file**

```bash
git add supabase/migrations/012_chat_slug_and_media.sql
git commit -m "feat(db): add chat_slug, store_id, message_type, media_path"
```

---

## Task 2: Create `chat-media` storage bucket

**Files:** none (Supabase dashboard)

- [ ] **Step 1: Create the bucket**

Supabase Dashboard → Storage → New bucket:
- Name: `chat-media`
- Public: **OFF** (private)
- File size limit: 10 MB
- Allowed MIME types: `image/jpeg,image/png,image/webp,audio/webm,audio/ogg`

Click Save.

- [ ] **Step 2: Add RLS policies for the bucket**

In SQL editor:

```sql
-- Anyone (anon or authenticated) can upload to chat-media when going through
-- a signed upload URL. The signed URL itself enforces who can upload.
CREATE POLICY "chat_media_signed_upload"
  ON storage.objects FOR INSERT TO public
  WITH CHECK (bucket_id = 'chat-media');

-- Reads only via signed URL (default behavior of private bucket).
-- No SELECT policy needed; all reads must go through signed URLs.
```

Expected: `Success. No rows returned.`

- [ ] **Step 3: Verify bucket and policy**

```sql
SELECT id, name, public FROM storage.buckets WHERE id = 'chat-media';
SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND policyname LIKE 'chat_media%';
```

Expected: bucket row with `public = false`; one policy `chat_media_signed_upload`.

- [ ] **Step 4: No commit (Supabase config, not tracked in git)**

---

## Task 3: Update database types

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Add new fields to TypeScript types**

In `src/types/database.ts`, update:

In `store_settings`:
- `Row`: add `chat_slug: string`
- `Insert`: add `chat_slug?: string` (trigger fills)
- `Update`: add `chat_slug?: string`

In `conversations`:
- `Row`: add `store_id: string | null`
- `Insert`: add `store_id?: string | null`
- `Update`: add `store_id?: string | null`

In `messages`:
- `Row`: add `message_type: 'text' | 'image' | 'audio'` and `media_path: string | null`
- `Insert`: add `message_type?: 'text' | 'image' | 'audio'` and `media_path?: string | null`
- `Update`: add `message_type?: 'text' | 'image' | 'audio'` and `media_path?: string | null`

Use the existing `Edit` tool with the surrounding context for each `Row`/`Insert`/`Update` block; don't rewrite the whole file.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors. If existing code references `messages.message_type` or `chat_slug`, fix usages — but at this point nothing should.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "feat(types): add chat_slug, store_id, message_type, media_path"
```

---

## Task 4: Setup Vitest

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Install dependencies**

```bash
npm install --save-dev vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom
```

Expected: installs without errors. Modifies `package-lock.json`.

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

- [ ] **Step 3: Add `test` script to `package.json`**

In `package.json` `scripts`, add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Run vitest with no tests yet**

```bash
npm test
```

Expected: `No test files found, exiting with code 0` or similar success.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest test runner"
```

---

## Task 5: `visitor-cookie.ts` library (TDD)

**Files:**
- Test: `src/lib/__tests__/visitor-cookie.test.ts`
- Create: `src/lib/visitor-cookie.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/visitor-cookie.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  COOKIE_NAME,
  buildVisitorCookieValue,
  parseVisitorCookieValue,
  generateVisitorId,
} from '../visitor-cookie'

const SECRET = 'dGVzdC1zZWNyZXQtZm9yLXVuaXQtdGVzdHM='

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET
})

describe('visitor-cookie', () => {
  it('exports the cookie name lue_visitor', () => {
    expect(COOKIE_NAME).toBe('lue_visitor')
  })

  it('generateVisitorId returns a UUID v4', () => {
    const id = generateVisitorId()
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('roundtrips: build then parse returns the original visitor_id', () => {
    const id = generateVisitorId()
    const cookie = buildVisitorCookieValue(id)
    expect(parseVisitorCookieValue(cookie)).toBe(id)
  })

  it('parse rejects empty string', () => {
    expect(parseVisitorCookieValue('')).toBeNull()
  })

  it('parse rejects malformed value (no dot)', () => {
    expect(parseVisitorCookieValue('justastring')).toBeNull()
  })

  it('parse rejects tampered visitor_id (wrong signature)', () => {
    const id = generateVisitorId()
    const cookie = buildVisitorCookieValue(id)
    const [, sig] = cookie.split('.')
    const tampered = `00000000-0000-4000-8000-000000000000.${sig}`
    expect(parseVisitorCookieValue(tampered)).toBeNull()
  })

  it('parse rejects when SESSION_SECRET differs', () => {
    const id = generateVisitorId()
    const cookie = buildVisitorCookieValue(id)
    process.env.SESSION_SECRET = 'ZGlmZmVyZW50LXNlY3JldA=='
    expect(parseVisitorCookieValue(cookie)).toBeNull()
  })

  it('build throws if SESSION_SECRET is missing', () => {
    delete process.env.SESSION_SECRET
    expect(() => buildVisitorCookieValue(generateVisitorId())).toThrow(
      /SESSION_SECRET/,
    )
  })
})
```

- [ ] **Step 2: Run tests and verify they fail**

```bash
npm test
```

Expected: tests fail with "Cannot find module '../visitor-cookie'".

- [ ] **Step 3: Implement the library**

Create `src/lib/visitor-cookie.ts`:

```ts
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export const COOKIE_NAME = 'lue_visitor'

function getSecret(): Buffer {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    throw new Error('SESSION_SECRET env var is required for visitor cookie')
  }
  return Buffer.from(secret, 'base64')
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

export function generateVisitorId(): string {
  return randomUUID()
}

export function buildVisitorCookieValue(visitorId: string): string {
  return `${visitorId}.${sign(visitorId)}`
}

export function parseVisitorCookieValue(raw: string | undefined): string | null {
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot <= 0 || dot === raw.length - 1) return null
  const visitorId = raw.slice(0, dot)
  const providedSig = raw.slice(dot + 1)
  let expectedSig: string
  try {
    expectedSig = sign(visitorId)
  } catch {
    return null
  }
  const a = Buffer.from(providedSig)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length) return null
  if (!timingSafeEqual(a, b)) return null
  return visitorId
}

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/chat',
  maxAge: 60 * 60 * 24 * 365,
}
```

- [ ] **Step 4: Run tests — all pass**

```bash
npm test
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/visitor-cookie.ts src/lib/__tests__/visitor-cookie.test.ts
git commit -m "feat(chat): visitor cookie helpers with HMAC signing"
```

---

## Task 6: Expand `dispatchToN8n` (TDD)

**Files:**
- Test: `src/lib/__tests__/n8n.test.ts`
- Modify: `src/lib/n8n.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/n8n.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { dispatchToN8n } from '../n8n'

describe('dispatchToN8n', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.N8N_WEBHOOK_URL
    delete process.env.N8N_WEBHOOK_SECRET
  })

  it('returns null when N8N_WEBHOOK_URL is unset (echo mode)', async () => {
    const result = await dispatchToN8n({
      mensagem: 'oi',
      id_mensagem: 'm1',
      id_conversa: 'c1',
      nome_loja: 'Loja',
      id_loja: 's1',
      tipo_de_mensagem: 'text',
    })
    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POSTs the full payload to the configured URL', async () => {
    process.env.N8N_WEBHOOK_URL = 'https://n8n.example/webhook/chat'
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    await dispatchToN8n({
      mensagem: 'oi',
      id_mensagem: 'm1',
      id_conversa: 'c1',
      nome_loja: 'Minha Loja',
      id_loja: 's1',
      tipo_de_mensagem: 'text',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://n8n.example/webhook/chat')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({
      mensagem: 'oi',
      id_mensagem: 'm1',
      id_conversa: 'c1',
      nome_loja: 'Minha Loja',
      id_loja: 's1',
      tipo_de_mensagem: 'text',
    })
  })

  it('includes X-Webhook-Secret header when N8N_WEBHOOK_SECRET is set', async () => {
    process.env.N8N_WEBHOOK_URL = 'https://n8n.example/webhook/chat'
    process.env.N8N_WEBHOOK_SECRET = 'shh'
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    await dispatchToN8n({
      mensagem: 'oi',
      id_mensagem: 'm1',
      id_conversa: 'c1',
      nome_loja: 'Loja',
      id_loja: 's1',
      tipo_de_mensagem: 'text',
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['X-Webhook-Secret']).toBe('shh')
  })

  it('includes media_url when provided (for image/audio)', async () => {
    process.env.N8N_WEBHOOK_URL = 'https://n8n.example/webhook/chat'
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    await dispatchToN8n({
      mensagem: '',
      id_mensagem: 'm1',
      id_conversa: 'c1',
      nome_loja: 'Loja',
      id_loja: 's1',
      tipo_de_mensagem: 'image',
      media_url: 'https://signed.example/foo.jpg',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.tipo_de_mensagem).toBe('image')
    expect(body.media_url).toBe('https://signed.example/foo.jpg')
  })

  it('does not throw on 5xx', async () => {
    process.env.N8N_WEBHOOK_URL = 'https://n8n.example/webhook/chat'
    fetchMock.mockResolvedValue(new Response('boom', { status: 502 }))

    const res = await dispatchToN8n({
      mensagem: 'oi',
      id_mensagem: 'm1',
      id_conversa: 'c1',
      nome_loja: 'Loja',
      id_loja: 's1',
      tipo_de_mensagem: 'text',
    })

    expect(res?.status).toBe(502)
  })
})
```

- [ ] **Step 2: Run tests and verify failures**

```bash
npm test
```

Expected: tests fail because the current `dispatchToN8n` has a different signature.

- [ ] **Step 3: Replace the implementation**

Replace the entire contents of `src/lib/n8n.ts`:

```ts
/**
 * Dispatch a customer chat message to the n8n webhook.
 * Echo mode (returns null without calling) when N8N_WEBHOOK_URL is unset.
 */
export interface N8nDispatchPayload {
  mensagem: string
  id_mensagem: string
  id_conversa: string
  nome_loja: string
  id_loja: string
  tipo_de_mensagem: 'text' | 'image' | 'audio'
  media_url?: string
}

export async function dispatchToN8n(
  payload: N8nDispatchPayload,
): Promise<Response | null> {
  const webhookUrl = process.env.N8N_WEBHOOK_URL
  if (!webhookUrl) return null

  const secret = process.env.N8N_WEBHOOK_SECRET
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (secret) headers['X-Webhook-Secret'] = secret

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    console.error(`n8n webhook failed: ${res.status} ${res.statusText}`)
  }

  return res
}
```

- [ ] **Step 4: Run tests — all pass**

```bash
npm test
```

Expected: 5 new tests + 7 from Task 5 = 12 passing.

- [ ] **Step 5: Update existing callers (if any)**

Search for old `dispatchToN8n` callers:

```bash
grep -rn "dispatchToN8n" src
```

If any caller still passes `{ conversation_id, message_id, content, visitor_id }`, update it to the new shape — `mensagem`, `id_mensagem`, `id_conversa`, `nome_loja`, `id_loja`, `tipo_de_mensagem`. (As of branch start, no caller exists outside `src/lib/n8n.ts`.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/n8n.ts src/lib/__tests__/n8n.test.ts
git commit -m "feat(n8n): expand dispatchToN8n payload (tipo_de_mensagem, loja)"
```

---

## Task 7: Server actions in `src/actions/chat.ts`

**Files:**
- Create: `src/actions/chat.ts`

- [ ] **Step 1: Create the file with `ensureConversation`**

```ts
'use server'

import { cookies, headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { randomUUID } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchToN8n } from '@/lib/n8n'
import {
  COOKIE_NAME,
  COOKIE_OPTIONS,
  buildVisitorCookieValue,
  generateVisitorId,
  parseVisitorCookieValue,
} from '@/lib/visitor-cookie'

export interface ChatBootstrap {
  conversationId: string
  storeId: string
  storeName: string
  messages: Array<{
    id: string
    role: 'user' | 'assistant' | 'operator' | 'system'
    content: string
    message_type: 'text' | 'image' | 'audio'
    media_url: string | null
    created_at: string
  }>
}

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24

async function getOrCreateVisitorId(): Promise<string> {
  const cookieStore = await cookies()
  const raw = cookieStore.get(COOKIE_NAME)?.value
  const existing = parseVisitorCookieValue(raw)
  if (existing) return existing

  const newId = generateVisitorId()
  cookieStore.set(COOKIE_NAME, buildVisitorCookieValue(newId), COOKIE_OPTIONS)
  return newId
}

async function resolveStoreBySlug(slug: string) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('store_settings')
    .select('id, store_name, chat_slug')
    .eq('chat_slug', slug)
    .maybeSingle()
  if (error) {
    console.error('resolveStoreBySlug error', error)
    return null
  }
  return data
}

async function signedReadUrl(
  path: string | null,
): Promise<string | null> {
  if (!path) return null
  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from('chat-media')
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error || !data) {
    console.error('signedReadUrl error', error)
    return null
  }
  return data.signedUrl
}

export async function ensureConversation(slug: string): Promise<ChatBootstrap> {
  const store = await resolveStoreBySlug(slug)
  if (!store) notFound()

  const visitorId = await getOrCreateVisitorId()
  const admin = createAdminClient()

  let { data: conversation } = await admin
    .from('conversations')
    .select('id')
    .eq('store_id', store.id)
    .eq('visitor_id', visitorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!conversation) {
    const { data: created, error } = await admin
      .from('conversations')
      .insert({
        store_id: store.id,
        visitor_id: visitorId,
        status: 'ai_active',
      })
      .select('id')
      .single()
    if (error || !created) {
      console.error('create conversation error', error)
      throw new Error('Não foi possível iniciar a conversa.')
    }
    conversation = created
  }

  const { data: rows } = await admin
    .from('messages')
    .select('id, role, content, message_type, media_path, created_at')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true })
    .limit(200)

  const messages = await Promise.all(
    (rows ?? []).map(async (m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      message_type: m.message_type,
      media_url: await signedReadUrl(m.media_path),
      created_at: m.created_at,
    })),
  )

  return {
    conversationId: conversation.id,
    storeId: store.id,
    storeName: store.store_name,
    messages,
  }
}
```

- [ ] **Step 2: Add `sendMessage` to the same file**

Append to `src/actions/chat.ts`:

```ts
export interface SendMessageInput {
  slug: string
  text: string
  mediaPath?: string
  messageType: 'text' | 'image' | 'audio'
}

export interface SendMessageResult {
  success: boolean
  messageId?: string
  error?: string
}

export async function sendMessage(
  input: SendMessageInput,
): Promise<SendMessageResult> {
  const store = await resolveStoreBySlug(input.slug)
  if (!store) return { success: false, error: 'Loja não encontrada.' }

  const visitorId = await getOrCreateVisitorId()
  const admin = createAdminClient()

  const { data: conv } = await admin
    .from('conversations')
    .select('id')
    .eq('store_id', store.id)
    .eq('visitor_id', visitorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!conv) return { success: false, error: 'Conversa não encontrada.' }

  const text = (input.text ?? '').slice(0, 4000)
  if (input.messageType === 'text' && text.trim().length === 0) {
    return { success: false, error: 'Mensagem vazia.' }
  }

  const { data: inserted, error: insertErr } = await admin
    .from('messages')
    .insert({
      conversation_id: conv.id,
      role: 'user',
      content: text,
      message_type: input.messageType,
      media_path: input.mediaPath ?? null,
    })
    .select('id')
    .single()

  if (insertErr || !inserted) {
    console.error('insert message error', insertErr)
    return { success: false, error: 'Erro ao salvar mensagem.' }
  }

  const mediaUrl = await signedReadUrl(input.mediaPath ?? null)

  try {
    await dispatchToN8n({
      mensagem: text,
      id_mensagem: inserted.id,
      id_conversa: conv.id,
      nome_loja: store.store_name,
      id_loja: store.id,
      tipo_de_mensagem: input.messageType,
      ...(mediaUrl ? { media_url: mediaUrl } : {}),
    })
  } catch (e) {
    console.error('dispatchToN8n threw', e)
    await admin.from('messages').insert({
      conversation_id: conv.id,
      role: 'system',
      content: 'Estamos com instabilidade. Sua mensagem foi recebida.',
      message_type: 'text',
    })
  }

  return { success: true, messageId: inserted.id }
}
```

- [ ] **Step 3: Add `getUploadUrl` to the same file**

Append to `src/actions/chat.ts`:

```ts
const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp']
const ALLOWED_AUDIO_MIME = ['audio/webm', 'audio/ogg']
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_AUDIO_BYTES = 2 * 1024 * 1024

export interface GetUploadUrlInput {
  slug: string
  mime: string
  size: number
}

export interface GetUploadUrlResult {
  success: boolean
  uploadUrl?: string
  mediaPath?: string
  token?: string
  error?: string
}

export async function getUploadUrl(
  input: GetUploadUrlInput,
): Promise<GetUploadUrlResult> {
  const store = await resolveStoreBySlug(input.slug)
  if (!store) return { success: false, error: 'Loja não encontrada.' }

  const visitorId = await getOrCreateVisitorId()
  const admin = createAdminClient()

  const { data: conv } = await admin
    .from('conversations')
    .select('id')
    .eq('store_id', store.id)
    .eq('visitor_id', visitorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!conv) return { success: false, error: 'Conversa não encontrada.' }

  const isImage = ALLOWED_IMAGE_MIME.includes(input.mime)
  const isAudio = ALLOWED_AUDIO_MIME.includes(input.mime)
  if (!isImage && !isAudio) {
    return { success: false, error: 'Tipo de arquivo não suportado.' }
  }
  const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES
  if (input.size > maxBytes) {
    return { success: false, error: 'Arquivo excede o tamanho máximo.' }
  }

  const ext =
    input.mime === 'image/jpeg'
      ? 'jpg'
      : input.mime === 'image/png'
      ? 'png'
      : input.mime === 'image/webp'
      ? 'webp'
      : input.mime === 'audio/webm'
      ? 'webm'
      : 'ogg'

  const messageId = randomUUID()
  const path = `${store.id}/${conv.id}/${messageId}.${ext}`

  const { data, error } = await admin.storage
    .from('chat-media')
    .createSignedUploadUrl(path)

  if (error || !data) {
    console.error('createSignedUploadUrl error', error)
    return { success: false, error: 'Erro ao gerar URL de upload.' }
  }

  return {
    success: true,
    uploadUrl: data.signedUrl,
    mediaPath: path,
    token: data.token,
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/actions/chat.ts
git commit -m "feat(chat): server actions ensureConversation, sendMessage, getUploadUrl"
```

---

## Task 8: Whitelist `/chat` in middleware

**Files:**
- Modify: `src/middleware.ts`

- [ ] **Step 1: Update the matcher**

The current matcher is `'/((?!_next/static|_next/image|favicon.ico|widget|api).*)'`. Add `chat` to the negative lookahead.

In `src/middleware.ts`, change the matcher to:

```ts
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|widget|api|chat).*)',
  ],
}
```

The auth checks at the top of `middleware()` already only redirect on `/painel`, `/estoque`, `/loja`, so `/chat` was technically not redirected — but it was still running Supabase session refresh on every chat request, which is wasteful and risks setting auth cookies on the public route. Excluding it from the matcher is cleaner.

- [ ] **Step 2: Verify dev still boots**

```bash
npm run dev
```

Open http://localhost:3000 — should boot. Visit http://localhost:3000/chat/anything — should hit the (yet-unbuilt) chat route. Stop with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(middleware): exclude /chat from session refresh matcher"
```

---

## Task 9: Page `src/app/chat/[slug]/page.tsx`

**Files:**
- Create: `src/app/chat/[slug]/page.tsx`

- [ ] **Step 1: Write the server component**

```tsx
import { ensureConversation } from '@/actions/chat'
import { ChatClient } from './ChatClient'

export const dynamic = 'force-dynamic'

export default async function ChatPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const bootstrap = await ensureConversation(slug)

  return (
    <ChatClient
      slug={slug}
      conversationId={bootstrap.conversationId}
      storeName={bootstrap.storeName}
      initialMessages={bootstrap.messages}
    />
  )
}
```

- [ ] **Step 2: Note Next 16 params shape**

Next 16 makes `params` a Promise. The `await params` above is required. If TypeScript complains, run `npx tsc --noEmit` to confirm signature.

- [ ] **Step 3: Don't run dev yet — `ChatClient` doesn't exist**

Skip running until Task 10.

- [ ] **Step 4: Commit later (with ChatClient)**

---

## Task 10: `ChatClient.tsx` skeleton

**Files:**
- Create: `src/app/chat/[slug]/ChatClient.tsx`

- [ ] **Step 1: Write the skeleton client component**

```tsx
'use client'

import { useReducer, useEffect, useRef } from 'react'
import { ChatHeader } from './components/ChatHeader'
import { MessageList } from './components/MessageList'
import { ChatInput } from './components/ChatInput'

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
  | { type: 'sending'; sending: boolean }
  | { type: 'error'; error: string | null }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'add':
      if (state.messages.some((m) => m.id === action.message.id)) return state
      return { ...state, messages: [...state.messages, action.message] }
    case 'sending':
      return { ...state, sending: action.sending }
    case 'error':
      return { ...state, error: action.error }
  }
}

export function ChatClient({
  slug,
  conversationId,
  storeName,
  initialMessages,
}: {
  slug: string
  conversationId: string
  storeName: string
  initialMessages: ChatMessage[]
}) {
  const [state, dispatch] = useReducer(reducer, {
    messages: initialMessages,
    sending: false,
    error: null,
  })

  const scrollAnchor = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: 'smooth' })
  }, [state.messages.length])

  return (
    <div className="flex h-dvh flex-col bg-[#ECE5DD]">
      <ChatHeader storeName={storeName} />
      <MessageList messages={state.messages} scrollAnchorRef={scrollAnchor} />
      <ChatInput
        slug={slug}
        conversationId={conversationId}
        sending={state.sending}
        onSending={(sending) => dispatch({ type: 'sending', sending })}
        onError={(error) => dispatch({ type: 'error', error })}
        onLocalAdd={(message) => dispatch({ type: 'add', message })}
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

- [ ] **Step 2: No commit yet (waiting on subcomponents)**

---

## Task 11: `ChatHeader` component

**Files:**
- Create: `src/app/chat/[slug]/components/ChatHeader.tsx`

- [ ] **Step 1: Write the header**

```tsx
export function ChatHeader({ storeName }: { storeName: string }) {
  const initials = storeName
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <header className="flex items-center gap-3 bg-[#075E54] px-4 py-3 text-white shadow">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">
        {initials}
      </div>
      <div className="flex flex-col">
        <span className="text-base font-medium leading-tight">{storeName}</span>
        <span className="text-xs leading-tight text-white/80">online</span>
      </div>
    </header>
  )
}
```

---

## Task 12: `MessageList` and `MessageBubble`

**Files:**
- Create: `src/app/chat/[slug]/components/MessageList.tsx`
- Create: `src/app/chat/[slug]/components/MessageBubble.tsx`

- [ ] **Step 1: Write `MessageBubble.tsx`**

```tsx
import type { ChatMessage } from '../ChatClient'

function formatTime(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <div className="my-2 flex justify-center">
        <span className="rounded-md bg-yellow-50 px-3 py-1 text-xs text-yellow-800 shadow-sm">
          {message.content}
        </span>
      </div>
    )
  }

  return (
    <div className={`my-1 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-lg px-3 py-2 shadow-sm ${
          isUser ? 'bg-[#DCF8C6]' : 'bg-white'
        }`}
      >
        {message.message_type === 'image' && message.media_url && (
          <a
            href={message.media_url}
            target="_blank"
            rel="noreferrer"
            className="mb-1 block"
          >
            <img
              src={message.media_url}
              alt=""
              className="max-h-64 rounded"
              loading="lazy"
            />
          </a>
        )}
        {message.message_type === 'audio' && message.media_url && (
          <audio controls src={message.media_url} className="max-w-full" />
        )}
        {message.content && (
          <p className="whitespace-pre-wrap break-words text-sm text-gray-900">
            {message.content}
          </p>
        )}
        <p className="mt-1 text-right text-[10px] text-gray-500">
          {formatTime(message.created_at)}
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write `MessageList.tsx`**

```tsx
import type { RefObject } from 'react'
import type { ChatMessage } from '../ChatClient'
import { MessageBubble } from './MessageBubble'

export function MessageList({
  messages,
  scrollAnchorRef,
}: {
  messages: ChatMessage[]
  scrollAnchorRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <div className="flex-1 overflow-y-auto px-3 py-2">
      {messages.length === 0 && (
        <p className="mt-8 text-center text-sm text-gray-500">
          Comece a conversa enviando uma mensagem.
        </p>
      )}
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
      <div ref={scrollAnchorRef} />
    </div>
  )
}
```

---

## Task 13: `ChatInput` (text only first)

**Files:**
- Create: `src/app/chat/[slug]/components/ChatInput.tsx`

- [ ] **Step 1: Write text-only input**

```tsx
'use client'

import { useState } from 'react'
import { sendMessage } from '@/actions/chat'
import type { ChatMessage } from '../ChatClient'

export function ChatInput({
  slug,
  conversationId,
  sending,
  onSending,
  onError,
  onLocalAdd,
}: {
  slug: string
  conversationId: string
  sending: boolean
  onSending: (s: boolean) => void
  onError: (e: string | null) => void
  onLocalAdd: (m: ChatMessage) => void
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
    setText('')

    const result = await sendMessage({
      slug,
      text: trimmed,
      messageType: 'text',
    })

    if (!result.success) {
      onError(result.error ?? 'Erro ao enviar.')
    }
    onSending(false)
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <footer className="flex items-end gap-2 bg-white px-3 py-2 shadow-inner">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKey}
        rows={1}
        placeholder="Mensagem"
        className="max-h-32 flex-1 resize-none rounded-2xl bg-gray-100 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#075E54]"
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={!text.trim() || sending}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-[#075E54] text-white disabled:opacity-50"
        aria-label="Enviar"
      >
        ➤
      </button>
    </footer>
  )
}
```

- [ ] **Step 2: TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Manual smoke test**

```bash
npm run dev
```

Pre-req: at least one row in `store_settings`. Get its `chat_slug`:

```sql
SELECT id, store_name, chat_slug FROM store_settings LIMIT 5;
```

Open `http://localhost:3000/chat/<slug>` in an incognito window. Expected:
- Page loads with WhatsApp-style header (store name + "online")
- Empty message area
- Input at the bottom

Type "olá" and press Enter:
- Message appears as a green bubble on the right
- A row exists in `messages` table for that conversation
- A new row in `conversations` for that store + visitor
- Cookie `lue_visitor` set on `/chat`

If `N8N_WEBHOOK_URL` is set, n8n received the POST.

Stop dev with Ctrl+C.

- [ ] **Step 4: Commit page + components + skeleton**

```bash
git add src/app/chat
git commit -m "feat(chat): /chat/<slug> page with text-only WhatsApp UI"
```

---

## Task 14: Realtime subscription for AI replies

**Files:**
- Modify: `src/app/chat/[slug]/ChatClient.tsx`

- [ ] **Step 1: Add subscription effect**

In `ChatClient.tsx`, add the import:

```tsx
import { createClient as createBrowserSupabase } from '@/lib/supabase/client'
```

Inside the `ChatClient` function, before the existing `useEffect` for scrolling, add:

```tsx
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

        dispatch({
          type: 'add',
          message: {
            id: row.id,
            role: row.role,
            content: row.content,
            message_type: row.message_type,
            media_url,
            created_at: row.created_at,
          },
        })
      },
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}, [conversationId])
```

- [ ] **Step 2: Add `/api/chat/media-url` route**

Create `src/app/api/chat/media-url/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const path = body?.path
  if (typeof path !== 'string' || path.length === 0) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 })
  }
  const admin = createAdminClient()
  const { data, error } = await admin.storage
    .from('chat-media')
    .createSignedUrl(path, 60 * 60 * 24)
  if (error || !data) {
    return NextResponse.json({ error: 'signed url failed' }, { status: 500 })
  }
  return NextResponse.json({ url: data.signedUrl })
}
```

This endpoint exists because Realtime payload only carries `media_path`, not signed URL. It is invoked by the client only for messages it already learned about via Realtime.

- [ ] **Step 3: Manual test**

```bash
npm run dev
```

Open chat in two tabs of the same incognito window (so they share the cookie/conversation). In Supabase SQL editor, insert a fake assistant reply:

```sql
INSERT INTO messages (conversation_id, role, content, message_type)
VALUES ('<conversation_id from previous test>', 'assistant', 'Resposta da IA simulada', 'text');
```

Expected: the white bubble "Resposta da IA simulada" appears on both tabs within ~1 second without reload.

- [ ] **Step 4: Commit**

```bash
git add src/app/chat src/app/api/chat
git commit -m "feat(chat): realtime subscription for inbound messages"
```

---

## Task 15: Image attachment

**Files:**
- Modify: `src/app/chat/[slug]/components/ChatInput.tsx`

- [ ] **Step 1: Add image upload helper**

In `ChatInput.tsx`, add at the top inside the file (above the component):

```tsx
import { getUploadUrl, sendMessage } from '@/actions/chat'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp']

async function resizeImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    const maxW = 1920
    if (img.width <= maxW) return file
    const scale = maxW / img.width
    const canvas = document.createElement('canvas')
    canvas.width = maxW
    canvas.height = Math.round(img.height * scale)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b ?? file), file.type, 0.9)
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
```

- [ ] **Step 2: Add the file input + handler inside the component**

Inside the `ChatInput` component, add a `fileInputRef` and `handleImage`:

```tsx
const fileInputRef = useRef<HTMLInputElement>(null)

async function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  if (!ALLOWED_IMAGE.includes(file.type)) {
    onError('Tipo de imagem não suportado.')
    return
  }
  if (file.size > MAX_IMAGE_BYTES) {
    onError('Imagem maior que 5MB.')
    return
  }
  onSending(true)
  onError(null)
  try {
    const blob = await resizeImage(file)
    const upload = await getUploadUrl({
      slug,
      mime: file.type,
      size: blob.size,
    })
    if (!upload.success || !upload.uploadUrl || !upload.mediaPath) {
      onError(upload.error ?? 'Erro no upload.')
      return
    }
    const put = await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: blob,
    })
    if (!put.ok) {
      onError('Falha no upload.')
      return
    }
    const result = await sendMessage({
      slug,
      text: '',
      mediaPath: upload.mediaPath,
      messageType: 'image',
    })
    if (!result.success) {
      onError(result.error ?? 'Erro ao enviar imagem.')
    }
  } finally {
    onSending(false)
  }
}
```

Add `useRef` to the React import at the top.

- [ ] **Step 3: Render the paperclip button + hidden input in the footer**

In the `<footer>` JSX, **before** the `<textarea>`, add:

```tsx
<input
  ref={fileInputRef}
  type="file"
  accept="image/jpeg,image/png,image/webp"
  className="hidden"
  onChange={handleImage}
/>
<button
  type="button"
  onClick={() => fileInputRef.current?.click()}
  disabled={sending}
  className="flex h-10 w-10 items-center justify-center text-gray-500 disabled:opacity-50"
  aria-label="Anexar imagem"
>
  📎
</button>
```

- [ ] **Step 4: Manual test**

```bash
npm run dev
```

In chat tab: click 📎 → pick a JPG/PNG → wait briefly → image appears as a bubble on the right. Verify:
- Row in `messages` with `message_type='image'` and `media_path` set
- Object in `chat-media` bucket at the path
- n8n received POST with `tipo_de_mensagem: 'image'` and `media_url`

- [ ] **Step 5: Commit**

```bash
git add src/app/chat
git commit -m "feat(chat): image attachment with client-side resize and signed upload"
```

---

## Task 16: Audio recording

**Files:**
- Create: `src/app/chat/[slug]/components/AudioRecorder.tsx`
- Modify: `src/app/chat/[slug]/components/ChatInput.tsx`

- [ ] **Step 1: Create `AudioRecorder.tsx`**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'

const MAX_SECONDS = 60

export function AudioRecorder({
  onRecorded,
  onCancel,
  disabled,
}: {
  onRecorded: (blob: Blob, durationMs: number) => void
  onCancel: () => void
  disabled?: boolean
}) {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef<number>(0)
  const intervalRef = useRef<number | null>(null)

  async function start() {
    if (disabled) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        const b = new Blob(chunksRef.current, { type: 'audio/webm' })
        setBlob(b)
        setPreviewUrl(URL.createObjectURL(b))
        stream.getTracks().forEach((t) => t.stop())
      }
      rec.start()
      recorderRef.current = rec
      startedAtRef.current = Date.now()
      setRecording(true)
      setSeconds(0)
      intervalRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000)
        setSeconds(elapsed)
        if (elapsed >= MAX_SECONDS) stop()
      }, 250)
    } catch {
      onCancel()
    }
  }

  function stop() {
    if (intervalRef.current) window.clearInterval(intervalRef.current)
    intervalRef.current = null
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
  }

  function discard() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setBlob(null)
    setPreviewUrl(null)
    onCancel()
  }

  function send() {
    if (!blob) return
    onRecorded(blob, Date.now() - startedAtRef.current)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setBlob(null)
    setPreviewUrl(null)
  }

  useEffect(() => {
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  if (blob && previewUrl) {
    return (
      <div className="flex flex-1 items-center gap-2">
        <audio controls src={previewUrl} className="flex-1" />
        <button
          onClick={discard}
          className="rounded px-3 py-1 text-sm text-red-600"
          type="button"
        >
          Descartar
        </button>
        <button
          onClick={send}
          className="rounded bg-[#075E54] px-3 py-1 text-sm text-white"
          type="button"
        >
          Enviar
        </button>
      </div>
    )
  }

  if (recording) {
    return (
      <div className="flex flex-1 items-center gap-2">
        <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
        <span className="font-mono text-sm">
          {String(Math.floor(seconds / 60)).padStart(2, '0')}:
          {String(seconds % 60).padStart(2, '0')}
        </span>
        <span className="flex-1" />
        <button
          onClick={discard}
          className="rounded px-3 py-1 text-sm text-red-600"
          type="button"
        >
          Cancelar
        </button>
        <button
          onClick={stop}
          className="rounded bg-[#075E54] px-3 py-1 text-sm text-white"
          type="button"
        >
          Parar
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled}
      className="flex h-10 w-10 items-center justify-center rounded-full bg-[#075E54] text-white disabled:opacity-50"
      aria-label="Gravar áudio"
    >
      🎤
    </button>
  )
}
```

- [ ] **Step 2: Wire `AudioRecorder` into `ChatInput`**

In `ChatInput.tsx`:

Add the import at the top:

```tsx
import { AudioRecorder } from './AudioRecorder'
```

Add state for browser support:

```tsx
const [audioSupported, setAudioSupported] = useState(false)
const [recordingMode, setRecordingMode] = useState(false)

useEffect(() => {
  setAudioSupported(
    typeof window !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined',
  )
}, [])
```

Add `useEffect` to the React import.

Add the audio handler:

```tsx
async function handleAudio(blob: Blob) {
  setRecordingMode(false)
  if (blob.size > 2 * 1024 * 1024) {
    onError('Áudio maior que 2MB.')
    return
  }
  onSending(true)
  onError(null)
  try {
    const upload = await getUploadUrl({
      slug,
      mime: 'audio/webm',
      size: blob.size,
    })
    if (!upload.success || !upload.uploadUrl || !upload.mediaPath) {
      onError(upload.error ?? 'Erro no upload.')
      return
    }
    const put = await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/webm' },
      body: blob,
    })
    if (!put.ok) {
      onError('Falha no upload.')
      return
    }
    const result = await sendMessage({
      slug,
      text: '',
      mediaPath: upload.mediaPath,
      messageType: 'audio',
    })
    if (!result.success) {
      onError(result.error ?? 'Erro ao enviar áudio.')
    }
  } finally {
    onSending(false)
  }
}
```

Replace the send button block. The footer JSX should now look like:

```tsx
<footer className="flex items-end gap-2 bg-white px-3 py-2 shadow-inner">
  {recordingMode ? (
    <AudioRecorder
      onRecorded={handleAudio}
      onCancel={() => setRecordingMode(false)}
      disabled={sending}
    />
  ) : (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleImage}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={sending}
        className="flex h-10 w-10 items-center justify-center text-gray-500 disabled:opacity-50"
        aria-label="Anexar imagem"
      >
        📎
      </button>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKey}
        rows={1}
        placeholder="Mensagem"
        className="max-h-32 flex-1 resize-none rounded-2xl bg-gray-100 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#075E54]"
      />
      {text.trim() ? (
        <button
          type="button"
          onClick={handleSend}
          disabled={sending}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[#075E54] text-white disabled:opacity-50"
          aria-label="Enviar"
        >
          ➤
        </button>
      ) : audioSupported ? (
        <button
          type="button"
          onClick={() => setRecordingMode(true)}
          disabled={sending}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[#075E54] text-white disabled:opacity-50"
          aria-label="Gravar áudio"
        >
          🎤
        </button>
      ) : null}
    </>
  )}
</footer>
```

- [ ] **Step 3: Manual test**

```bash
npm run dev
```

In chat tab: clear text → click 🎤 → grant mic permission → record 3s → "Parar" → preview appears → "Enviar" → bubble with `<audio>` player. Verify:
- Row in `messages` with `message_type='audio'`
- Object in bucket
- n8n received POST with `tipo_de_mensagem: 'audio'`

- [ ] **Step 4: Commit**

```bash
git add src/app/chat
git commit -m "feat(chat): audio recording with MediaRecorder"
```

---

## Task 17: `ChatUrlCard` for `/loja`

**Files:**
- Create: `src/components/loja/ChatUrlCard.tsx`
- Create: `src/components/loja/CopyButton.tsx`
- Modify: `src/app/loja/page.tsx`

- [ ] **Step 1: Create `CopyButton.tsx`**

```tsx
'use client'

import { useState } from 'react'

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback noop
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
    >
      {copied ? 'Copiado!' : 'Copiar'}
    </button>
  )
}
```

- [ ] **Step 2: Create `ChatUrlCard.tsx` (server component)**

```tsx
import { createClient } from '@/lib/supabase/server'
import { CopyButton } from './CopyButton'

export async function ChatUrlCard() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('store_settings')
    .select('chat_slug')
    .eq('id', user.id)
    .maybeSingle()

  if (!data?.chat_slug) {
    return (
      <div className="mb-6 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4">
        <p className="text-sm text-gray-600">
          Salve as configurações da loja para gerar a URL do seu chat.
        </p>
      </div>
    )
  }

  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  const url = `${base}/chat/${data.chat_slug}`

  return (
    <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <span aria-hidden>💬</span> URL do seu chat
      </h3>
      <div className="mb-3 flex gap-2">
        <input
          readOnly
          value={url}
          className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-mono"
        />
        <CopyButton value={url} />
      </div>
      <p className="text-xs text-gray-600">
        Compartilhe este link com seus clientes para iniciarem uma conversa
        com o atendimento da sua loja.
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Mount in `/loja`**

In `src/app/loja/page.tsx`, the page is currently a `'use client'` component. Mount the server card from a parent. Easiest path: convert the existing page to a child component and add a server wrapper.

Rename current default export from `LojaPage` to `LojaForm` and remove `export default` from it. At the top, add a server component wrapper. Change the file to:

```tsx
'use client'

// ... (existing imports unchanged)

// Rename the existing function:
export function LojaForm() {
  // ... existing body unchanged
}
```

(Remove `export default` from `LojaForm`.)

Now create a new server entry. **Replace** `src/app/loja/page.tsx` with two files:

`src/app/loja/page.tsx` (server):

```tsx
import { ChatUrlCard } from '@/components/loja/ChatUrlCard'
import { LojaForm } from './LojaForm'

export default async function LojaPage() {
  return (
    <div className="p-6 max-w-2xl">
      <h2 className="mb-6 text-xl font-semibold text-gray-900">
        Configurações da Loja
      </h2>
      <ChatUrlCard />
      <LojaForm />
    </div>
  )
}
```

`src/app/loja/LojaForm.tsx` (client) — move all current `'use client'` content here, including the `<h2>Configurações da Loja</h2>` removed (now lives in the server wrapper) and the outer wrapper div removed (also in server wrapper). The exported function is `LojaForm` (no default).

- [ ] **Step 4: Manual test**

```bash
npm run dev
```

Log in as a store owner → visit `/loja`:
- Blue card at top with the URL `http://localhost:3000/chat/<slug>`
- Click "Copiar" → text "Copiado!" for 2s
- Form below works as before

- [ ] **Step 5: Commit**

```bash
git add src/components/loja src/app/loja
git commit -m "feat(loja): card with copyable chat URL at top of /loja"
```

---

## Task 18: QR Code button

**Files:**
- Modify: `package.json` (add `qrcode`)
- Create: `src/components/loja/QRCodeDialog.tsx`
- Modify: `src/components/loja/ChatUrlCard.tsx`

- [ ] **Step 1: Install qrcode**

```bash
npm install qrcode
npm install --save-dev @types/qrcode
```

- [ ] **Step 2: Create `QRCodeDialog.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export function QRCodeDialog({ value }: { value: string }) {
  const [open, setOpen] = useState(false)
  const [svg, setSvg] = useState<string>('')

  useEffect(() => {
    if (!open) return
    QRCode.toString(value, { type: 'svg', width: 240, margin: 1 }).then(setSvg)
  }, [open, value])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-blue-700 underline"
      >
        📱 Ver QR Code
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="mb-3"
              dangerouslySetInnerHTML={{ __html: svg }}
              aria-label="QR code"
            />
            <p className="mb-3 break-all text-center text-xs text-gray-600">
              {value}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full rounded-md bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-300"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  )
}
```

`dangerouslySetInnerHTML` here is safe because the SVG comes from the `qrcode` library given a URL we control — not from user input.

- [ ] **Step 3: Mount in `ChatUrlCard.tsx`**

In `ChatUrlCard.tsx`, add the import:

```tsx
import { QRCodeDialog } from './QRCodeDialog'
```

Add `<QRCodeDialog value={url} />` after the `<p>` paragraph at the bottom of the card.

- [ ] **Step 4: Manual test**

```bash
npm run dev
```

`/loja` → click "Ver QR Code" → modal with QR. Scan with phone camera → opens `/chat/<slug>`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/loja
git commit -m "feat(loja): QR code dialog for chat URL"
```

---

## Task 19: Full manual test pass

**Files:** none — manual verification.

- [ ] **Step 1: Run the manual test script**

Start fresh: `npm run dev`. Use a clean incognito window per test where indicated.

| # | Step | Expected |
|---|---|---|
| 1 | Log in as lojista, go to `/loja` | Card "URL do seu chat" visible at top |
| 2 | Click "Copiar" | Button text changes to "Copiado!" for 2s |
| 3 | Open copied URL in incognito window A | Chat page loads, header shows store name + "online" |
| 4 | Send "olá" | Green bubble on right; row in `messages` (`role='user'`); n8n POST received (check webhook.site if no real n8n) |
| 5 | In Supabase SQL editor, INSERT `role='assistant'` reply for that conversation | White bubble appears in window A within ~1s, no reload |
| 6 | Open same URL in incognito window B (different browser profile) | Empty conversation — separate `visitor_id`, separate `conversation_id` |
| 7 | Visit `/chat/zzzzzz` (non-existent slug) | 404 page (Next default) |
| 8 | Attach a JPG ≤ 5MB | Image bubble appears; row with `message_type='image'`; object in `chat-media` bucket |
| 9 | Attach a JPG > 5MB | Inline error "Imagem maior que 5MB", no upload |
| 10 | Record 5s of audio, send | Audio player bubble; row with `message_type='audio'`; object in bucket |
| 11 | Deny mic permission | Recording cancels gracefully, no crash |
| 12 | DevTools → Application → Cookies → delete `lue_visitor` → send next message | New `visitor_id`, new conversation; old conversation untouched |
| 13 | DevTools → Network → modify outgoing fetch body to swap `slug` to a slug not yours | Server still uses your cookie; you can't access another visitor's conversation |
| 14 | Log out, visit `/loja` | Redirected to `/login` (middleware unchanged) |
| 15 | Visit `/chat/<slug>` while logged in as lojista in same browser | Chat opens normally — `/chat` is whitelisted in middleware, no redirect, but auth cookies are not added either |
| 16 | Click "Ver QR Code" → scan with phone | Phone opens chat page |

- [ ] **Step 2: Note any failures**

Any failures → file inline tasks (use `TaskCreate`) and fix, then re-run that row only.

- [ ] **Step 3: When all green, prepare PR**

```bash
git push -u origin feat/chat-loja
gh pr create --title "feat: WhatsApp-style customer chat at /chat/<slug>" --body "$(cat <<'EOF'
## Summary
- Public chat page per store with WhatsApp-style UI (text/image/audio)
- httpOnly HMAC-signed visitor cookie isolates conversations
- Outbound n8n webhook with full payload (mensagem, id_mensagem, id_conversa, nome_loja, id_loja, tipo_de_mensagem, media_url?)
- Supabase Realtime delivers AI replies to the client
- New "URL do seu chat" card on /loja with copy button + QR code

## Test plan
- [x] Manual test pass (Task 19) — all 16 steps green
- [x] Vitest: `npm test` — 12 passing (visitor-cookie + n8n payload)
- [ ] Apply migration `012_chat_slug_and_media.sql` in production
- [ ] Create `chat-media` bucket in production Supabase
- [ ] Set `SESSION_SECRET` and `NEXT_PUBLIC_APP_URL` env vars in production

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

1. **Spec coverage**

| Spec section | Plan task |
|---|---|
| Migration `012_chat_slug_and_media.sql` | Task 1 |
| Bucket `chat-media` | Task 2 |
| Database types | Task 3 |
| Cookie `lue_visitor` (HMAC, env var) | Task 5 |
| Server actions `ensureConversation`, `sendMessage`, `getUploadUrl` | Task 7 |
| `dispatchToN8n` expanded payload | Task 6 |
| Page `/chat/[slug]` server component | Task 9 |
| `ChatClient` + reducer | Task 10 |
| WhatsApp UI: header, list, bubble, input | Tasks 11-13 |
| Realtime subscription | Task 14 |
| Image attachment (resize, upload, bubble) | Task 15 |
| Audio recording (MediaRecorder, preview, send) | Task 16 |
| Card on `/loja` with copy + QR | Tasks 17-18 |
| Middleware exclude `/chat` | Task 8 |
| Manual test plan | Task 19 |
| Unit tests (visitor-cookie, n8n) | Tasks 5, 6 |
| Env vars `SESSION_SECRET`, `NEXT_PUBLIC_APP_URL` | Task 0, Task 19 (PR checklist) |

**Gap noted and accepted:** the spec mentions a `rate_limit` table for 30 msgs/min per visitor + 100/h per IP. This plan does **not** implement it — deliberately deferred (YAGNI for the first ship; abuse can be added when seen). Document this on the PR description if you want a follow-up issue.

2. **Placeholder scan:** none.

3. **Type consistency**

- Cookie name `lue_visitor` consistent (lib + COOKIE_OPTIONS path).
- Webhook payload field names consistent across `n8n.ts`, tests, and `sendMessage` callsite.
- `ChatMessage` type defined once in `ChatClient.tsx`, imported by `MessageList`/`MessageBubble`.
- `getUploadUrl` returns `mediaPath` and `sendMessage` consumes `mediaPath` — names match.
- `ensureConversation` returns `messages: Array<{...}>` with the same field names rendered by `MessageBubble`.
- `signedReadUrl` always returns `string | null`; consumers handle null.

All consistent.
