# Exigir Pedido Mínimo para Fechar (atacado) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar a flag por loja `min_order_required` que, no modo atacado, faz o agente bloquear o fechamento abaixo do pedido mínimo (quando ligada) ou apenas avisar/incentivar quando perto do mínimo (quando desligada — padrão).

**Architecture:** Nova coluna booleana `min_order_required` em `store_settings` (default `false`). O painel ganha um toggle dentro da seção de atacado. O agente Python lê a flag e o `_regras_atacado_block` do prompt emite uma de duas instruções (bloquear vs. avisar). Imposição via prompt — não há ação atômica de "fechar" no código.

**Tech Stack:** PostgreSQL/Supabase (migration), Next.js + TypeScript (painel), Python 3 + pytest (chat-service).

---

## Notas para quem executa

- Todo o trabalho é no worktree atual. Testes Python rodam de dentro de
  `chat-service`: `cd "C:/LUE FZ/.claude/worktrees/agente-desconto-lead/chat-service" && python -m pytest ...`
- Typecheck do frontend: o worktree não tem `node_modules`; use o `tsc` do repo
  principal — `cd "C:/LUE FZ/.claude/worktrees/agente-desconto-lead" && "C:/LUE FZ/node_modules/.bin/tsc" --noEmit`.
  Os tipos do Next (`PageProps`) já foram copiados para `.next/types` deste
  worktree numa task anterior; se o tsc reclamar de `PageProps` em
  `src/app/conversas/page.tsx`, é ambiental (rode `cp -r "C:/LUE FZ/.next/types" .next/types`) e não relacionado a estas mudanças.
- `min_order_required` só tem efeito quando `min_order_enabled = true` (atacado).
  Default `false` preserva o comportamento atual.

---

## Task 1: Migration 050 — coluna min_order_required

**Files:**
- Create: `supabase/migrations/050_store_settings_min_order_required.sql`

- [ ] **Step 1: Criar a migration**

```sql
-- 050_store_settings_min_order_required.sql
-- Atacado: quando ligado, o agente só fecha o pedido se o mínimo for atingido.
-- Default false preserva o comportamento atual (só avisa, pode fechar abaixo).
-- Idempotente: seguro re-rodar.

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS min_order_required BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/050_store_settings_min_order_required.sql
git commit -m "feat(db): coluna min_order_required em store_settings (migration 050)"
```

> Aplicação no Supabase de produção é manual (passo fora deste plano). **Precisa
> ser aplicada antes do deploy do chat-service**, pois `get_store_settings`
> passará a fazer `SELECT` dessa coluna (Task 2).

---

## Task 2: Backend — modelo e carregamento da flag

Adiciona o campo ao dataclass `StoreSettings` e faz `get_store_settings` lê-lo.

**Files:**
- Modify: `chat-service/app/models.py:49` (dataclass `StoreSettings`)
- Modify: `chat-service/app/db.py:26-58` (`get_store_settings`)
- Test: `chat-service/tests/test_models.py`

- [ ] **Step 1: Escrever os testes que falham**

Adicione ao fim de `chat-service/tests/test_models.py`:

```python
def test_store_settings_min_order_required_defaults_false():
    s = StoreSettings(id="x", store_name="Loja")
    assert s.min_order_required is False


def test_store_settings_accepts_min_order_required():
    s = StoreSettings(id="x", store_name="Loja", min_order_required=True)
    assert s.min_order_required is True
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "C:/LUE FZ/.claude/worktrees/agente-desconto-lead/chat-service" && python -m pytest tests/test_models.py -k min_order_required -v`
Expected: FAIL — `TypeError: __init__() got an unexpected keyword argument 'min_order_required'` (e o teste de default falha no `assert`).

- [ ] **Step 3: Adicionar o campo ao dataclass**

Em `chat-service/app/models.py`, no dataclass `StoreSettings`, logo após
`min_order_logic: str = "all"`:

```python
    min_order_logic: str = "all"
    min_order_required: bool = False
    discount_type: str | None = None
```

(A linha `discount_type: str | None = None` já existe — apenas insira
`min_order_required: bool = False` entre `min_order_logic` e `discount_type`.)

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "C:/LUE FZ/.claude/worktrees/agente-desconto-lead/chat-service" && python -m pytest tests/test_models.py -k min_order_required -v`
Expected: PASS (2 testes).

- [ ] **Step 5: Carregar a coluna em `get_store_settings`**

Em `chat-service/app/db.py`, no `SELECT` (acrescente `min_order_required` à lista,
após `min_order_logic`):

```python
            """SELECT id::text, store_name, categories, payment_methods,
                      delivery_methods, service_instructions, seller_phone,
                      instagram_handle, service_steps, faq, min_order_enabled,
                      min_order_quantity, min_order_value, min_order_logic,
                      min_order_required,
                      discount_type, discount_value, discount_custom
               FROM store_settings WHERE id = $1""", store_id)
```

E no construtor de `StoreSettings`, após `min_order_logic=...`:

```python
            min_order_logic=r["min_order_logic"] or "all",
            min_order_required=bool(r["min_order_required"]),
            discount_type=r["discount_type"],
```

- [ ] **Step 6: Rodar a suíte (sem regressão)**

Run: `cd "C:/LUE FZ/.claude/worktrees/agente-desconto-lead/chat-service" && python -m pytest tests/ -q`
Expected: PASS (todos; `get_store_settings` não tem teste unitário — a mudança é
coberta por inspeção e não quebra a coleta).

- [ ] **Step 7: Commit**

```bash
git add chat-service/app/models.py chat-service/app/db.py chat-service/tests/test_models.py
git commit -m "feat(chat): StoreSettings.min_order_required carregado do banco"
```

---

## Task 3: Agente — comportamento condicional no prompt

`_regras_atacado_block` passa a emitir bloquear vs. avisar conforme a flag.

**Files:**
- Modify: `chat-service/app/agent/prompt.py:150-166` (`_regras_atacado_block`)
- Test: `chat-service/tests/test_prompt.py`

- [ ] **Step 1: Escrever os testes que falham**

Adicione ao fim de `chat-service/tests/test_prompt.py`:

```python
def test_atacado_min_order_required_bloqueia_fechamento(store):
    s = dataclasses.replace(store, min_order_enabled=True, min_order_quantity=10,
                            min_order_value=200.0, min_order_required=True)
    p = build_store_prompt(s)
    assert "OBRIGATÓRIO" in p
    assert "enquanto o mínimo não for atingido" in p


def test_atacado_min_order_nao_obrigatorio_avisa_perto(store):
    s = dataclasses.replace(store, min_order_enabled=True, min_order_quantity=10,
                            min_order_value=200.0, min_order_required=False)
    p = build_store_prompt(s)
    assert "OBRIGATÓRIO" not in p
    assert "perto do mínimo" in p
    assert "Pode fechar mesmo abaixo" in p
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "C:/LUE FZ/.claude/worktrees/agente-desconto-lead/chat-service" && python -m pytest tests/test_prompt.py -k "required or nao_obrigatorio" -v`
Expected: FAIL — o bloco atual não tem "OBRIGATÓRIO" nem "perto do mínimo".

- [ ] **Step 3: Tornar a linha do mínimo condicional**

Em `chat-service/app/agent/prompt.py`, substitua o trecho do `if minimo:` dentro
de `_regras_atacado_block`:

```python
    if minimo:
        linhas.append(
            f"Pedido mínimo: {minimo}. Avise o cliente do pedido mínimo de um jeito leve "
            "quando ele estiver montando o pedido ou perguntar, e vá somando as peças pra "
            "conferir se já bateu. Não feche abaixo do mínimo sem avisar.")
```

por:

```python
    if minimo:
        if store.min_order_required:
            linhas.append(
                f"Pedido mínimo: {minimo}. Esse mínimo é OBRIGATÓRIO pra fechar. Vá "
                "somando as peças e avise o cliente de leve enquanto ele monta o pedido. "
                "NÃO dê o pedido por fechado nem encaminhe pra loja enquanto o mínimo não "
                "for atingido. Se o cliente quiser fechar abaixo, explique com leveza que "
                "o mínimo é necessário e ajude a completar, sugerindo mais peças, até "
                "bater o mínimo.")
        else:
            linhas.append(
                f"Pedido mínimo: {minimo}. Avise o cliente do pedido mínimo de um jeito "
                "leve quando ele estiver montando o pedido ou perguntar, e vá somando as "
                "peças pra conferir se já bateu. Pode fechar mesmo abaixo do mínimo. "
                "Quando o pedido estiver perto do mínimo, avise sobre o mínimo e, se a "
                "loja tiver desconto de atacado, lembre que atingindo o mínimo ele garante "
                "o desconto — pergunte se ele quer adicionar mais peças, sem insistir se "
                "não quiser.")
```

- [ ] **Step 4: Rodar os testes do arquivo e ver passar**

Run: `cd "C:/LUE FZ/.claude/worktrees/agente-desconto-lead/chat-service" && python -m pytest tests/test_prompt.py -v`
Expected: PASS (os 2 novos + todos os existentes, incluindo
`test_atacado_prompt_shows_min_order_rule`, que roda com `min_order_required`
default `False` e continua encontrando "Pedido mínimo").

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/agent/prompt.py chat-service/tests/test_prompt.py
git commit -m "feat(chat): prompt bloqueia ou avisa conforme min_order_required"
```

---

## Task 4: Painel — tipos do banco e action

Expõe `min_order_required` no tipo da tabela e o persiste no save.

**Files:**
- Modify: `src/types/database.ts` (blocos Row/Insert/Update de `store_settings`)
- Modify: `src/actions/store-settings.ts` (interface, coerção, upsert)

- [ ] **Step 1: Adicionar a coluna aos tipos**

Em `src/types/database.ts`, na tabela `store_settings`:

No bloco `Row`, após `min_order_logic: 'all' | 'any'`:

```ts
          min_order_logic: 'all' | 'any'
          min_order_required: boolean
```

No bloco `Insert`, após `min_order_logic?: 'all' | 'any'`:

```ts
          min_order_logic?: 'all' | 'any'
          min_order_required?: boolean
```

No bloco `Update`, após `min_order_logic?: 'all' | 'any'`:

```ts
          min_order_logic?: 'all' | 'any'
          min_order_required?: boolean
```

- [ ] **Step 2: Aceitar e persistir o campo na action**

Em `src/actions/store-settings.ts`:

1. No tipo do parâmetro `data` de `saveStoreSettings`, após
   `min_order_logic: 'all' | 'any'` (campo **opcional** para que o `LojaForm`,
   que só passa a enviá-lo na Task 5, não quebre o typecheck deste checkpoint; a
   coerção `=== true` trata `undefined` como `false`):

```ts
  min_order_logic: 'all' | 'any'
  min_order_required?: boolean
```

2. Após `const minOrderLogic = sanitizeMinOrderLogic(data.min_order_logic)`:

```ts
  const minOrderLogic = sanitizeMinOrderLogic(data.min_order_logic)
  const minOrderRequired = data.min_order_required === true
```

3. No objeto do `.upsert(...)`, após `min_order_logic: minOrderLogic,`:

```ts
        min_order_logic: minOrderLogic,
        min_order_required: minOrderRequired,
```

- [ ] **Step 3: Typecheck**

Run: `cd "C:/LUE FZ/.claude/worktrees/agente-desconto-lead" && "C:/LUE FZ/node_modules/.bin/tsc" --noEmit`
Expected: EXIT 0 (sem erros). O campo é opcional no payload, então o `LojaForm`
(que ainda não o envia) compila normalmente.

- [ ] **Step 4: Commit**

```bash
git add src/types/database.ts src/actions/store-settings.ts
git commit -m "feat(painel): persiste min_order_required no store_settings"
```

---

## Task 5: Painel — toggle no LojaForm

Adiciona o estado, o controle de UI e o envio no payload.

**Files:**
- Modify: `src/app/loja/LojaForm.tsx` (estado ~250, payload ~329, UI ~817-821)

- [ ] **Step 1: Adicionar o estado**

Em `src/app/loja/LojaForm.tsx`, após o `useState` de `minOrderLogic`:

```tsx
  const [minOrderLogic, setMinOrderLogic] = useState<'all' | 'any'>(
    settings?.min_order_logic === 'any' ? 'any' : 'all',
  )
  const [minOrderRequired, setMinOrderRequired] = useState(
    settings?.min_order_required ?? false,
  )
```

- [ ] **Step 2: Enviar no payload**

No objeto passado para `saveStoreSettings(...)`, após `min_order_logic: minOrderLogic,`:

```tsx
      min_order_logic: minOrderLogic,
      min_order_required: minOrderRequired,
```

- [ ] **Step 3: Adicionar o toggle na UI**

Em `src/app/loja/LojaForm.tsx`, dentro do collapsible de atacado, substitua o
parágrafo helper:

```tsx
                  <p className="helper">
                    Pelo menos um dos campos acima é obrigatório quando o
                    pedido mínimo está ativado.
                  </p>
```

por (mantém o helper e adiciona o toggle logo abaixo):

```tsx
                  <p className="helper">
                    Pelo menos um dos campos acima é obrigatório quando o
                    pedido mínimo está ativado.
                  </p>

                  <label className="flex items-start gap-3 p-3.5 rounded-xl border border-ink-200 cursor-pointer">
                    <input
                      type="checkbox"
                      className="check mt-0.5"
                      checked={minOrderRequired}
                      onChange={() => setMinOrderRequired((v) => !v)}
                    />
                    <span className="flex-1">
                      <span className="text-[13.5px] font-semibold text-ink-900">
                        Bloquear fechamento abaixo do mínimo
                      </span>
                      <span className="block text-[11.5px] text-ink-600 mt-0.5">
                        Se ligado, o agente só fecha quando o mínimo for atingido.
                        Se desligado, fecha mesmo abaixo e avisa o cliente quando
                        estiver perto, incentivando a atingir o mínimo para ganhar
                        o desconto.
                      </span>
                    </span>
                  </label>
```

- [ ] **Step 4: Typecheck**

Run: `cd "C:/LUE FZ/.claude/worktrees/agente-desconto-lead" && "C:/LUE FZ/node_modules/.bin/tsc" --noEmit`
Expected: EXIT 0 (sem erros).

- [ ] **Step 5: Commit**

```bash
git add src/app/loja/LojaForm.tsx
git commit -m "feat(painel): toggle Bloquear fechamento abaixo do minimo"
```

---

## Task 6: Verificação final

- [ ] **Step 1: Suíte Python completa**

Run: `cd "C:/LUE FZ/.claude/worktrees/agente-desconto-lead/chat-service" && python -m pytest tests/ -q`
Expected: PASS (sem falhas).

- [ ] **Step 2: Typecheck do painel**

Run: `cd "C:/LUE FZ/.claude/worktrees/agente-desconto-lead" && "C:/LUE FZ/node_modules/.bin/tsc" --noEmit`
Expected: EXIT 0.

- [ ] **Step 3: Conferência manual**

Confirme:
- Migration 050 pendente de aplicação no Supabase de produção (antes do deploy).
- Loja com `min_order_required=true` → prompt instrui a não fechar sem o mínimo.
- Loja com `min_order_required=false` (padrão) → prompt permite fechar abaixo e
  orienta o aviso quando perto do mínimo.

---

## Resumo de cobertura do spec

- Coluna `min_order_required` default false → Task 1.
- Modelo + carregamento no agente → Task 2.
- Comportamento condicional (bloquear vs. avisar) → Task 3.
- Tipo do banco + persistência na action → Task 4.
- Toggle no painel → Task 5.
- Desconto inalterado (só com mínimo atingido) → nenhuma mudança (confirmado).

## Fora de escopo

- Limiar configurável de "perto do mínimo" (IA julga).
- Gate de código para o fechamento (via prompt).
- Mudanças na lógica de desconto.
