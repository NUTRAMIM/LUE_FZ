# Exigir pedido mínimo para fechar (atacado)

Data: 2026-06-23
Áreas: painel Next.js (`src/app/loja`, `src/actions`, `src/lib`), banco
(`supabase/migrations`), agente Python (`chat-service`).

## Problema / objetivo

Hoje, no modo atacado (`min_order_enabled`), o pedido mínimo é apenas mencionado
ao cliente — o agente pode fechar abaixo do mínimo. As lojas precisam de um
controle: algumas querem **bloquear** o fechamento abaixo do mínimo; outras
querem permitir, mas que o agente **incentive** o cliente a atingir o mínimo
para ganhar o desconto de atacado.

Adicionar uma configuração por loja, **"Exigir pedido mínimo para fechar o
pedido"**, dentro da seção de atacado, que altera o comportamento do agente.

## Decisões (validadas com o usuário)

- Nova flag booleana `min_order_required`, **default `false`** (preserva o
  comportamento atual de todas as lojas).
- Só é relevante quando `min_order_enabled = true`.
- **"Perto do mínimo"** é julgado naturalmente pela IA (sem limiar configurável).
- Imposição **via prompt** (não há ação atômica de "fechar" no código; o
  fechamento é conversacional, como o WhatsApp obrigatório).
- O **desconto de atacado continua só com o mínimo atingido** (já implementado);
  esta feature não muda isso.

## Comportamento do agente

Modo atacado, com mínimo configurado:

- **`min_order_required = true` (exige):** o pedido mínimo é OBRIGATÓRIO para
  fechar. O agente não dá o pedido por fechado nem encaminha pra loja enquanto o
  mínimo não for atingido. Se o cliente quiser fechar abaixo, explica de forma
  leve que o mínimo é necessário e ajuda a completar (sugere mais peças) até
  atingir.
- **`min_order_required = false` (não exige — padrão):** o pedido mínimo NÃO
  bloqueia o fechamento — pode fechar mesmo abaixo. Mas quando o pedido estiver
  perto do mínimo, o agente avisa o cliente sobre o mínimo e sobre o desconto de
  atacado, e pergunta se ele quer adicionar mais peças para garantir o desconto.
  Não insiste se o cliente não quiser. Quem fecha abaixo não ganha desconto.

## Componentes

### 1. Migration `050_store_settings_min_order_required.sql`

```sql
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS min_order_required BOOLEAN NOT NULL DEFAULT false;
```

Idempotente, no padrão das outras migrations. Aplicada manualmente no Supabase.

### 2. Painel — `src/app/loja/LojaForm.tsx`

Dentro do collapsible de atacado (que abre com `min_order_enabled`), abaixo dos
campos de quantidade/valor/lógica, um novo toggle:

- Rótulo: **"Bloquear fechamento abaixo do mínimo"** (o toggle externo já se chama
  "Exigir pedido mínimo (atacado)" e significa apenas "ativar atacado"; este novo
  controla se o agente *impede* o fechamento abaixo do mínimo).
- Texto auxiliar: *"Se ligado, o agente só fecha quando o mínimo for atingido. Se
  desligado, fecha mesmo abaixo e avisa o cliente quando estiver perto,
  incentivando a atingir o mínimo para ganhar o desconto."*
- Estado `minOrderRequired` (default vindo de `settings?.min_order_required ?? false`).
- Incluído no payload de salvar como `min_order_required`.

### 3. Action — `src/actions/store-settings.ts`

- O payload de `saveStoreSettings` passa a aceitar `min_order_required: boolean`,
  coagido inline com `data.min_order_required === true` (mesmo padrão de
  `min_order_enabled`), e incluído no `upsert`. Sem mudança em
  `store-settings-sanitize.ts` (que cobre só faq/desconto).
- `src/types/database.ts`: coluna `min_order_required` nos blocos Row/Insert/Update
  da tabela `store_settings`.

### 4. Agente — `chat-service`

- `app/models.py`: `StoreSettings.min_order_required: bool = False`.
- `app/db.py` (`get_store_settings`): lê a coluna `min_order_required` (com
  fallback `False` se ausente, como os demais campos).
- `app/agent/prompt.py` (`_regras_atacado_block`): a linha do pedido mínimo passa
  a ser condicional conforme `store.min_order_required`, gerando uma das duas
  instruções descritas em "Comportamento do agente".

## Testes

- `chat-service/tests/test_prompt.py`:
  - `min_order_required=True` → bloco de atacado contém a obrigatoriedade
    (ex.: "OBRIGATÓRIO" e instrução de não encaminhar/fechar sem atingir).
  - `min_order_required=False` (com mínimo) → bloco contém o aviso de "perto do
    mínimo" / incentivo ao desconto, e NÃO contém a obrigatoriedade.
- `chat-service/tests/test_models.py`: `min_order_required` default `False`;
  aceitação quando setado.
- Frontend (action + LojaForm + types): coberto por typecheck (`tsc --noEmit`).
  A coerção `=== true` segue o padrão de `min_order_enabled`, que não tem teste
  unitário próprio.

## Fora de escopo

- Limiar configurável de "perto do mínimo" (decidido: IA julga).
- Gate de código para o fechamento (decidido: via prompt).
- Mudanças na lógica de desconto (já só aplica com mínimo atingido).
</content_placeholder>