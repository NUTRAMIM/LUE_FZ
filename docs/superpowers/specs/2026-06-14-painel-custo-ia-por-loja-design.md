# Design — Custo de IA por loja no painel de admin

**Data:** 2026-06-14
**Autor:** sessão de otimização de custos
**Status:** aprovado (design) — aguardando revisão da spec

## Contexto

O chat-service grava consumo de tokens em `ai_usage_daily`. Após o trabalho de
otimização, a tabela passou a ter granularidade por **(loja, dia, modelo)** com
coluna **`cached_tokens`** (migration `2026-06-14_ai_usage_per_model.sql`, já
aplicada). Já existe a página de admin **`/painel/_internal`** ("Admin ·
Plataforma"), gated por `isPlatformAdmin`, que mostra **tokens e chamadas por
loja** com cards + tabela + seletor de período (dia/semana/mês), lendo via
service-role e agregando em TS (`src/lib/admin-usage.ts`).

Falta nessa página o que o operador realmente quer ver: **custo em dinheiro** e
**atividade da IA** (mensagens/atendimentos) por loja.

## Objetivo

Estender a página `/painel/_internal` para mostrar, por loja e no período
selecionado, além dos tokens já existentes:

1. **Custo em R$** (e USD), calculado com preço por modelo + desconto real de cache.
2. **Mensagens da IA + atendimentos**.
3. **Custo por atendimento** (média).
4. **% cacheado** (efeito do cache).

## Fora de escopo (YAGNI)

- Câmbio dinâmico/API de cotação — taxa fixa no código (decisão do usuário).
- Página nova ou visão por dono de loja — é a página de operador existente.
- Gráficos/séries temporais — só cards + tabela, como já é.
- Persistir custo no banco — calculado on-read.

## Arquitetura

Abordagem escolhida: **estender a lib TS `admin-usage.ts`** (segue o padrão da
página, mantém o seletor de período, concentra preço/custo num módulo testável).
Alternativas descartadas: ler da view `vw_custo_por_loja` (é all-time, não casa
com o período) e função SQL/RPC (foge do padrão TS, mais coisa pra manter).

### 1. Camada de dados — `src/lib/admin-usage.ts`

- `UsageRow` ganha `model: string` e `cached_tokens: number`.
- Constante de preços USD/1M por modelo (espelha o Python):
  - `gpt-5-mini`: in 0.25 · cached 0.025 · out 2.00
  - `gpt-5-nano`: in 0.05 · cached 0.005 · out 0.40
  - `text-embedding-3-small`: in 0.02 · cached 0.02 · out 0.0
  - fallback (modelo desconhecido/legado): preços do `gpt-5-mini`
- `USD_BRL = 5.5` (constante editável, comentada).
- Custo por linha: `((prompt - cached)·in + cached·cached + completion·out) / 1e6`.
- `StoreUsage` e `UsageTotals` ganham: `costUsd`, `cached`, `iaMessages`,
  `attendances`, e derivados `cachedPct` (cached/prompt) e
  `costPerAttendanceUsd` (costUsd/attendances, 0 quando attendances=0).
- `aggregateByStore` passa a receber também os mapas de contagem
  (mensagens da IA e atendimentos por store_id) e a somar custo/cache.
- Helpers de formatação de dinheiro (USD e BRL) podem ficar na página ou na lib.

### 2. Query da página — `/painel/_internal/page.tsx`

- Acrescenta `model, cached_tokens` no `select` de `ai_usage_daily`.
- Duas leituras novas via admin client, no mesmo período (início alinhado ao
  fuso de São Paulo, como já é feito para `day`):
  - `messages`: `role = 'assistant'` e `created_at >= inícioDoPeríodo`,
    agrupado por `store_id` → **mensagens da IA**.
  - atendimentos: `COUNT(DISTINCT conversation_id)` de `messages` com atividade
    no período por `store_id` (conversas que a IA tocou). Pode ser obtido na
    mesma leitura de `messages` (distinct em TS) para evitar uma query extra.
- Passa os mapas de contagem para `aggregateByStore`.

### 3. UI (mesma página, mesmos componentes)

- **Cards (topo):** **Custo (R$)** (dica em USD) · **Atendimentos** ·
  **Mensagens IA** · **% cacheado**. Tokens/Chamadas deixam de ocupar card de
  destaque (viram detalhe na tabela/hint).
- **Tabela por loja** (ordenada por custo desc), colunas enxutas:
  `Loja · Atendimentos · Msgs IA · Tokens · % cache · Custo (R$) · Custo/atend`.
  Prompt/Completion separados saem da tabela.
- Mantém `EmptyState` quando não há consumo e o tratamento de erro atuais.

### 4. Testes

- Unitários em `admin-usage` (Vitest, padrão do repo) cobrindo:
  - custo por modelo (mini/nano) com e sem cache;
  - fallback de modelo desconhecido → preço mini;
  - `cachedPct` e `costPerAttendanceUsd` (incl. divisão por zero);
  - agregação por loja somando custo/cache e juntando contagens de
    mensagens/atendimentos.

## Premissas e riscos

- **Next.js 16.2.4** (versão modificada): seguir EXATAMENTE os padrões da página
  atual (server component async, `searchParams` Promise, `force-dynamic`, gate
  `isPlatformAdmin`, `createAdminClient`). Conferir `node_modules/next/dist/docs`
  antes de qualquer padrão novo — mas o trabalho é extensão, sem padrão novo.
- **Dados legados** (`model='desconhecido'`, `cached=0`) caem no preço mini sem
  cache → custo é teto até o chat-service novo ser redeployado.
- **Preço/câmbio fixos no código** — exigem edição+deploy quando mudarem.
- **Custo de leitura de `messages`**: filtrar por `created_at >= início` e
  `store_id`; hoje a tabela é pequena. Se crescer, considerar índice
  `(store_id, created_at)` — fora de escopo agora.
- Boundary de fuso: alinhar o início do período em SP para mensagens, igual aos
  tokens, evitando contagem deslocada por algumas horas.
