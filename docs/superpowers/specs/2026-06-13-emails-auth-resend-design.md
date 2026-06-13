# E-mails de auth via Resend — confirmação de cadastro + reset de senha

**Data:** 2026-06-13
**Status:** Design aprovado, aguardando plano de implementação

## Objetivo

Personalizar e assumir o controle de dois e-mails de autenticação, enviando-os
pelo **Resend** com templates branded LUE em PT-BR:

1. **Confirmação de cadastro** (o que o usuário chama de "confirmar login") —
   disparado no `signUp()` da tela de login. Hoje usa o template/infra padrão do
   Supabase (visual genérico, rate limit ~2-3/h).
2. **Redefinição de senha** ("esqueceu a senha") — **não existe hoje**: não há
   link na tela de login, nem `resetPasswordForEmail`, nem página de redefinição.
   Será construído do zero.

> Nota de nomenclatura: não há e-mail "a cada login". `signInWithPassword` não
> dispara e-mail. O e-mail de "confirmar login" é o de **confirmação de cadastro**
> (primeiro acesso).

## Decisões já tomadas

| Decisão | Valor |
|---|---|
| Integração Resend × Supabase | **Send Email Hook** (Supabase gera o token e faz POST no nosso endpoint, que renderiza + envia via Resend) |
| Templates | Branded LUE (HTML PT-BR no visual da marca: wordmark, roxo brand, botão de ação) |
| Estado da conta Resend | Conta existe; **domínio ainda não verificado** → plano inclui verificação de DNS + fallback `onboarding@resend.dev` para testes |
| Fluxo de confirmação/reset | Link → route `/auth/confirm` → `verifyOtp({ token_hash, type })` (padrão SSR/PKCE) |

Por que Send Email Hook (e não SMTP custom nem fluxo 100% manual): mantém o token
sob controle do Supabase (seguro), cobre todos os e-mails de auth num único
endpoint, e quase não altera o código do client (`signUp` / `resetPasswordForEmail`
continuam iguais). Templates ficam 100% sob nosso controle (HTML arbitrário),
diferente do editor limitado do SMTP custom.

## O que já existe (não mexer, reaproveitar)

- `createAdminClient()` (service role) — `src/lib/supabase/admin.ts`
- `createClient()` SSR (cookies) — `src/lib/supabase/server.ts` e `.../client.ts`
- `getAppUrl()` — `src/lib/app-url.ts` (produção = `https://ialue.com.br`)
- `src/app/login/page.tsx` — já tem estados de `error`/`successMsg` e a mensagem
  "Conta criada! Verifique seu email para confirmar"
- Wordmark / paleta brand (roxo) usados no login — base visual dos templates

## Arquitetura

```
signUp() / resetPasswordForEmail()        ← client, praticamente inalterado
        │
        ▼
Supabase gera token + token_hash
        │  POST assinado (Standard Webhooks)
        ▼
/api/auth/send-email                       ← API route (Hook handler)
   • verifica assinatura (lib standardwebhooks)
   • lê email_action_type → escolhe template
   • monta link: {SiteURL}/auth/confirm?token_hash=…&type=…&next=…
   • Resend.emails.send({ from, to, subject, html })
        │
        ▼
e-mail branded LUE na caixa do usuário
        │ clica no botão
        ▼
/auth/confirm                              ← route handler
   • verifyOtp({ token_hash, type }) estabelece a sessão (cookies)
   • signup   → redirect /painel (middleware decide owner/agent)
   • recovery → redirect /reset-password
```

## Componentes novos

| Arquivo | Papel |
|---|---|
| `src/lib/resend.ts` | Instancia `new Resend(process.env.RESEND_API_KEY)` |
| `src/lib/emails/layout.ts` | Shell HTML branded reutilizável (wordmark LUE, roxo brand, botão CTA, footer). Recebe `{ title, bodyHtml, ctaLabel, ctaUrl }` |
| `src/lib/emails/confirm-signup.ts` | Retorna `{ subject, html }` da confirmação de cadastro |
| `src/lib/emails/reset-password.ts` | Retorna `{ subject, html }` do reset de senha |
| `src/app/api/auth/send-email/route.ts` | Endpoint do Hook: verifica assinatura, roteia por `email_action_type`, envia via Resend |
| `src/app/auth/confirm/route.ts` | `verifyOtp({ token_hash, type })` + redirect por tipo |
| `src/app/auth/auth-code-error/page.tsx` | Tela "link inválido ou expirado" |
| `src/app/reset-password/page.tsx` | Form "nova senha" (client) → `updateUser({ password })` → redirect login/painel |

## Componentes modificados

- **`src/app/login/page.tsx`** — adiciona link **"Esqueceu a senha?"** que entra
  num modo inline (reusa o form/estados existentes) e chama
  `resetPasswordForEmail(email, { redirectTo: `${getAppUrl()}/auth/confirm?next=/reset-password` })`.
  Feedback de sucesso via o `successMsg` que já existe.
- **`package.json`** — adiciona `resend` e `standardwebhooks`.
- **Env** (`.env.local` + Vercel/EasyPanel) — `RESEND_API_KEY`,
  `SEND_EMAIL_HOOK_SECRET`, `EMAIL_FROM`.

## Contratos dos módulos

### `src/app/api/auth/send-email/route.ts`

```ts
export async function POST(req: Request) {
  const payload = await req.text()                 // RAW body (assinatura)
  const headers = Object.fromEntries(req.headers)
  const secret = process.env.SEND_EMAIL_HOOK_SECRET! // formato "v1,whsec_…"

  let data
  try {
    const wh = new Webhook(secret.replace('v1,', '')) // ver nota de incerteza
    data = wh.verify(payload, headers) as SendEmailPayload
  } catch {
    return Response.json(
      { error: { http_code: 401, message: 'Assinatura inválida.' } },
      { status: 401 },
    )
  }

  const { user, email_data } = data
  const tpl = pickTemplate(email_data)             // signup | recovery | genérico
  const actionUrl =
    `${email_data.site_url}/auth/confirm` +
    `?token_hash=${email_data.token_hash}` +
    `&type=${email_data.email_action_type}` +
    `&next=${encodeURIComponent(nextFor(email_data.email_action_type))}`

  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM!,                 // "LUE <nao-responda@ialue.com.br>"
    to: [user.email],
    subject: tpl.subject,
    html: tpl.render(actionUrl),
  })
  if (error) {
    console.error('send-email hook resend error', error)
    return Response.json(
      { error: { http_code: 500, message: 'Falha ao enviar o e-mail.' } },
      { status: 500 },
    )
  }
  return Response.json({})
}
```

- `nextFor('recovery') = '/reset-password'`; `nextFor('signup') = '/painel'`.
- `email_action_type` não tratado (magiclink, invite, email_change) → template
  genérico simples, pra nenhum e-mail de auth ficar sem envio.

Payload (verificado na doc do Supabase):

```jsonc
{
  "user": { "email": "...", /* … */ },
  "email_data": {
    "token": "305805",
    "token_hash": "7d5b…",
    "redirect_to": "http://localhost:3000/",
    "email_action_type": "signup",      // signup | recovery | magiclink | invite | email_change | …
    "site_url": "https://ialue.com.br",
    "token_new": "",
    "token_hash_new": ""
  }
}
```

### `src/app/auth/confirm/route.ts`

```ts
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/painel'

  if (token_hash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error) return NextResponse.redirect(new URL(next, request.url))
  }
  return NextResponse.redirect(new URL('/auth/auth-code-error', request.url))
}
```

`type=recovery` estabelece a sessão e o usuário cai em `/reset-password` já
autenticado, podendo chamar `updateUser({ password })`.

### `src/app/reset-password/page.tsx` (client)

- Campos "Nova senha" + "Confirmar senha" (mesmos componentes `Input`/`Button`/`Label`).
- Submit → `supabase.auth.updateUser({ password })` → sucesso → `router.push('/painel')`.
- Se não houver sessão (acesso direto sem vir do link) → mensagem orientando a
  refazer o "esqueceu a senha".

### Templates (`src/lib/emails/*`)

`layout.ts` exporta `renderEmail({ title, bodyHtml, ctaLabel, ctaUrl }): string`
— HTML com tabela inline (compat com clientes de e-mail), wordmark LUE, botão roxo
brand, footer "© 2026 LUE". `confirm-signup.ts` e `reset-password.ts` exportam
`{ subject, render(actionUrl) }`.

## Tratamento de erro

| Situação | Comportamento |
|---|---|
| Assinatura do Hook inválida | `401` `{ error: { http_code, message } }` (Supabase repassa msg ao usuário) |
| Resend falha no envio | Loga + `500` descritivo (não fingir sucesso — mesma filosofia do commit "não engolir erro do aceite") |
| `email_action_type` não tratado | Template genérico simples, envia mesmo assim |
| Token inválido/expirado em `/auth/confirm` | Redirect `/auth/auth-code-error` |
| `/reset-password` sem sessão | Mensagem pra refazer o fluxo de "esqueceu a senha" |

## Setup de infra (parte manual, fora do código)

1. **Resend:** Domains → Add Domain (`ialue.com.br`) → adicionar DKIM/SPF/MX no
   DNS → aguardar verificação. Pegar `RESEND_API_KEY`. Enquanto o DNS não propaga,
   testar com `EMAIL_FROM=onboarding@resend.dev` (limitação: só envia para o
   próprio e-mail da conta Resend; outros destinatários → 403).
2. **Supabase Dashboard:** Authentication → Hooks → **Send Email Hook** →
   URL `https://ialue.com.br/api/auth/send-email` → copiar o secret (`v1,whsec_…`)
   para `SEND_EMAIL_HOOK_SECRET`.
3. **Env nos ambientes:** `RESEND_API_KEY`, `SEND_EMAIL_HOOK_SECRET`, `EMAIL_FROM`
   no `.env.local`, na Vercel (produção) e onde mais o app rodar.

## Teste local

O Send Email Hook precisa de URL pública; `localhost:3000` não é alcançável pelo
Supabase. Para o ciclo ponta-a-ponta:

- **Túnel:** `cloudflared tunnel --url http://localhost:3000` (ou ngrok) e apontar
  o Hook temporariamente para a URL pública gerada.
- Alternativa só para ver o HTML renderizado: rota de preview local que chama
  `render(actionUrl)` e devolve o HTML no browser (sem Supabase).

## Testes

**Unit (vitest):**
- `pickTemplate` roteia `signup`→confirm, `recovery`→reset, desconhecido→genérico.
- Construção do `actionUrl` (token_hash, type, next corretos e encodados).
- `render()` de cada template inclui o subject e o `actionUrl` no HTML.

**Manual:**
1. Cadastro novo → recebe e-mail branded → clica → cai logado no painel.
2. "Esqueceu a senha" na tela de login → recebe e-mail → clica → define nova
   senha → loga.
3. Link expirado/adulterado → `/auth/auth-code-error`.
4. POST no Hook com assinatura inválida → `401`.

## Arquivos afetados (resumo)

**Novos:**
- `src/lib/resend.ts`
- `src/lib/emails/layout.ts`
- `src/lib/emails/confirm-signup.ts`
- `src/lib/emails/reset-password.ts`
- `src/app/api/auth/send-email/route.ts`
- `src/app/auth/confirm/route.ts`
- `src/app/auth/auth-code-error/page.tsx`
- `src/app/reset-password/page.tsx`

**Modificados:**
- `src/app/login/page.tsx` (link + modo "esqueceu a senha")
- `package.json` (`resend`, `standardwebhooks`)
- `.env.local` (+ Vercel/EasyPanel)

## Out of scope (não fazer agora)

- E-mails de magic link, troca de e-mail e convite de vendedor via Resend (o Hook
  já cobre com template genérico; personalização fica para depois).
- Migrar o e-mail de convite de vendedor (hoje cria user com `email_confirm: true`,
  sem e-mail) para Resend.
- React Email / MJML para os templates — começamos com HTML inline simples.
- Verificação de e-mail obrigatória antes de qualquer login (regra de gating).

## Pontos de incerteza a resolver na implementação

- Prefixo exato a remover do `SEND_EMAIL_HOOK_SECRET` (`v1,` vs `v1,whsec_`) pode
  variar conforme a versão da lib `standardwebhooks` — validar empiricamente se a
  verificação falhar.
- `AGENTS.md` avisa que esta versão do Next.js (16) tem APIs não-padrão →
  conferir `node_modules/next/dist/docs` para route handlers antes de codar.
