# FAQ + Desconto de Atacado (loja) — Design

**Data:** 2026-05-28
**Status:** Aprovado para implementação
**Escopo:** Adicionar dois componentes à página `/loja`: (1) **Perguntas e respostas** (FAQ manual que o lojista cadastra) e (2) **Desconto de atacado** (qual é o desconto, complementando a regra de pedido mínimo já existente). Persistir em colunas dedicadas em `store_settings`.

## Motivação

Hoje a loja já tem a *regra* de atacado (pedido mínimo — `min_order_*`), mas não tem como descrever **qual é o desconto** quando esse mínimo é atingido. Além disso, não há um lugar para o lojista cadastrar perguntas e respostas próprias que o agente possa usar no atendimento.

Esta entrega adiciona os dois componentes de configuração + persistência. O **consumo** desses dados no agente de IA (injeção no prompt do `workflow-chat-agent.json`) está **fora do escopo** desta entrega — será feito depois, quando o workflow for revisado. As colunas são modeladas para serem "agent-friendly" desde já.

## Decisões (capturadas no brainstorming)

| Pergunta | Decisão |
|---|---|
| Formato do FAQ | Coluna **JSONB única** (`faq`) com pares `{ pergunta, resposta }` — atende "tudo na mesma coluna, indicando perguntas e respostas" |
| Vínculo do desconto | Fica **dentro do bloco de Pedido mínimo (atacado)**, na seção Operação |
| Seleção do tipo de desconto | **Um tipo por vez** (radio) |
| Gating do desconto | Aparece **só quando o pedido mínimo (atacado) está ligado** (atrelado ao toggle existente) |
| Consumo no agente | **Fora do escopo agora.** Apenas armazenar; injeção no prompt n8n fica para depois |
| Posicionamento do FAQ | Nova seção `04 · CONHECIMENTO`, entre Atendimento e Operação; "Operação" renumerada de `04` para `05` (rótulos são só visuais) |
| Nomes das colunas de desconto | `discount_type`, `discount_value`, `discount_custom` |
| Limites do FAQ | Máx. 30 pares; pergunta ≤ 200 chars; resposta ≤ 1000 chars |

## Schema

Migration: `supabase/migrations/033_store_settings_faq_discount.sql` (idempotente, no padrão de `010`/`032`)

```sql
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS faq             JSONB        NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS discount_type   TEXT,
  ADD COLUMN IF NOT EXISTS discount_value  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS discount_custom TEXT;

-- CHECKs adicionados via DO $$ ... pg_constraint guard (idempotente):
--   discount_type_valid:        discount_type IS NULL OR
--                               discount_type IN ('percent_piece','percent_order','fixed_piece','custom')
--   discount_value_non_negative: discount_value IS NULL OR discount_value >= 0
```

- `faq`: array de objetos `{ "pergunta": string, "resposta": string }`. Default `'[]'` garante que rows existentes não quebrem.
- `discount_type`: enum textual; `NULL` = nenhum desconto configurado.
  - `percent_piece` — % sobre o preço da peça
  - `percent_order` — % sobre o preço do pedido
  - `fixed_piece` — valor fixo (R$) por peça
  - `custom` — texto livre descrevendo o desconto
- `discount_value`: usado pelos 3 tipos numéricos. Para `percent_*` representa pontos percentuais (ex.: `10.00` = 10%); para `fixed_piece` representa R$.
- `discount_custom`: texto livre, preenchido apenas quando `discount_type = 'custom'`.
- RLS já habilitada (`auth.uid() = id`) — sem mudanças.

## Tipos

`src/types/database.ts` — estender Row/Insert/Update de `store_settings` com as 4 colunas:

```ts
faq: Array<{ pergunta: string; resposta: string }>
discount_type: 'percent_piece' | 'percent_order' | 'fixed_piece' | 'custom' | null
discount_value: number | null
discount_custom: string | null
```

`StoreSettings` em `src/types/store-settings.ts` deriva de `Database[...]['Row']`, então herda automaticamente.

## Server Action — `src/actions/store-settings.ts`

**Constantes novas:**

```ts
const VALID_DISCOUNT_TYPES = ['percent_piece', 'percent_order', 'fixed_piece', 'custom'] as const
const MAX_FAQ_ITEMS = 30
const MAX_FAQ_QUESTION_LENGTH = 200
const MAX_FAQ_ANSWER_LENGTH = 1000
const MAX_DISCOUNT_CUSTOM_LENGTH = 280
const MAX_DISCOUNT_VALUE = 99_999_999.99
```

**Helpers novos:**

- `sanitizeFaq(input): Array<{pergunta, resposta}>`
  - Não-array → `[]`.
  - Para cada item: tira HTML (mesma regra de `sanitizeText`), `trim`, corta nos limites.
  - **Descarta pares onde `pergunta` OU `resposta` estão vazias após trim** (par incompleto é rascunho de UI, não persiste).
  - Limita a `MAX_FAQ_ITEMS`.
- `sanitizeDiscountType(input): DiscountType | null` — retorna o valor se estiver em `VALID_DISCOUNT_TYPES`, senão `null`.
- `sanitizeDiscountValue(input): number | null` — número finito, `>= 0`, `<= MAX_DISCOUNT_VALUE`, arredondado a 2 casas; senão `null`.

**Payload estendido** de `saveStoreSettings` com:

```ts
faq: Array<{ pergunta: string; resposta: string }>
discount_type: 'percent_piece' | 'percent_order' | 'fixed_piece' | 'custom' | null
discount_value: number | null
discount_custom: string
```

**Regras de coerência (server, normaliza em vez de erro fatal):**

- `discount_type === null` → zera `discount_value` e `discount_custom` no upsert.
- `discount_type ∈ {percent_piece, percent_order, fixed_piece}` → persiste `discount_value` sanitizado; `discount_custom` vira `''`.
  - Para `percent_*`, se `discount_value > 100` ainda é aceito? → **clamp a 100** (percentual não passa de 100%). `fixed_piece` não tem clamp (além do teto de `NUMERIC`).
- `discount_type === 'custom'` → persiste `discount_custom` sanitizado (≤ 280, sem HTML); `discount_value` vira `null`.
- O upsert estende o objeto atual com as 4 colunas; conflito por `id` permanece.

> Observação: o desconto não tem validação "obrigatório" — é opcional mesmo com o pedido mínimo ligado.

## UI — `src/app/loja/LojaForm.tsx`

### Componente A · Perguntas e respostas (nova seção `05 · CONHECIMENTO`)

Inserida **depois** da seção `03 · ATENDIMENTO` e **antes** de Operação. A numeração no `step` é só rótulo visual. Nova ordem dos rótulos: `01 Identidade`, `02 Contato`, `03 Atendimento`, `04 Conhecimento` (FAQ, novo), `05 Operação` (antes `04`).

**Estado novo:**

```ts
const [faq, setFaq] = useState<Array<{ pergunta: string; resposta: string }>>(
  settings?.faq ?? [],
)
```

**Layout:**

```
┌─ 04 · CONHECIMENTO — Perguntas e respostas ─────────────┐
│ Cadastre dúvidas frequentes e as respostas que o agente │
│ deve usar.                                              │
│                                                         │
│ ┌─ Pergunta 1 ───────────────────────────── [remover] ┐│
│ │ Pergunta:  [_______________________________]        ││
│ │ Resposta:  [textarea __________________________]    ││
│ └─────────────────────────────────────────────────────┘│
│ ┌─ Pergunta 2 ───────────────────────────── [remover] ┐│
│ │ ...                                                  ││
│ └─────────────────────────────────────────────────────┘│
│                                                         │
│ [ + Adicionar pergunta ]   (oculto ao atingir 30)       │
└─────────────────────────────────────────────────────────┘
```

**Comportamento:**

- "+ Adicionar pergunta" empurra `{ pergunta: '', resposta: '' }` (desabilita ao chegar em `MAX_FAQ_ITEMS`).
- "remover" tira o par pelo índice.
- Contadores de caracteres reaproveitam o padrão `.counter`/`.over` já usado nas outras seções.
- Estado vazio (nenhum par): texto auxiliar "Nenhuma pergunta cadastrada ainda."
- No submit: pares com `pergunta` ou `resposta` vazias (após trim) são filtrados antes de enviar (espelha o server).

### Componente B · Desconto de atacado (dentro do collapsible de Pedido mínimo)

Inserido **dentro** do bloco `collapsible ${minOrderEnabled ? 'open' : ''}` existente, depois do radio AND/OR de `minOrderLogic`. Aparece junto com o resto do atacado (só com `minOrderEnabled`).

**Estado novo:**

```ts
const [discountType, setDiscountType] = useState<
  'percent_piece' | 'percent_order' | 'fixed_piece' | 'custom' | null
>(settings?.discount_type ?? null)
const [discountValue, setDiscountValue] = useState<string>(
  settings?.discount_value != null ? String(settings.discount_value) : '',
)
const [discountCustom, setDiscountCustom] = useState(settings?.discount_custom ?? '')
```

**Layout:**

```
── Desconto de atacado (opcional) ──
( ) % por preço da peça        ┐
( ) % por preço do pedido      │ radio (1 ativo)
( ) Valor fixo por peça        │
( ) Personalizado              ┘

 → se percent_piece / percent_order:  [ ___ ] %      (input number, 0–100)
 → se fixed_piece:                     R$ [ ___ ]     (input number, ≥ 0)
 → se custom:                          [ texto livre ____________ ]  (≤ 280)
```

**Comportamento:**

- Radio controla `discountType`. Selecionar um tipo mostra só o input correspondente.
- Trocar de tipo numérico → tipo `custom` (ou vice-versa) não apaga o estado do outro campo (rascunho), mas o submit só envia o relevante (server normaliza).
- Opção de "limpar": clicar no radio já marcado não é nativo; adicionar um link/botão pequeno "Sem desconto" que faz `setDiscountType(null)`.
- Adornos `%` / `R$` reaproveitam o padrão `.adorn`/`relative` já usado em outros inputs.

### Submit — `handleSubmit`

Estender o objeto passado a `saveStoreSettings`:

```ts
faq: faq.filter((p) => p.pergunta.trim() !== '' && p.resposta.trim() !== ''),
discount_type: discountType,
discount_value:
  discountType && discountType !== 'custom' && discountValue.trim() !== ''
    ? parseFloat(discountValue)
    : null,
discount_custom: discountType === 'custom' ? discountCustom : '',
```

## Fluxo de dados

```
[LojaForm state: faq[], discountType, discountValue, discountCustom]
     ↓ submit (string → number|null; filtra pares vazios)
[saveStoreSettings action]
     ↓ sanitizeFaq + sanitizeDiscount* + coerência por tipo
[Supabase upsert store_settings]
     ↓
[DB: faq jsonb + discount_type/value/custom]
     ↑ select (página loja carrega settings)
[LojaForm recebe settings e popula estado]
```

A página `src/app/loja/page.tsx` já carrega `store_settings` e passa `settings` para `<LojaForm>`; como `StoreSettings` herda as colunas novas, nada muda lá além de o objeto vir mais cheio.

## Casos de erro / borda

| Cenário | Comportamento |
|---|---|
| FAQ com par sem pergunta ou sem resposta | Filtrado no submit e no server (não persiste) |
| FAQ acima de 30 pares | Botão "adicionar" desabilita; server corta em 30 |
| Pergunta/resposta com HTML | `sanitizeText` remove tags |
| Pergunta > 200 / resposta > 1000 | `maxLength` no input + corte no server |
| `discount_type` desligado mas value preenchido | Server zera value/custom |
| `percent_*` com valor > 100 | Clamp a 100 |
| `discount_value` negativo ou > teto | Sanitizer devolve `null`; `min` no input bloqueia |
| `discount_type` inválido | Sanitizer devolve `null` |
| Pedido mínimo desligado | Bloco de desconto nem aparece; valores ficam como rascunho no banco se já existiam |

## Fora do escopo

- **Injeção no prompt do agente** (`workflow-chat-agent.json`) — FAQ e desconto. Fica para depois da revisão do workflow.
- Cálculo/aplicação real do desconto em checkout ou carrinho.
- Descontos por categoria/produto, faixas (tiers) ou cupons.
- Importação/migração de FAQ a partir de `knowledge_gaps`.
- Moedas além de BRL.

## Testes manuais (gate antes de fechar)

1. Adicionar 2 perguntas, salvar, recarregar → pares restaurados idênticos.
2. Deixar um par com pergunta OU resposta vazia + salvar → par não persiste.
3. Adicionar 30 pares → botão "adicionar" some/desabilita.
4. Pedido mínimo ligado → bloco de desconto visível; desligado → some.
5. Selecionar `% por preço da peça`, valor 15, salvar, recarregar → tipo e valor corretos.
6. Selecionar `Valor fixo por peça`, R$ 5, salvar → persiste como `fixed_piece` + `5.00`.
7. Selecionar `Personalizado`, digitar texto, salvar → `discount_type='custom'` + texto; `discount_value` nulo.
8. Trocar de `custom` para `percent_order` e salvar → `discount_custom` zera no banco.
9. "Sem desconto" → `discount_type` nulo, value/custom limpos.
10. `% por preço do pedido` com valor 150 → clamp a 100.
11. `npm run build` / typecheck passam; lint sem erros novos.

## Arquivos tocados

- `supabase/migrations/033_store_settings_faq_discount.sql` (novo)
- `src/types/database.ts` (estende Row/Insert/Update de `store_settings`)
- `src/actions/store-settings.ts` (payload, helpers, validação/coerência, upsert)
- `src/app/loja/LojaForm.tsx` (nova seção FAQ, bloco de desconto, estado, submit)
