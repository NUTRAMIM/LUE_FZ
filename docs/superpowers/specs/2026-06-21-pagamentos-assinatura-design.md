# Design — Finalização de Pagamentos / Assinatura (Stripe + Mercado Pago)

**Data:** 2026-06-21
**Status:** Aprovado (design) — pendente de escrita do plano de implementação
**Projeto:** LUE FZ (SaaS de atendimento por IA para e-commerce — Next.js + Supabase)

---

## 1. Objetivo

Completar a integração de pagamentos para que a assinatura funcione 100% com:
- **PIX (Mercado Pago)** — pagamento avulso, 1 cobrança por compra (sem renovação automática).
- **Cartão de crédito (Stripe)** — assinatura recorrente via Checkout hosted + Customer Portal.

A base já existe e é funcional; este trabalho **completa os gaps**, não reconstrói.

> **Restrição do usuário:** nenhum commit até estar 100% funcional e aprovado.

---

## 2. Estado atual (inventário)

Já implementado e funcional:
- **Stripe**: cliente (`src/lib/stripe.ts`), checkout `mode=subscription` (`src/actions/billing.ts`), webhook com 5 eventos e validação de assinatura (`src/app/api/stripe/webhook/route.ts`), Customer Portal action (existe, mas botão desabilitado).
- **Mercado Pago**: cliente (`src/lib/mercadopago.ts`), pagamento PIX avulso + QR (`src/app/api/mercadopago/pix/route.ts`), webhook com validação HMAC `x-signature` (`src/app/api/mercadopago/webhook/route.ts`).
- **Banco**: `store_subscriptions` (1 por loja, RLS, status machine) e `payment_events` (idempotência por PK) — `supabase/migrations/029_store_subscriptions.sql`.
- **UI**: `/planos` (checkout público) e `/painel/planos` (status + barra de uso; botões de gestão desabilitados).
- **Gating**: `getCurrentSubscription()` valida `active` + `current_period_end`; middleware tem gate desligado (`BILLING_GATED = []`).
- **Admin**: grant/revoke manual (`src/actions/admin-subscription.ts`).

Gaps a fechar:
1. Planos de teste (só `pro` a R$ 2,00) — não há planos reais ligados ao checkout.
2. Gate desligado.
3. Botões de gestão desabilitados (Portal, Cancelar, Upgrade/downgrade, toggle de ciclo).
4. PIX não suporta ciclo trimestral.
5. Webhook MP pula validação quando secret = `placeholder` (risco em produção).
6. Sem `.env.example`.

---

## 3. Decisões de produto (fechadas)

| Tema | Decisão |
|------|---------|
| **PIX (MP)** | Avulso — 1 pagamento por compra. Sem renovação automática nem "Pix Automático". |
| **Cartão (Stripe)** | Mantém Checkout hosted (`mode=subscription`) + Customer Portal. |
| **Planos** | 3 planos: **R$ 289 / R$ 319 / R$ 419** (mensal). Nomes herdados da UI atual (Essencial / Profissional / Performance). |
| **Limites por plano** | A definir pelo usuário (placeholder até lá). |
| **Ciclos** | Mensal e **trimestral com desconto**. Valores trimestrais a definir pelo usuário. |
| **Gate** | Suave (sem redirect): usuário entra no painel, mas **todas as funcionalidades operacionais ficam bloqueadas** com CTA "assine para liberar" enquanto não houver assinatura ativa. |
| **Trial** | Não há trial. |
| **Localização do código** | Tudo no Next.js (completar o existente; não migrar para Python). |

### Funcionalidades bloqueadas pelo gate (sem assinatura ativa)
Todas as ações operacionais centrais:
- IA atender clientes no chat (público/embed).
- Publicar/ativar a loja (embed/canais).
- Adicionar/ativar agentes (equipe).
- Importar/publicar estoque.

O dono **entra** no painel e vê a estrutura, mas as mutations/ações-fim exigem assinatura ativa.

---

## 4. Arquitetura

### 4.1 Catálogo de planos — fonte única de verdade (server-side)
`src/lib/plans.ts` passa a conter os 3 planos × 2 ciclos:

```
PLANS = {
  essencial:   { name, limits, monthly:  { price_brl, stripe_price_id, duration_days: 30 },
                                 quarterly:{ price_brl, stripe_price_id, duration_days: 90 } },
  profissional:{ ... },
  performance: { ... },
}
```

- O **frontend envia apenas `plan_id` + `cycle`** (`monthly`/`quarterly`); nunca o valor.
- O servidor resolve `plan_id`+`cycle` → preço real (Stripe Price ID; valor PIX). Slug/ciclo desconhecido é rejeitado.
- Valores trimestrais e limites entram como **placeholders explícitos** até o usuário fornecer.

### 4.2 Stripe (cartão)
- Criar **Products + 6 Prices** (3 planos × mensal/trimestral) no Stripe — via dashboard ou API com as chaves do usuário (fase 1).
- `createCheckoutSession(planId, cycle)`: resolve Price ID no servidor, cria/reusa Customer com `metadata.store_id`, passa `client_reference_id` + `metadata` (store_id, plan_id, cycle), idempotency key.
- Provisão de acesso **somente via webhook** (não pelo redirect de sucesso).

### 4.3 Mercado Pago (PIX)
- `POST /api/mercadopago/pix` aceita `plan_id` + `cycle`; valor resolvido no servidor.
- Trimestral = cobra o valor do trimestre de uma vez e libera **90 dias** (`current_period_end = now + duration_days`).
- Mantém QR + copia-e-cola + polling atual.
- Confirmação via webhook `payment` `approved` (com reconsulta na API).

### 4.4 Gating
- Helper central `requireActiveSubscription(storeId)` (server-side) — usado nas server actions/rotas das funcionalidades-chave.
- Fonte de verdade: `status === 'active' && (current_period_end == null || current_period_end > now())`.
- UI: estado bloqueado com CTA "assine para liberar" nas áreas operacionais.
- A IA atendendo no chat público/embed checa assinatura ativa da loja antes de responder.
- **Sem redirect forçado** no middleware (mantém `BILLING_GATED` vazio); o bloqueio é por ação/funcionalidade.

### 4.5 Gestão de assinatura
- **Portal Stripe**: ligar botão "Gerenciar pagamento" → `createPortalSession()` (trocar cartão, faturas, cancelar). Só para quem pagou via cartão.
- **Cancelar**: Stripe via Portal/API → webhook atualiza status. PIX: não renova (expira em `current_period_end`).
- **Upgrade/downgrade**: Stripe com proration automática; PIX é nova compra.
- **Toggle mensal/trimestral**: troca o Price ID (Stripe) / valor+duração (PIX) de fato.

---

## 5. Modelo de dados

`store_subscriptions` e `payment_events` já atendem. Acréscimo:
- `billing_cycle` (`monthly` | `quarterly`) em `store_subscriptions` (migration nova, aditiva).

Sem outras mudanças estruturais. RLS mantém: leitura só do dono; escrita só via service role (webhooks).

---

## 6. Segurança (itens que entram)

🔴 Críticos:
- Remover o **bypass de validação do webhook MP** quando secret = `placeholder`.
- Preço sempre resolvido no servidor por `plan_id`+`cycle` (front nunca envia valor).
- Ownership/tenant check antes de checkout / portal / cancelar / upgrade.
- Webhooks: raw body + verificação de assinatura + reconsulta na API do provedor + idempotência por `event_id` (já implementado — manter).
- Acesso derivado do estado real da subscription, nunca de flag manipulável.
- Secrets server-only (nunca `NEXT_PUBLIC_`); test ≠ prod.

🟡 Importantes:
- Criar `.env.example` documentando todas as envs (Stripe/MP, test vs prod).
- Idempotency keys nas criações no provedor (Stripe/MP) — MP exige `X-Idempotency-Key`.

---

## 7. Testes & verificação

- **Stripe**: Stripe CLI (`stripe listen --forward-to ...` + `stripe trigger`) para webhooks locais; cartões de teste (sucesso `4242…`, recusa `4000…9995`, 3DS `4000…3155`).
- **MP**: usuários de teste + **simulador de webhook** no painel (PIX em sandbox não fecha pagamento real — validar via simulador).
- **Unitários**: resolução de preço por `plan_id`+`cycle`; mapeamento status→acesso; `requireActiveSubscription()`.
- Verificação ponta a ponta antes de qualquer commit.

---

## 8. Fases de implementação

1. **Catálogo de planos**: `plans.ts` (3 planos × 2 ciclos, limites/valores placeholder) + criar Products/Prices no Stripe.
2. **Checkout** aceitando `plan_id`+`cycle` (Stripe + PIX); remover plano de teste R$2.
3. **Gate**: `requireActiveSubscription()` + bloqueio nas funcionalidades-chave + CTA na UI.
4. **Gestão**: Portal Stripe, Cancelar, Upgrade/downgrade, toggle mensal/trimestral.
5. **Hardening**: remover bypass do webhook MP, `.env.example`, revisar ownership.
6. **Testes** (Stripe CLI + simulador MP) e verificação ponta a ponta.

---

## 9. Pendências do usuário (não bloqueiam fases 1–3)

- Valores **trimestrais** de cada plano.
- **Limites** (mensagens/mês, nº de agentes) de cada plano.
- Criação dos Products/Prices reais no Stripe (ou autorização para gerar via API com as chaves).
- Secrets reais de produção (Stripe live + webhook secret; MP access token + webhook secret).

---

## 10. Fora de escopo (por ora)

- "Pix Automático" (débito recorrente real via PIX).
- Histórico de faturas customizado no painel (Portal Stripe já cobre faturas).
- Cupons/descontos promocionais.
- Migração do billing para o chat-service Python.
