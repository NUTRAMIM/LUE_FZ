# E-mails de auth via Resend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Personalizar os e-mails de confirmação de cadastro e de redefinição de senha, enviando-os pelo Resend com templates branded LUE, via o Send Email Hook do Supabase; e construir o fluxo de "esqueceu a senha" que hoje não existe.

**Architecture:** O Supabase gera o token e faz POST assinado num endpoint nosso (`/api/auth/send-email`), que verifica a assinatura, escolhe o template pelo `email_action_type` e envia via Resend. O link do e-mail aponta para `/auth/confirm`, que chama `verifyOtp({ token_hash, type })`, estabelece a sessão e redireciona (signup → `/painel`, recovery → `/reset-password`). A lógica de roteamento e os templates são funções puras testáveis; os route handlers ficam finos.

**Tech Stack:** Next.js 16 (App Router, route handlers), React 19, `@supabase/ssr`, `resend`, `standardwebhooks`, vitest.

**Spec:** `docs/superpowers/specs/2026-06-13-emails-auth-resend-design.md`

---

## Notas de ambiente (ler antes de começar)

- **Next.js 16 é não-padrão** (ver `AGENTS.md`). A doc de route handlers está em
  `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`.
  Confirmado: `export async function GET/POST(request: Request)` e
  `NextResponse.redirect(new URL(...))` são válidos; route handlers não são
  cacheados por padrão.
- **Cores brand** (de `src/app/globals.css`, para CSS inline dos e-mails):
  `brand-600 = #7C3AED`, `brand-700 = #6D28D9`, `brand-900 = #4C1D95`,
  `brand-950 = #2E1065`, `slate` padrão.
- **Testes:** vitest com alias `@/` → `src/`. Arquivos em
  `src/**/__tests__/**/*.test.ts`. Convenção atual usa imports relativos.
- **Shell:** Windows/PowerShell. Comandos `npm`/`git` rodam normalmente.
- **Não comitar segredos.** O `.env.local` recebe placeholders; os valores reais
  vão no ambiente (Vercel/EasyPanel) manualmente.

## Estrutura de arquivos

**Novos:**
- `src/lib/resend.ts` — client lazy do Resend
- `src/lib/emails/layout.ts` — `renderEmail()` (shell HTML branded)
- `src/lib/emails/templates.ts` — `confirmSignupTemplate`, `resetPasswordTemplate`, `genericAuthTemplate`
- `src/lib/emails/hook.ts` — `nextFor()`, `pickTemplate()`, `buildActionUrl()` (puro)
- `src/app/api/auth/send-email/route.ts` — handler do Send Email Hook
- `src/app/auth/confirm/route.ts` — `verifyOtp` + redirect
- `src/app/auth/auth-code-error/page.tsx` — tela de erro
- `src/app/reset-password/page.tsx` — form de nova senha
- Testes: `src/lib/__tests__/emails-layout.test.ts`, `emails-templates.test.ts`, `emails-hook.test.ts`

**Modificados:**
- `src/app/login/page.tsx` — link + modo "esqueceu a senha"
- `package.json` — `resend`, `standardwebhooks`
- `.env.local` — placeholders das 3 vars

---

## Task 1: Dependências e variáveis de ambiente

**Files:**
- Modify: `package.json`
- Modify: `.env.local`

- [ ] **Step 1: Instalar as dependências**

Run:
```bash
npm install resend standardwebhooks
```
Expected: `package.json` ganha `resend` e `standardwebhooks` em `dependencies`; sem erros de instalação.

- [ ] **Step 2: Adicionar placeholders no `.env.local`**

Acrescente ao final de `.env.local`:
```
# Resend (e-mails de auth) — valores reais vão no ambiente, não comitar
RESEND_API_KEY=
EMAIL_FROM=onboarding@resend.dev
SEND_EMAIL_HOOK_SECRET=
```
Nota: `EMAIL_FROM=onboarding@resend.dev` é o remetente de teste do Resend
(só entrega pro e-mail da própria conta Resend). Depois do domínio verificado,
trocar por `LUE <nao-responda@ialue.com.br>`.

- [ ] **Step 3: Verificar o type-check ainda passa**

Run:
```bash
npx tsc --noEmit
```
Expected: sem novos erros (as libs trazem seus próprios tipos).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.local
git commit -m "chore(emails): adiciona resend e standardwebhooks + env placeholders"
```

---

## Task 2: Shell HTML dos e-mails (`renderEmail`)

**Files:**
- Create: `src/lib/emails/layout.ts`
- Test: `src/lib/__tests__/emails-layout.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/lib/__tests__/emails-layout.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { renderEmail } from '../emails/layout'

describe('renderEmail', () => {
  const html = renderEmail({
    preheader: 'pré-cabeçalho',
    heading: 'Título do e-mail',
    bodyHtml: '<p>corpo do e-mail</p>',
    ctaLabel: 'Clique aqui',
    ctaUrl: 'https://exemplo.test/acao',
    footnote: 'Se você não pediu isso, ignore.',
  })

  it('inclui o heading', () => {
    expect(html).toContain('Título do e-mail')
  })

  it('inclui o bodyHtml cru', () => {
    expect(html).toContain('<p>corpo do e-mail</p>')
  })

  it('inclui o botão com a URL e o label do CTA', () => {
    expect(html).toContain('https://exemplo.test/acao')
    expect(html).toContain('Clique aqui')
  })

  it('inclui a marca LUE e o footnote', () => {
    expect(html).toContain('LUE')
    expect(html).toContain('Se você não pediu isso, ignore.')
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run:
```bash
npx vitest run src/lib/__tests__/emails-layout.test.ts
```
Expected: FAIL — não resolve `../emails/layout`.

- [ ] **Step 3: Implementar `renderEmail`**

Create `src/lib/emails/layout.ts`:
```ts
export interface EmailLayoutOptions {
  /** Texto curto exibido como preview na caixa de entrada (oculto no corpo). */
  preheader: string
  /** Título grande dentro do card. */
  heading: string
  /** HTML do corpo (parágrafos). Confiável — montado por nós, não input do usuário. */
  bodyHtml: string
  /** Texto do botão de ação. */
  ctaLabel: string
  /** URL do botão de ação. */
  ctaUrl: string
  /** Linha fina de rodapé (ex.: "se não foi você, ignore"). */
  footnote: string
}

// HTML table-based com estilos inline — padrão para máxima compatibilidade entre
// clientes de e-mail (Gmail, Outlook, Apple Mail).
export function renderEmail(o: EmailLayoutOptions): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${o.heading}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#F5F3FF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <span style="display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;">${o.preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F5F3FF;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 24px 60px -30px rgba(76,29,149,0.35);">
            <tr>
              <td style="background:linear-gradient(135deg,#7C3AED,#4C1D95);padding:28px 32px;">
                <span style="font-size:26px;font-weight:800;letter-spacing:-0.04em;color:#ffffff;">LUE</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#0B1020;">${o.heading}</h1>
                <div style="font-size:15px;line-height:1.6;color:#4A4F66;">${o.bodyHtml}</div>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0;">
                  <tr>
                    <td style="border-radius:12px;background-color:#7C3AED;">
                      <a href="${o.ctaUrl}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">${o.ctaLabel}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#9095AC;">${o.footnote}</p>
                <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:#9095AC;word-break:break-all;">Ou copie e cole este link no navegador:<br /><a href="${o.ctaUrl}" style="color:#7C3AED;">${o.ctaUrl}</a></p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid #EFF0F5;">
                <p style="margin:0;font-size:12px;color:#9095AC;">© 2026 LUE · Acesso seguro</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run:
```bash
npx vitest run src/lib/__tests__/emails-layout.test.ts
```
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/emails/layout.ts src/lib/__tests__/emails-layout.test.ts
git commit -m "feat(emails): shell HTML branded reutilizavel (renderEmail)"
```

---

## Task 3: Templates de confirmação, reset e genérico

**Files:**
- Create: `src/lib/emails/templates.ts`
- Test: `src/lib/__tests__/emails-templates.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/lib/__tests__/emails-templates.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  confirmSignupTemplate,
  resetPasswordTemplate,
  genericAuthTemplate,
} from '../emails/templates'

const ACTION_URL =
  'https://ialue.com.br/auth/confirm?token_hash=x&type=signup&next=%2Fpainel'

describe.each([
  ['confirmSignup', confirmSignupTemplate],
  ['resetPassword', resetPasswordTemplate],
  ['genericAuth', genericAuthTemplate],
])('%s template', (_name, tpl) => {
  it('tem subject não-vazio', () => {
    expect(tpl.subject.length).toBeGreaterThan(0)
  })

  it('render inclui o actionUrl', () => {
    expect(tpl.render(ACTION_URL)).toContain(ACTION_URL)
  })

  it('render inclui a marca LUE', () => {
    expect(tpl.render(ACTION_URL)).toContain('LUE')
  })
})

describe('confirmSignupTemplate', () => {
  it('subject menciona confirmação/cadastro', () => {
    expect(confirmSignupTemplate.subject.toLowerCase()).toMatch(/confirm|cadastro/)
  })
})

describe('resetPasswordTemplate', () => {
  it('subject menciona senha', () => {
    expect(resetPasswordTemplate.subject.toLowerCase()).toContain('senha')
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run:
```bash
npx vitest run src/lib/__tests__/emails-templates.test.ts
```
Expected: FAIL — não resolve `../emails/templates`.

- [ ] **Step 3: Implementar os templates**

Create `src/lib/emails/templates.ts`:
```ts
import { renderEmail } from './layout'

export interface EmailTemplate {
  subject: string
  /** Recebe a URL de ação (link de confirmação) e devolve o HTML completo. */
  render: (actionUrl: string) => string
}

export const confirmSignupTemplate: EmailTemplate = {
  subject: 'Confirme seu cadastro na LUE',
  render: (actionUrl) =>
    renderEmail({
      preheader: 'Falta só um clique para ativar sua conta na LUE.',
      heading: 'Bem-vindo à LUE 👋',
      bodyHtml:
        '<p style="margin:0 0 12px;">Sua conta foi criada. Para começar a usar o painel, confirme seu e-mail no botão abaixo.</p>',
      ctaLabel: 'Confirmar meu e-mail',
      ctaUrl: actionUrl,
      footnote:
        'Se você não criou uma conta na LUE, pode ignorar este e-mail com segurança.',
    }),
}

export const resetPasswordTemplate: EmailTemplate = {
  subject: 'Redefina sua senha da LUE',
  render: (actionUrl) =>
    renderEmail({
      preheader: 'Use o link para criar uma nova senha de acesso.',
      heading: 'Redefinir sua senha',
      bodyHtml:
        '<p style="margin:0 0 12px;">Recebemos um pedido para redefinir a senha da sua conta. Clique no botão abaixo para criar uma nova senha. O link expira em pouco tempo.</p>',
      ctaLabel: 'Criar nova senha',
      ctaUrl: actionUrl,
      footnote:
        'Se você não pediu para redefinir a senha, ignore este e-mail — sua senha atual continua valendo.',
    }),
}

// Fallback para email_action_type que ainda não personalizamos (magiclink,
// invite, email_change). Garante que nenhum e-mail de auth fique sem envio.
export const genericAuthTemplate: EmailTemplate = {
  subject: 'Ação de segurança na sua conta LUE',
  render: (actionUrl) =>
    renderEmail({
      preheader: 'Confirme esta ação na sua conta LUE.',
      heading: 'Confirme esta ação',
      bodyHtml:
        '<p style="margin:0 0 12px;">Para continuar, confirme esta ação na sua conta clicando no botão abaixo.</p>',
      ctaLabel: 'Confirmar',
      ctaUrl: actionUrl,
      footnote:
        'Se você não reconhece esta ação, ignore este e-mail.',
    }),
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run:
```bash
npx vitest run src/lib/__tests__/emails-templates.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/emails/templates.ts src/lib/__tests__/emails-templates.test.ts
git commit -m "feat(emails): templates de confirmacao, reset e generico"
```

---

## Task 4: Roteamento do hook (`nextFor`, `pickTemplate`, `buildActionUrl`)

**Files:**
- Create: `src/lib/emails/hook.ts`
- Test: `src/lib/__tests__/emails-hook.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/lib/__tests__/emails-hook.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { nextFor, pickTemplate, buildActionUrl } from '../emails/hook'
import {
  confirmSignupTemplate,
  resetPasswordTemplate,
  genericAuthTemplate,
} from '../emails/templates'

describe('nextFor', () => {
  it('recovery → /reset-password', () => {
    expect(nextFor('recovery')).toBe('/reset-password')
  })
  it('signup → /painel', () => {
    expect(nextFor('signup')).toBe('/painel')
  })
  it('tipo desconhecido → /painel', () => {
    expect(nextFor('magiclink')).toBe('/painel')
  })
})

describe('pickTemplate', () => {
  it('signup → confirmSignupTemplate', () => {
    expect(pickTemplate('signup')).toBe(confirmSignupTemplate)
  })
  it('recovery → resetPasswordTemplate', () => {
    expect(pickTemplate('recovery')).toBe(resetPasswordTemplate)
  })
  it('desconhecido → genericAuthTemplate', () => {
    expect(pickTemplate('email_change')).toBe(genericAuthTemplate)
  })
})

describe('buildActionUrl', () => {
  it('monta URL de recovery com token_hash, type e next encodados', () => {
    const url = buildActionUrl({
      token_hash: 'abc123',
      email_action_type: 'recovery',
      site_url: 'https://ialue.com.br',
    })
    expect(url).toBe(
      'https://ialue.com.br/auth/confirm?token_hash=abc123&type=recovery&next=%2Freset-password',
    )
  })

  it('usa /painel pra signup', () => {
    const url = buildActionUrl({
      token_hash: 'tok',
      email_action_type: 'signup',
      site_url: 'https://ialue.com.br',
    })
    expect(url).toContain('type=signup')
    expect(url).toContain('next=%2Fpainel')
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run:
```bash
npx vitest run src/lib/__tests__/emails-hook.test.ts
```
Expected: FAIL — não resolve `../emails/hook`.

- [ ] **Step 3: Implementar o roteamento**

Create `src/lib/emails/hook.ts`:
```ts
import {
  confirmSignupTemplate,
  resetPasswordTemplate,
  genericAuthTemplate,
  type EmailTemplate,
} from './templates'

/** Campos do `email_data` do payload do Send Email Hook que usamos. */
export interface HookEmailData {
  token_hash: string
  email_action_type: string
  site_url: string
}

/** Para onde `/auth/confirm` redireciona após verificar o token. */
export function nextFor(actionType: string): string {
  if (actionType === 'recovery') return '/reset-password'
  return '/painel'
}

/** Escolhe o template pelo tipo de ação; desconhecido cai no genérico. */
export function pickTemplate(actionType: string): EmailTemplate {
  switch (actionType) {
    case 'signup':
      return confirmSignupTemplate
    case 'recovery':
      return resetPasswordTemplate
    default:
      return genericAuthTemplate
  }
}

/** Monta o link de ação que vai no e-mail, apontando para /auth/confirm. */
export function buildActionUrl(data: HookEmailData): string {
  const params = new URLSearchParams({
    token_hash: data.token_hash,
    type: data.email_action_type,
    next: nextFor(data.email_action_type),
  })
  return `${data.site_url}/auth/confirm?${params.toString()}`
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run:
```bash
npx vitest run src/lib/__tests__/emails-hook.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/emails/hook.ts src/lib/__tests__/emails-hook.test.ts
git commit -m "feat(emails): roteamento do hook (template + action url por tipo)"
```

---

## Task 5: Client Resend (lazy)

**Files:**
- Create: `src/lib/resend.ts`

- [ ] **Step 1: Implementar o client lazy**

Sem teste unitário (é só fiação de uma lib externa; coberto pelo teste manual de
ponta a ponta). Lazy para não quebrar o build quando `RESEND_API_KEY` está ausente
no momento do bundling.

Create `src/lib/resend.ts`:
```ts
import { Resend } from 'resend'

let client: Resend | null = null

/** Devolve o client Resend, instanciando sob demanda. Lança se a key faltar. */
export function getResend(): Resend {
  if (!client) {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new Error('RESEND_API_KEY ausente no ambiente.')
    }
    client = new Resend(apiKey)
  }
  return client
}
```

- [ ] **Step 2: Verificar type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/lib/resend.ts
git commit -m "feat(emails): client lazy do Resend"
```

---

## Task 6: Endpoint do Send Email Hook

**Files:**
- Create: `src/app/api/auth/send-email/route.ts`

- [ ] **Step 1: Implementar o route handler**

Sem teste unitário (verificação de assinatura + envio externo; coberto pelo teste
manual). Toda a lógica de decisão já está testada em `hook.ts`.

Create `src/app/api/auth/send-email/route.ts`:
```ts
import { Webhook } from 'standardwebhooks'
import { getResend } from '@/lib/resend'
import { pickTemplate, buildActionUrl } from '@/lib/emails/hook'

interface SendEmailPayload {
  user: { email: string }
  email_data: {
    token_hash: string
    email_action_type: string
    site_url: string
  }
}

export async function POST(request: Request) {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET
  if (!secret) {
    console.error('send-email hook: SEND_EMAIL_HOOK_SECRET ausente')
    return Response.json(
      { error: { http_code: 500, message: 'Configuração ausente.' } },
      { status: 500 },
    )
  }

  // Precisa do corpo CRU (string) para validar a assinatura — não usar req.json().
  const payload = await request.text()
  const headers = Object.fromEntries(request.headers)

  let data: SendEmailPayload
  try {
    // Secret vem como "v1,whsec_...". A lib standardwebhooks espera sem o "v1,".
    // Se a verificação falhar em runtime, testar remover "v1,whsec_" (ver spec).
    const wh = new Webhook(secret.replace(/^v1,/, ''))
    data = wh.verify(payload, headers) as SendEmailPayload
  } catch (err) {
    console.error('send-email hook: assinatura inválida', err)
    return Response.json(
      { error: { http_code: 401, message: 'Assinatura inválida.' } },
      { status: 401 },
    )
  }

  const { user, email_data } = data
  const template = pickTemplate(email_data.email_action_type)
  const actionUrl = buildActionUrl(email_data)

  const { error } = await getResend().emails.send({
    from: process.env.EMAIL_FROM!,
    to: [user.email],
    subject: template.subject,
    html: template.render(actionUrl),
  })

  if (error) {
    console.error('send-email hook: falha no Resend', error)
    return Response.json(
      { error: { http_code: 500, message: 'Falha ao enviar o e-mail.' } },
      { status: 500 },
    )
  }

  return Response.json({})
}
```

- [ ] **Step 2: Verificar type-check e build**

Run:
```bash
npx tsc --noEmit
```
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/send-email/route.ts
git commit -m "feat(emails): endpoint do Send Email Hook (verifica assinatura + envia via Resend)"
```

---

## Task 7: Route `/auth/confirm` (verifyOtp + redirect)

**Files:**
- Create: `src/app/auth/confirm/route.ts`

- [ ] **Step 1: Implementar o handler**

Padrão SSR/PKCE confirmado na doc do Supabase. `verifyOtp` estabelece a sessão via
cookies (o `createClient` server já cuida disso).

Create `src/app/auth/confirm/route.ts`:
```ts
import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/painel'

  if (token_hash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url))
    }
  }

  return NextResponse.redirect(new URL('/auth/auth-code-error', request.url))
}
```

- [ ] **Step 2: Verificar type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/app/auth/confirm/route.ts
git commit -m "feat(auth): route /auth/confirm verifica token e redireciona por tipo"
```

---

## Task 8: Página de erro `/auth/auth-code-error`

**Files:**
- Create: `src/app/auth/auth-code-error/page.tsx`

- [ ] **Step 1: Implementar a página (server component)**

Visual alinhado ao `/login` (fundo `bg-brand-mesh`, card branco, Wordmark).

Create `src/app/auth/auth-code-error/page.tsx`:
```tsx
import Link from 'next/link'
import { Wordmark } from '@/components/ui/Wordmark'

export default function AuthCodeErrorPage() {
  return (
    <div className="bg-brand-mesh relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <Wordmark size="lg" />
        </div>
        <div className="rounded-2xl border border-white bg-white/95 p-8 text-center shadow-[0_30px_80px_-30px_rgba(76,29,149,0.35)] backdrop-blur-sm">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Link inválido ou expirado
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Este link de confirmação não é mais válido. Tente fazer login novamente
            ou peça um novo link de redefinição de senha.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Voltar ao login
          </Link>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/app/auth/auth-code-error/page.tsx
git commit -m "feat(auth): tela amigavel de link invalido/expirado"
```

---

## Task 9: Página `/reset-password`

**Files:**
- Create: `src/app/reset-password/page.tsx`

- [ ] **Step 1: Implementar a página (client component)**

Reusa `Input`, `Label`, `Button`, `Wordmark`, ícones. O usuário chega aqui já com
sessão (estabelecida pelo `/auth/confirm` no fluxo recovery), então
`updateUser({ password })` funciona. Sem sessão → o `updateUser` falha e mostramos
mensagem orientando a refazer o fluxo.

Create `src/app/reset-password/page.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Wordmark } from '@/components/ui/Wordmark'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/Input'
import { IconLock, IconArrowRight } from '@/components/icons'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 6) {
      setError('A senha precisa ter ao menos 6 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.')
      return
    }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(
        'Não foi possível redefinir a senha. O link pode ter expirado — peça um novo em "Esqueceu a senha?".',
      )
      setLoading(false)
      return
    }

    router.refresh()
    router.push('/painel')
  }

  return (
    <div className="bg-brand-mesh relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <Wordmark size="lg" />
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
            Redefinir senha
          </p>
        </div>

        <div className="rounded-2xl border border-white bg-white/95 p-8 shadow-[0_30px_80px_-30px_rgba(76,29,149,0.35)] backdrop-blur-sm">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Criar nova senha
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Escolha uma nova senha para sua conta.
          </p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-5">
            <div>
              <Label htmlFor="password">Nova senha</Label>
              <div className="relative">
                <IconLock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="••••••••"
                  className="pl-10"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="confirm">Confirmar senha</Label>
              <div className="relative">
                <IconLock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={6}
                  placeholder="••••••••"
                  className="pl-10"
                />
              </div>
            </div>

            {error && (
              <div className="bg-danger-soft border-danger/20 rounded-lg border px-3 py-2">
                <p className="text-danger text-sm font-medium">{error}</p>
              </div>
            )}

            <Button type="submit" disabled={loading} size="lg" className="w-full">
              {loading ? (
                'Salvando...'
              ) : (
                <>
                  Salvar nova senha
                  <IconArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Confirmar que os ícones existem**

Run:
```bash
npx vitest run --passWithNoTests 2>&1 | head -1   # noop; usado só pra garantir shell ok
```
Verifique manualmente que `IconLock` e `IconArrowRight` são exportados de
`src/components/icons` (o `login/page.tsx` já os importa — então existem).

- [ ] **Step 3: Verificar type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/app/reset-password/page.tsx
git commit -m "feat(auth): pagina de redefinicao de senha"
```

---

## Task 10: Link "Esqueceu a senha?" na tela de login

**Files:**
- Modify: `src/app/login/page.tsx`

Adiciona um terceiro modo (`forgot`) à tela. O form é o mesmo; muda o submit e os
campos visíveis. No modo `forgot`, esconde a senha e dispara
`resetPasswordForEmail`.

- [ ] **Step 1: Trocar o estado `isSignUp` por um estado de view**

Em `src/app/login/page.tsx`, substitua a linha:
```tsx
  const [isSignUp, setIsSignUp] = useState(false)
```
por:
```tsx
  const [view, setView] = useState<'login' | 'signup' | 'forgot'>('login')
  const isSignUp = view === 'signup'
  const isForgot = view === 'forgot'
```

- [ ] **Step 2: Tratar o modo `forgot` no `handleSubmit`**

Logo após `const supabase = createClient()` dentro de `handleSubmit`, antes do
`if (isSignUp) {`, insira:
```tsx
    if (isForgot) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password`,
      })
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
      setSuccessMsg(
        'Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha.',
      )
      setLoading(false)
      return
    }
```
Nota: usamos `window.location.origin` (client component) em vez de `getAppUrl()`
(server-only). Em produção resolve para `https://ialue.com.br`.

- [ ] **Step 3: Esconder o campo de senha no modo `forgot`**

Envolva o bloco `<div>` do campo de senha (o que contém `<Label htmlFor="password">`)
com `{!isForgot && ( ... )}`:
```tsx
            {!isForgot && (
              <div>
                <Label htmlFor="password">Senha</Label>
                <div className="relative">
                  <IconLock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="••••••••"
                    className="pl-10"
                  />
                </div>
                <div className="mt-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setView('forgot')
                      setError(null)
                      setSuccessMsg(null)
                    }}
                    className="text-xs font-medium text-brand-600 hover:text-brand-700"
                  >
                    Esqueceu a senha?
                  </button>
                </div>
              </div>
            )}
```
(O link "Esqueceu a senha?" aparece em login e signup; some no modo forgot. Aceitável.)

- [ ] **Step 4: Ajustar título, subtítulo e botão para o modo `forgot`**

Substitua o `<h1>` e o `<p>` de subtítulo:
```tsx
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            {isForgot
              ? 'Recuperar senha'
              : isSignUp
                ? 'Criar uma conta'
                : 'Bem-vindo de volta'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {isForgot
              ? 'Enviaremos um link para redefinir sua senha.'
              : isSignUp
                ? 'Configure seu acesso em 30 segundos.'
                : 'Entre para acessar seu painel.'}
          </p>
```

Substitua o conteúdo do `<Button type="submit">`:
```tsx
            <Button type="submit" disabled={loading} size="lg" className="w-full">
              {loading ? (
                isForgot ? (
                  'Enviando...'
                ) : isSignUp ? (
                  'Criando...'
                ) : (
                  'Entrando...'
                )
              ) : (
                <>
                  {isForgot
                    ? 'Enviar link'
                    : isSignUp
                      ? 'Criar conta'
                      : 'Entrar'}
                  <IconArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
```

- [ ] **Step 5: Tratar o rodapé de troca de modo no `forgot`**

Substitua o bloco `<p className="mt-5 text-center text-sm text-slate-600">` (o que
tem "Já tem uma conta?" / "Ainda não tem conta?") por:
```tsx
          <p className="mt-5 text-center text-sm text-slate-600">
            {isForgot ? (
              <>
                Lembrou a senha?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setView('login')
                    setError(null)
                    setSuccessMsg(null)
                  }}
                  className="font-semibold text-brand-600 transition-colors hover:text-brand-700"
                >
                  Voltar ao login
                </button>
              </>
            ) : (
              <>
                {isSignUp ? 'Já tem uma conta?' : 'Ainda não tem conta?'}{' '}
                <button
                  type="button"
                  onClick={() => {
                    setView(isSignUp ? 'login' : 'signup')
                    setError(null)
                    setSuccessMsg(null)
                  }}
                  className="font-semibold text-brand-600 transition-colors hover:text-brand-700"
                >
                  {isSignUp ? 'Fazer login' : 'Criar conta'}
                </button>
              </>
            )}
          </p>
```

- [ ] **Step 6: Verificar type-check e lint**

Run:
```bash
npx tsc --noEmit && npx eslint src/app/login/page.tsx
```
Expected: sem erros. (Não deve sobrar referência a `setIsSignUp` — todas viraram `setView`.)

- [ ] **Step 7: Rodar a suíte de testes inteira**

Run:
```bash
npm test
```
Expected: todos os testes passam (incluindo os 3 novos arquivos de e-mail).

- [ ] **Step 8: Commit**

```bash
git add src/app/login/page.tsx
git commit -m "feat(auth): modo 'esqueceu a senha' na tela de login"
```

---

## Task 11: Setup de infra (manual) e teste ponta a ponta

**Files:** nenhum (configuração externa + verificação).

Esta task não tem código — são os passos manuais para o fluxo funcionar de verdade.
Marque cada item ao concluir.

- [ ] **Step 1: Verificar domínio no Resend**

No dashboard do Resend → Domains → Add Domain → `ialue.com.br`. Adicionar no DNS
os registros gerados (DKIM, SPF, e MX da região). Aguardar verificação.
Enquanto não verifica, seguir com `EMAIL_FROM=onboarding@resend.dev` (só entrega
pro e-mail da própria conta Resend).

- [ ] **Step 2: Pegar a API key do Resend**

Resend → API Keys → criar key. Guardar para o env (`RESEND_API_KEY`).

- [ ] **Step 3: Configurar o Send Email Hook no Supabase**

Supabase Dashboard → Authentication → Hooks → **Send Email Hook** →
- URL: `https://ialue.com.br/api/auth/send-email` (produção) ou a URL do túnel (dev)
- Habilitar e copiar o **secret** gerado (formato `v1,whsec_...`) →
  `SEND_EMAIL_HOOK_SECRET`.

- [ ] **Step 4: Preencher os envs reais**

Em produção (Vercel) e onde mais o app rodar, setar:
- `RESEND_API_KEY` = a key do Step 2
- `SEND_EMAIL_HOOK_SECRET` = o secret do Step 3
- `EMAIL_FROM` = `onboarding@resend.dev` (teste) ou `LUE <nao-responda@ialue.com.br>` (pós-verificação)

- [ ] **Step 5: Teste local com túnel**

```bash
npm run dev
```
Em outro terminal:
```bash
cloudflared tunnel --url http://localhost:3000
```
Apontar o Hook (Step 3) temporariamente para a URL pública do túnel. Garantir que
`Site URL` no Supabase (Authentication → URL Configuration) também aponte para a URL
do túnel durante o teste local, para os links do e-mail baterem no app certo.

- [ ] **Step 6: Teste manual — confirmação de cadastro**

1. Abrir `/login`, modo "Criar conta", cadastrar um e-mail (o da conta Resend, se
   ainda em `onboarding@resend.dev`).
2. Conferir que chega o e-mail branded "Confirme seu cadastro na LUE".
3. Clicar no botão → cair em `/auth/confirm` → redirecionar logado para `/painel`.

- [ ] **Step 7: Teste manual — esqueceu a senha**

1. Em `/login`, clicar "Esqueceu a senha?", informar o e-mail, enviar.
2. Conferir mensagem de sucesso genérica.
3. Conferir o e-mail "Redefina sua senha da LUE".
4. Clicar → cair em `/reset-password` → definir nova senha → logar.
5. Deslogar e confirmar login com a nova senha.

- [ ] **Step 8: Teste manual — caminhos de erro**

1. Abrir um link de confirmação já usado/expirado → cai em `/auth/auth-code-error`.
2. (Opcional) POST manual em `/api/auth/send-email` sem assinatura válida →
   responde `401`.

- [ ] **Step 9: Reverter URLs de teste**

Após validar local, reapontar o Send Email Hook e o Site URL do Supabase de volta
para produção (`https://ialue.com.br`).

---

## Self-review (preenchido)

- **Cobertura do spec:** confirmação (Task 3/6/7), reset (Task 3/6/7/9), endpoint do
  hook (Task 6), `/auth/confirm` (Task 7), tela de erro (Task 8), link "esqueceu a
  senha" (Task 10), templates branded (Task 2/3), deps+env (Task 1), client Resend
  (Task 5), setup de infra + testes (Task 11). ✔ Todos os componentes do spec têm task.
- **Sem placeholders:** todo passo de código mostra o código completo. ✔
- **Consistência de tipos:** `EmailTemplate.render(actionUrl)` usado igual em
  templates.ts, hook.ts e na route; `HookEmailData` casa com o subset lido na route;
  `nextFor`/`pickTemplate`/`buildActionUrl` com as mesmas assinaturas em teste e impl. ✔
- **Incertezas sinalizadas:** prefixo do secret (`v1,` vs `v1,whsec_`) marcado na
  Task 6; verificação de domínio Resend tratada com fallback. ✔
