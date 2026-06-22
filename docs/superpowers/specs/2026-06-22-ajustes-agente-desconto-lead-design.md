# Ajustes no agente: desconto de atacado no `valor_total` + WhatsApp obrigatório

Data: 2026-06-22
Serviço: `chat-service` (agente Python) + `supabase` (migration) + painel Next.js (`src/app/loja`)

## Problema

1. **Desconto não persiste.** Quando a loja tem desconto de atacado, o agente
   *menciona* o desconto na conversa, mas o `valor_total` gravado em `leads` é
   sempre a soma bruta `preço × qtd` — o desconto nunca é aplicado ao valor que
   sobe pro banco. Quem fecha o pedido vê o valor cheio.

2. **WhatsApp opcional.** Hoje nome e telefone são extraídos de forma oportunista
   (`branches/lead.py`), e nada impede o agente de dar o pedido por fechado sem o
   número do cliente.

## Decisões (validadas com o usuário)

- **Quando aplicar o desconto:** somente quando o pedido **atinge o mínimo de
  atacado** configurado (`min_order_quantity` / `min_order_value`, respeitando
  `min_order_logic`: `"all"` = E, `"any"` = OU). Se a loja tem desconto mas não
  configurou mínimo, aplica sempre (não há barreira).
- **Tipos calculáveis** (`percent_piece`, `percent_order`, `fixed_piece`): o
  sistema calcula de forma determinística, no código.
- **Tipo `custom`** (texto livre por faixas): a LLM calcula o total já com
  desconto e passa via tool; o código grava o que a LLM mandou (com fallback
  seguro pro bruto se não vier valor válido).
- **Rastreabilidade:** gravar `valor_bruto`, `valor_total` (líquido) e
  `desconto_aplicado` (migration nova).
- **WhatsApp obrigatório:** em **todas as lojas** (varejo e atacado), reforçado
  **via prompt** (sem gate de código).

## Parte A — Desconto no `valor_total`

### A1. Schema (migration `049_leads_order_discount_fields.sql`)

Adicionar à tabela `leads`:

```sql
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS valor_bruto       NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS desconto_aplicado NUMERIC(10, 2);
```

- `valor_bruto`: soma `preço × qtd` (sem desconto).
- `valor_total`: passa a ser o **líquido** (com desconto aplicado).
- `desconto_aplicado`: `valor_bruto − valor_total` (≥ 0). `0`/`NULL` quando não há
  desconto ou o mínimo não foi atingido.

Idempotente (`IF NOT EXISTS`), no padrão das outras migrations.

### A2. Cálculo do mínimo atingido — `minimo_atacado_atingido(store, itens)`

Nova função em `chat-service/app/agent/tools.py`:

- Conta `qtd_total = Σ qtd` e usa o `valor_bruto` já calculado.
- `cond_qtd = min_order_quantity is None or qtd_total >= min_order_quantity`
- `cond_val = min_order_value is None or valor_bruto >= min_order_value`
- `min_order_logic == "all"` → `cond_qtd AND cond_val`; senão → `cond_qtd OR cond_val`.
- Se nenhum mínimo configurado (ambos `None`) → `True`.

### A3. Aplicação do desconto — `aplicar_desconto(valor_bruto, store, itens, valor_com_desconto=None)`

Retorna `(valor_liquido, desconto_aplicado)`:

1. Sem desconto configurado (`discount_type` vazio) → `(valor_bruto, 0)`.
2. Mínimo não atingido (A2) → `(valor_bruto, 0)`.
3. Por tipo:
   - `percent_piece` / `percent_order`: `liquido = round(valor_bruto * (1 - dv/100), 2)`
     (matematicamente idênticos no total).
   - `fixed_piece`: `liquido = round(valor_bruto - dv * qtd_total, 2)`, com piso 0.
   - `custom`: se `valor_com_desconto` veio e é válido
     (`0 < valor_com_desconto <= valor_bruto`), usa-o; senão `valor_bruto`
     (fallback seguro). `desconto = round(valor_bruto - liquido, 2)`.

### A4. Tool `REGISTRAR_PEDIDO` (schema em `runner.py`)

Adicionar parâmetro opcional:

```python
"valor_com_desconto": {"type": "number"},
```

Descrição estendida da tool: *"Quando a regra de desconto da loja for por faixa
ou condicional (texto livre — ex.: '5% acima de 20 peças'), calcule o total já
com o desconto e preencha `valor_com_desconto`. Para descontos simples
(percentual fixo / valor por peça) NÃO preencha — o sistema calcula sozinho."*

`runner.py` repassa `args.get("valor_com_desconto")` para `registrar_pedido`.

### A5. `registrar_pedido` (assinatura)

De:
```python
async def registrar_pedido(db, store_id, conversation_id, itens,
                           forma_pagamento, forma_entrega) -> str:
```
Para:
```python
async def registrar_pedido(db, store, conversation_id, itens,
                           forma_pagamento, forma_entrega,
                           valor_com_desconto=None) -> str:
```

- Recebe o objeto `store` (StoreSettings) em vez de `store_id` — `store.id`
  internamente. (`runner.py` já tem `store` em mãos.)
- Fluxo: normaliza → completa preços → `valor_bruto = calcular_valor_total(norm)`
  → `(liquido, desconto) = aplicar_desconto(...)` → `upsert_lead_order(...)` com
  `valor_total=liquido, valor_bruto=valor_bruto, desconto_aplicado=desconto`.
- Retorno pro agente: `"Total: R$ X (já com desconto de atacado)"` quando
  `desconto > 0`; senão `"Total: R$ X"`.

### A6. `upsert_lead_order` (`db.py`)

Estender INSERT/UPDATE para gravar `valor_bruto` e `desconto_aplicado` junto com
`valor_total`.

### A7. Painel (`src/app/loja` / leitura de leads)

Exibir, onde o pedido/valor do lead aparece, o líquido com indicação do desconto
(ex.: `R$ 180,00 · bruto R$ 200,00 · desconto R$ 20,00`). Ajustar o(s) tipo(s) em
`src/types/database.ts` para as novas colunas.

## Parte B — WhatsApp obrigatório (via prompt)

Ajustar a seção "Lead (captura + fechamento)" do `STATIC_PROMPT`
(`chat-service/app/agent/prompt.py`, ~linhas 94-107):

- O **WhatsApp do cliente é obrigatório** para dar o pedido por fechado /
  encaminhar pra loja.
- O agente **não finaliza nem encaminha** sem o número; se o cliente não passar,
  pede de novo de forma leve, explicando que é por onde a loja confirma o pedido
  e combina a entrega.
- Vale para **todas as lojas** (varejo e atacado).

`build_dynamic_state` já marca "WhatsApp: (não capturado)" — o prompt passa a
tratar esse item como bloqueador do fechamento.

## Testes (TDD)

`chat-service/tests/`:

- `test_tools.py`:
  - `minimo_atacado_atingido`: lógica `all`/`any`, qtd, valor, sem mínimo.
  - `aplicar_desconto`: cada tipo; mínimo não atingido → bruto; `fixed_piece`
    com piso 0; `custom` com/sem `valor_com_desconto` válido/ inválido.
  - `registrar_pedido`: grava líquido + bruto + desconto; sem desconto grava
    bruto = líquido; respeita mínimo.
- `test_prompt.py`: prompt contém a obrigatoriedade do WhatsApp pra fechar.
- `test_runner.py`: `REGISTRAR_PEDIDO` roteia `valor_com_desconto`.
- Atualizar chamadas existentes de `registrar_pedido(db, "store-1", ...)` para a
  nova assinatura (objeto `store`).

## Fora de escopo

- Estruturar o desconto `custom` em faixas no painel (decidido: LLM calcula).
- Gate rígido de código para o WhatsApp (decidido: só prompt).
- Recálculo retroativo de pedidos antigos.
```