# Pedido Mínimo (Atacado) — Design

**Data:** 2026-05-03
**Status:** Aprovado para implementação
**Escopo:** Adicionar configuração de pedido mínimo (quantidade de peças e/ou valor) na página `loja`, persistindo em colunas dedicadas em `store_settings`.

## Motivação

Lojas que atendem no atacado costumam exigir um pedido mínimo — em quantidade de peças, em valor monetário, ou ambos — para aceitar um pedido. Hoje a página `loja` não permite configurar isso. Esta entrega adiciona o componente de configuração e persistência. O **consumo** desses limites (no agente IA, no widget, em checkout) está **fora do escopo** desta entrega.

## Decisões (capturadas no brainstorming)

| Pergunta | Decisão |
|---|---|
| Como o lojista habilita | Toggle "Exigir pedido mínimo" + dois campos opcionais (qty, valor) |
| Lógica quando os dois estão preenchidos | Radio escolhido pelo lojista: "Exigir os dois" (`all`) ou "Exigir qualquer um" (`any`) |
| Uso downstream | Apenas armazenar no banco. Consumo (agente IA, widget) fica para depois. |
| Formato dos campos | Qty = inteiro positivo (total de peças no pedido). Valor = BRL com 2 casas, `NUMERIC(12,2)` |
| Modelagem | 4 colunas dedicadas em `store_settings` com toggle explícito (preserva valores como rascunho) |

## Schema

Migration: `supabase/migrations/010_store_settings_min_order.sql`

```sql
ALTER TABLE store_settings
  ADD COLUMN min_order_enabled  BOOLEAN       NOT NULL DEFAULT false,
  ADD COLUMN min_order_quantity INTEGER,
  ADD COLUMN min_order_value    NUMERIC(12,2),
  ADD COLUMN min_order_logic    TEXT          NOT NULL DEFAULT 'all';

ALTER TABLE store_settings
  ADD CONSTRAINT min_order_quantity_positive
    CHECK (min_order_quantity IS NULL OR min_order_quantity >= 1),
  ADD CONSTRAINT min_order_value_non_negative
    CHECK (min_order_value IS NULL OR min_order_value >= 0),
  ADD CONSTRAINT min_order_logic_valid
    CHECK (min_order_logic IN ('all','any'));
```

- RLS já está habilitada na tabela e usa `auth.uid() = id` — sem mudanças.
- Defaults garantem que rows existentes não quebrem na migration.
- Valores nulos em `quantity`/`value` representam "este critério não foi definido pelo lojista".

## Server Action

Arquivo: `src/actions/store-settings.ts`

**Constantes novas:**

```ts
const VALID_MIN_ORDER_LOGIC = ['all', 'any'] as const
const MAX_MIN_ORDER_QUANTITY = 1_000_000
const MAX_MIN_ORDER_VALUE = 99_999_999.99
```

**Helpers novos:**

```ts
function sanitizeMinOrderQuantity(input: unknown): number | null {
  if (typeof input !== 'number' || !Number.isFinite(input)) return null
  const n = Math.floor(input)
  if (n < 1 || n > MAX_MIN_ORDER_QUANTITY) return null
  return n
}

function sanitizeMinOrderValue(input: unknown): number | null {
  if (typeof input !== 'number' || !Number.isFinite(input)) return null
  if (input < 0 || input > MAX_MIN_ORDER_VALUE) return null
  return Math.round(input * 100) / 100
}

function sanitizeMinOrderLogic(input: unknown): 'all' | 'any' {
  return input === 'any' ? 'any' : 'all'
}
```

**Payload estendido:**

```ts
saveStoreSettings(data: {
  store_name: string
  service_steps: string[]
  service_instructions: string
  payment_methods: string[]
  delivery_methods: string[]
  categories: string[]
  min_order_enabled: boolean
  min_order_quantity: number | null
  min_order_value: number | null
  min_order_logic: 'all' | 'any'
})
```

**Regras de validação:**

- Se `min_order_enabled === true`, exige **pelo menos um** entre `min_order_quantity` e `min_order_value` não-nulo após sanitização.
  - Caso contrário: `{ success: false, error: 'Informe quantidade mínima ou valor mínimo.' }`
- Se `min_order_enabled === false`, salva os valores como rascunho (qty/value/logic preservados conforme enviados/sanitizados); validação de "pelo menos um" não se aplica.
- `min_order_logic` é sempre persistido normalizado (`'all'` ou `'any'`).
- O upsert estende o objeto atual com as 4 colunas novas; conflito por `id` permanece.

## UI — `src/app/loja/page.tsx`

Novo `<fieldset>` "Pedido Mínimo (Atacado)", inserido **imediatamente antes** do fieldset "Formas de Pagamento".

**Estado novo:**

```ts
const [minOrderEnabled, setMinOrderEnabled]   = useState(false)
const [minOrderQuantity, setMinOrderQuantity] = useState<string>('')
const [minOrderValue, setMinOrderValue]       = useState<string>('')
const [minOrderLogic, setMinOrderLogic]       = useState<'all'|'any'>('all')
```

(Campos numéricos como `string` para evitar comportamento ruim de `<input type="number">` controlado com `number`.)

**Layout:**

```
┌─ Pedido Mínimo (Atacado) ───────────────────────────────┐
│ [✓] Exigir pedido mínimo                                │
│   ── (visível apenas quando ligado) ──                  │
│                                                         │
│   Quantidade mínima de peças                            │
│   [_______]   <input type=number min=1 step=1>          │
│                                                         │
│   Valor mínimo do pedido (R$)                           │
│   [_______]   <input type=number min=0 step=0.01>       │
│                                                         │
│   ── (visível apenas quando os dois acima preenchidos) ─│
│   Quando ambos os critérios estão definidos:            │
│   ( ) Exigir os dois (quantidade E valor)               │
│   ( ) Exigir qualquer um (quantidade OU valor)          │
└─────────────────────────────────────────────────────────┘
```

**Comportamento:**

- Toggle off: campos ficam ocultos mas o estado é preservado (rascunho).
- Radio AND/OR só aparece quando `minOrderQuantity !== ''` E `minOrderValue !== ''`.
- Validação client-side espelha o action: se ligado e os dois campos vazios, exibe erro inline e não chama o server action.
- Conversão no submit: `parseInt(minOrderQuantity, 10)` (NaN/`''` → `null`), `parseFloat(minOrderValue)` (NaN/`''` → `null`).

**Load:**

O `useEffect` existente já faz `select('*')` em `store_settings`. Estender o bloco `if (data)` para popular os 4 estados novos:

```ts
setMinOrderEnabled(data.min_order_enabled ?? false)
setMinOrderQuantity(data.min_order_quantity != null ? String(data.min_order_quantity) : '')
setMinOrderValue(data.min_order_value != null ? String(data.min_order_value) : '')
setMinOrderLogic(data.min_order_logic === 'any' ? 'any' : 'all')
```

## Tipos

`src/types/` será inspecionado durante a implementação. Se houver um tipo `StoreSettings` compartilhado, estendê-lo com os 4 campos novos. Caso contrário, manter o padrão atual de tipos inline na action.

## Casos de erro

| Cenário | Comportamento |
|---|---|
| Toggle ligado, ambos campos vazios | Erro inline: "Informe quantidade mínima ou valor mínimo." (sem chamada ao server) |
| Qty ≤ 0 ou não-inteira | `min={1}` no input bloqueia; sanitizer devolve `null`; CHECK do DB rejeitaria |
| Valor < 0 | `min={0}` no input bloqueia; sanitizer devolve `null`; CHECK do DB rejeitaria |
| Valor > 99.999.999,99 | Sanitizer devolve `null` (acima do tamanho de `NUMERIC(12,2)`) |
| `min_order_logic` desconhecido | Sanitizer normaliza para `'all'` |
| Toggle desligado com valores preenchidos | Salva `enabled=false` + valores como rascunho |

## Fluxo de dados

```
[loja/page.tsx form state]
     ↓ submit (string → number|null)
[saveStoreSettings action]
     ↓ sanitize + validate
[Supabase upsert store_settings]
     ↓
[DB row com 4 colunas novas]
     ↑ select('*')
[loja/page.tsx useEffect popula estado]
```

## Fora do escopo

- Consumo dos mínimos no agente de IA (instruções dinâmicas).
- Bloqueio no widget / fluxo de checkout.
- Mínimos diferentes por categoria ou produto.
- Moedas além de BRL.
- Migração de dados de lojas existentes (todas começam com `enabled=false`).

## Testes manuais (gate antes de fechar)

1. Toggle off + submit → row gravada com `enabled=false`, qty/value `null`, logic `'all'`.
2. Toggle on + só qty preenchida → salva e recarrega com qty preenchida e value `null`; radio AND/OR não aparece.
3. Toggle on + só value preenchido → simétrico ao caso 2.
4. Toggle on + ambos preenchidos → radio AND/OR aparece; salva com `logic` correto; recarrega idêntico.
5. Toggle on + ambos vazios → erro inline, action não é chamado.
6. Reload da página em qualquer um dos estados acima → estado restaurado idêntico ao salvo.
7. Tentar enviar `min_order_value = 100000000` → sanitizer rejeita silenciosamente (vira `null`); ou bloqueio no input.

## Arquivos tocados

- `supabase/migrations/010_store_settings_min_order.sql` (novo)
- `src/actions/store-settings.ts` (estende payload, helpers, validação, upsert)
- `src/app/loja/page.tsx` (novo fieldset, estado, load, submit)
- `src/types/*` (estender `StoreSettings` se existir)
