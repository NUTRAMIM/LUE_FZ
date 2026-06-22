# Ajustes no Agente: Desconto no valor_total + WhatsApp Obrigatório — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o desconto de atacado refletir no `valor_total` gravado no banco (quando o mínimo de atacado é atingido) e tornar o WhatsApp do cliente obrigatório para o agente fechar o pedido.

**Architecture:** No `chat-service` (Python), o registro do pedido passa a calcular o valor líquido: tipos de desconto simples (`percent_piece`/`percent_order`/`fixed_piece`) são calculados de forma determinística no código; o tipo `custom` (texto livre) usa um valor que a LLM calcula e envia via tool. Grava-se bruto, líquido e desconto numa nova migration. A obrigatoriedade do WhatsApp é reforçada no prompt do agente (sem gate de código). O painel Next.js passa a exibir bruto/desconto.

**Tech Stack:** Python 3 + pytest (chat-service); PostgreSQL/Supabase (migrations SQL); Next.js + TypeScript (painel).

---

## Notas para quem executa

- Os comandos de teste Python rodam **a partir da pasta `chat-service`**.
  No PowerShell: `cd chat-service; python -m pytest ...` (use o Bash tool com
  `cd "C:/LUE FZ/chat-service" && python -m pytest ...` se preferir).
- A assinatura de `registrar_pedido` muda de `(db, store_id, ...)` para
  `(db, store, ...)` — o objeto `StoreSettings` inteiro. Várias chamadas em
  testes existentes precisam ser atualizadas (Task 5). O `store.id` continua
  sendo `"store-1"` no fixture, então asserts de `store_id` seguem válidos.
- `percent_piece` e `percent_order` produzem o MESMO cálculo sobre o total
  (`total × (1 − %/100)`) — é intencional, não é bug.

---

## Task 1: Migration 049 — colunas valor_bruto e desconto_aplicado

**Files:**
- Create: `supabase/migrations/049_leads_order_discount_fields.sql`

- [ ] **Step 1: Criar a migration**

```sql
-- 049_leads_order_discount_fields.sql
-- Rastreabilidade do desconto de atacado no pedido do lead.
-- valor_total passa a guardar o LÍQUIDO (com desconto). valor_bruto guarda a
-- soma preço×qtd sem desconto; desconto_aplicado = valor_bruto - valor_total.
-- Idempotente: seguro re-rodar.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS valor_bruto       NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS desconto_aplicado NUMERIC(10, 2);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/049_leads_order_discount_fields.sql
git commit -m "feat(db): colunas valor_bruto e desconto_aplicado em leads (migration 049)"
```

> A migration é aplicada manualmente no Supabase de produção (fora deste plano),
> seguindo o mesmo processo das migrations anteriores.

---

## Task 2: Função `minimo_atacado_atingido`

Decide se o pedido atingiu o mínimo de atacado configurado — o desconto só vale
quando essa função retorna `True`.

**Files:**
- Modify: `chat-service/app/agent/tools.py` (adicionar função perto de `calcular_valor_total`, ~linha 270)
- Test: `chat-service/tests/test_tools.py`

- [ ] **Step 1: Escrever os testes que falham**

Adicione ao fim de `chat-service/tests/test_tools.py`. Ajuste o import do topo do
arquivo para incluir as novas funções:

```python
from app.agent.tools import (buscar_produtos, registrar_pedido, format_pedido,
                             calcular_valor_total, minimo_atacado_atingido,
                             aplicar_desconto)
from app.models import StoreSettings
```

```python
def _store_desc(**kw):
    """StoreSettings mínimo para testar desconto/mínimo."""
    base = dict(id="store-1", store_name="LUE")
    base.update(kw)
    return StoreSettings(**base)


def test_minimo_atingido_sem_minimo_configurado_e_sempre_true():
    store = _store_desc()
    itens = [{"produto": "Top", "qtd": 1, "preco": 10.0}]
    assert minimo_atacado_atingido(store, itens) is True


def test_minimo_por_quantidade_all():
    store = _store_desc(min_order_quantity=12, min_order_logic="all")
    abaixo = [{"produto": "Top", "qtd": 5, "preco": 10.0}]
    atingiu = [{"produto": "Top", "qtd": 12, "preco": 10.0}]
    assert minimo_atacado_atingido(store, abaixo) is False
    assert minimo_atacado_atingido(store, atingiu) is True


def test_minimo_por_valor_all():
    store = _store_desc(min_order_value=100.0, min_order_logic="all")
    abaixo = [{"produto": "Top", "qtd": 1, "preco": 50.0}]
    atingiu = [{"produto": "Top", "qtd": 2, "preco": 50.0}]
    assert minimo_atacado_atingido(store, abaixo) is False
    assert minimo_atacado_atingido(store, atingiu) is True


def test_minimo_logica_any_basta_um():
    store = _store_desc(min_order_quantity=12, min_order_value=100.0,
                        min_order_logic="any")
    # bate o valor (100) mas não a qtd (2 < 12) -> any => True
    itens = [{"produto": "Top", "qtd": 2, "preco": 50.0}]
    assert minimo_atacado_atingido(store, itens) is True


def test_minimo_logica_all_precisa_dos_dois():
    store = _store_desc(min_order_quantity=12, min_order_value=100.0,
                        min_order_logic="all")
    itens = [{"produto": "Top", "qtd": 2, "preco": 50.0}]  # valor ok, qtd não
    assert minimo_atacado_atingido(store, itens) is False
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `cd "C:/LUE FZ/chat-service" && python -m pytest tests/test_tools.py -k minimo -v`
Expected: FAIL com `ImportError`/`cannot import name 'minimo_atacado_atingido'`.

- [ ] **Step 3: Implementar `minimo_atacado_atingido`**

Em `chat-service/app/agent/tools.py`, logo após `calcular_valor_total` (~linha 270):

```python
def minimo_atacado_atingido(store, itens) -> bool:
    """True se o pedido bate o mínimo de atacado configurado na loja.
    Sem mínimo configurado, retorna True (não há barreira para o desconto)."""
    norm = _normalize_itens(itens)
    qtd_total = sum(it["qtd"] for it in norm)
    valor_bruto = calcular_valor_total(norm) or 0.0
    minq = store.min_order_quantity
    minv = store.min_order_value
    if not minq and not minv:
        return True
    cond_qtd = (not minq) or (qtd_total >= minq)
    cond_val = (not minv) or (valor_bruto >= minv)
    if (store.min_order_logic or "all") == "all":
        return cond_qtd and cond_val
    return cond_qtd or cond_val
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `cd "C:/LUE FZ/chat-service" && python -m pytest tests/test_tools.py -k minimo -v`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/agent/tools.py chat-service/tests/test_tools.py
git commit -m "feat(chat): minimo_atacado_atingido para gate do desconto"
```

---

## Task 3: Função `aplicar_desconto`

Calcula o valor líquido por tipo de desconto.

**Files:**
- Modify: `chat-service/app/agent/tools.py` (adicionar após `minimo_atacado_atingido`)
- Test: `chat-service/tests/test_tools.py`

- [ ] **Step 1: Escrever os testes que falham**

Adicione ao fim de `chat-service/tests/test_tools.py`:

```python
def test_aplicar_desconto_sem_tipo_retorna_bruto():
    store = _store_desc()
    itens = [{"produto": "Top", "qtd": 2, "preco": 50.0}]
    assert aplicar_desconto(100.0, store, itens) == (100.0, 0.0)


def test_aplicar_desconto_percent_order():
    store = _store_desc(discount_type="percent_order", discount_value=10.0)
    itens = [{"produto": "Top", "qtd": 2, "preco": 50.0}]
    assert aplicar_desconto(100.0, store, itens) == (90.0, 10.0)


def test_aplicar_desconto_percent_piece_igual_a_percent_order():
    store = _store_desc(discount_type="percent_piece", discount_value=10.0)
    itens = [{"produto": "Top", "qtd": 2, "preco": 50.0}]
    assert aplicar_desconto(100.0, store, itens) == (90.0, 10.0)


def test_aplicar_desconto_fixed_piece_por_peca():
    store = _store_desc(discount_type="fixed_piece", discount_value=5.0)
    itens = [{"produto": "Top", "qtd": 2, "preco": 50.0}]  # 2 peças -> -10
    assert aplicar_desconto(100.0, store, itens) == (90.0, 10.0)


def test_aplicar_desconto_fixed_piece_nao_fica_negativo():
    store = _store_desc(discount_type="fixed_piece", discount_value=80.0)
    itens = [{"produto": "Top", "qtd": 2, "preco": 50.0}]  # -160 -> piso 0
    assert aplicar_desconto(100.0, store, itens) == (0.0, 100.0)


def test_aplicar_desconto_custom_usa_valor_da_llm():
    store = _store_desc(discount_type="custom",
                        discount_custom="5% acima de 10 peças")
    itens = [{"produto": "Top", "qtd": 20, "preco": 5.0}]
    assert aplicar_desconto(100.0, store, itens, valor_com_desconto=95.0) == (95.0, 5.0)


def test_aplicar_desconto_custom_sem_valor_grava_bruto():
    store = _store_desc(discount_type="custom", discount_custom="combine no fechamento")
    itens = [{"produto": "Top", "qtd": 20, "preco": 5.0}]
    assert aplicar_desconto(100.0, store, itens, valor_com_desconto=None) == (100.0, 0.0)


def test_aplicar_desconto_custom_valor_invalido_grava_bruto():
    store = _store_desc(discount_type="custom", discount_custom="x")
    itens = [{"produto": "Top", "qtd": 20, "preco": 5.0}]
    # maior que o bruto e <=0 são ignorados (fallback seguro)
    assert aplicar_desconto(100.0, store, itens, valor_com_desconto=150.0) == (100.0, 0.0)
    assert aplicar_desconto(100.0, store, itens, valor_com_desconto=0.0) == (100.0, 0.0)


def test_aplicar_desconto_minimo_nao_atingido_retorna_bruto():
    store = _store_desc(discount_type="percent_order", discount_value=10.0,
                        min_order_quantity=12, min_order_logic="all")
    itens = [{"produto": "Top", "qtd": 2, "preco": 50.0}]  # qtd 2 < 12
    assert aplicar_desconto(100.0, store, itens) == (100.0, 0.0)


def test_aplicar_desconto_bruto_none_retorna_none():
    store = _store_desc(discount_type="percent_order", discount_value=10.0)
    itens = [{"produto": "Top", "qtd": 2}]  # sem preço
    assert aplicar_desconto(None, store, itens) == (None, None)
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `cd "C:/LUE FZ/chat-service" && python -m pytest tests/test_tools.py -k aplicar_desconto -v`
Expected: FAIL com `cannot import name 'aplicar_desconto'`.

- [ ] **Step 3: Implementar `aplicar_desconto`**

Em `chat-service/app/agent/tools.py`, após `minimo_atacado_atingido`:

```python
def aplicar_desconto(valor_bruto, store, itens, valor_com_desconto=None):
    """Aplica o desconto de atacado ao total bruto e devolve (liquido, desconto).
    Tipos percent_*/fixed_piece são calculados aqui; custom usa o valor que a LLM
    enviou (com fallback seguro pro bruto). Só desconta se o mínimo foi atingido."""
    if valor_bruto is None:
        return None, None
    dt = store.discount_type
    dv = store.discount_value
    if not dt:
        return valor_bruto, 0.0
    if not minimo_atacado_atingido(store, itens):
        return valor_bruto, 0.0

    if dt in ("percent_piece", "percent_order") and dv is not None:
        liquido = round(valor_bruto * (1 - dv / 100), 2)
    elif dt == "fixed_piece" and dv is not None:
        qtd_total = sum(it["qtd"] for it in _normalize_itens(itens))
        liquido = max(0.0, round(valor_bruto - dv * qtd_total, 2))
    elif dt == "custom" and valor_com_desconto is not None \
            and 0 < valor_com_desconto <= valor_bruto:
        liquido = round(float(valor_com_desconto), 2)
    else:
        liquido = valor_bruto

    desconto = round(valor_bruto - liquido, 2)
    return liquido, desconto
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `cd "C:/LUE FZ/chat-service" && python -m pytest tests/test_tools.py -k aplicar_desconto -v`
Expected: PASS (10 testes).

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/agent/tools.py chat-service/tests/test_tools.py
git commit -m "feat(chat): aplicar_desconto calcula liquido por tipo de desconto"
```

---

## Task 4: Camada de persistência — `upsert_lead_order` com bruto e desconto

Estende a gravação para incluir as novas colunas, tanto no banco real quanto no
fake dos testes.

**Files:**
- Modify: `chat-service/app/db.py:188-201` (`upsert_lead_order`)
- Modify: `chat-service/tests/conftest.py:93-103` (`FakeDB.upsert_lead_order`)

- [ ] **Step 1: Atualizar o `upsert_lead_order` real**

Substitua `chat-service/app/db.py:188-201` por:

```python
    async def upsert_lead_order(self, conversation_id, store_id, pedido,
                                forma_pagamento, forma_entrega, valor_total=None,
                                valor_bruto=None, desconto_aplicado=None):
        await self._pool.execute(
            """INSERT INTO leads (conversation_id, store_id, pedido,
                                  forma_pagamento, forma_entrega, valor_total,
                                  valor_bruto, desconto_aplicado, source)
               VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, 'chat')
               ON CONFLICT (conversation_id) DO UPDATE SET
                 pedido = EXCLUDED.pedido,
                 forma_pagamento = COALESCE(EXCLUDED.forma_pagamento, leads.forma_pagamento),
                 forma_entrega   = COALESCE(EXCLUDED.forma_entrega, leads.forma_entrega),
                 valor_total       = EXCLUDED.valor_total,
                 valor_bruto       = EXCLUDED.valor_bruto,
                 desconto_aplicado = EXCLUDED.desconto_aplicado,
                 last_seen_at = now()""",
            conversation_id, store_id, json.dumps(pedido),
            forma_pagamento, forma_entrega, valor_total,
            valor_bruto, desconto_aplicado)
```

- [ ] **Step 2: Atualizar o `FakeDB.upsert_lead_order`**

Substitua `chat-service/tests/conftest.py:93-103` por:

```python
    async def upsert_lead_order(self, conversation_id, store_id, pedido,
                                forma_pagamento, forma_entrega, valor_total=None,
                                valor_bruto=None, desconto_aplicado=None):
        self.order_upserts.append(
            {"conversation_id": conversation_id, "store_id": store_id,
             "pedido": pedido, "forma_pagamento": forma_pagamento,
             "forma_entrega": forma_entrega, "valor_total": valor_total,
             "valor_bruto": valor_bruto, "desconto_aplicado": desconto_aplicado})
        # reflete o estado para leituras subsequentes de get_lead no mesmo teste
        if self.lead is None:
            self.lead = {}
        self.lead.update({"pedido": pedido, "forma_pagamento": forma_pagamento,
                          "forma_entrega": forma_entrega, "valor_total": valor_total,
                          "valor_bruto": valor_bruto,
                          "desconto_aplicado": desconto_aplicado})
```

- [ ] **Step 3: Rodar a suíte (ainda deve passar — assinatura retrocompatível)**

Run: `cd "C:/LUE FZ/chat-service" && python -m pytest tests/ -q`
Expected: PASS (mesma contagem de antes; os novos kwargs têm default `None`).

- [ ] **Step 4: Commit**

```bash
git add chat-service/app/db.py chat-service/tests/conftest.py
git commit -m "feat(chat): upsert_lead_order grava valor_bruto e desconto_aplicado"
```

---

## Task 5: `registrar_pedido` aplica o desconto e grava os três valores

Muda a assinatura para receber `store`, calcula bruto → líquido → desconto e grava.

**Files:**
- Modify: `chat-service/app/agent/tools.py:291-307` (`registrar_pedido`)
- Test: `chat-service/tests/test_tools.py` (novos testes + ajuste dos existentes)

- [ ] **Step 1: Ajustar os testes existentes para a nova assinatura**

Em `chat-service/tests/test_tools.py`, todos os testes que chamam
`registrar_pedido(db, "store-1", ...)` passam a usar o fixture `store` e o objeto:

1. Adicione o parâmetro `store` à assinatura de cada teste abaixo e troque
   `"store-1"` por `store` na chamada de `registrar_pedido`. Testes afetados
   (nomes): `test_registrar_pedido_upserts_and_confirms`,
   `test_registrar_pedido_drops_invalid_items`,
   `test_registrar_pedido_calcula_e_grava_valor_total`,
   `test_registrar_pedido_valor_total_none_sem_preco`,
   `test_registrar_pedido_completa_preco_pelo_catalogo`,
   `test_preco_match_ignora_acento_e_espaco`,
   `test_preco_match_nome_encurtado_unico`,
   `test_preco_nao_chuta_quando_ambiguo`,
   `test_registrar_pedido_preco_do_agente_tem_prioridade`.

Exemplo da transformação (aplique o mesmo padrão aos demais):

```python
async def test_registrar_pedido_upserts_and_confirms(db, store):
    itens = [{"produto": "Cropped", "qtd": 2, "tamanho": "P"}]
    out = await registrar_pedido(db, store, "conv-1", itens, "Pix", "Sedex")
    assert db.order_upserts[0]["conversation_id"] == "conv-1"
    assert db.order_upserts[0]["store_id"] == "store-1"
    assert db.order_upserts[0]["pedido"] == [
        {"produto": "Cropped", "qtd": 2, "tamanho": "P", "cor": None, "preco": None}
    ]
    assert db.order_upserts[0]["forma_pagamento"] == "Pix"
    assert db.order_upserts[0]["forma_entrega"] == "Sedex"
    assert "Pix" in out and "Sedex" in out
    assert "2x Cropped" in out
```

> O fixture `store` (em `conftest.py`) não tem desconto nem mínimo, então
> `valor_total` continua igual ao bruto nesses testes — os asserts existentes
> de `valor_total` seguem válidos.

- [ ] **Step 2: Escrever os novos testes de desconto no registro**

Adicione ao fim de `chat-service/tests/test_tools.py`:

```python
async def test_registrar_pedido_grava_bruto_liquido_e_desconto(db):
    store = _store_desc(discount_type="percent_order", discount_value=10.0)
    itens = [{"produto": "Top", "qtd": 2, "preco": 50.0}]
    out = await registrar_pedido(db, store, "conv-1", itens, "Pix", "Sedex")
    up = db.order_upserts[0]
    assert up["valor_bruto"] == 100.0
    assert up["valor_total"] == 90.0
    assert up["desconto_aplicado"] == 10.0
    assert "R$ 90,00" in out
    assert "desconto de atacado" in out


async def test_registrar_pedido_sem_desconto_bruto_igual_liquido(db, store):
    itens = [{"produto": "Top", "qtd": 2, "preco": 50.0}]
    out = await registrar_pedido(db, store, "conv-1", itens, None, None)
    up = db.order_upserts[0]
    assert up["valor_bruto"] == 100.0
    assert up["valor_total"] == 100.0
    assert up["desconto_aplicado"] == 0.0
    assert "desconto de atacado" not in out


async def test_registrar_pedido_minimo_nao_atingido_nao_desconta(db):
    store = _store_desc(discount_type="percent_order", discount_value=10.0,
                        min_order_quantity=12, min_order_logic="all")
    itens = [{"produto": "Top", "qtd": 2, "preco": 50.0}]
    await registrar_pedido(db, store, "conv-1", itens, None, None)
    up = db.order_upserts[0]
    assert up["valor_total"] == 100.0
    assert up["desconto_aplicado"] == 0.0


async def test_registrar_pedido_custom_usa_valor_da_llm(db):
    store = _store_desc(discount_type="custom", discount_custom="5% acima de 10")
    itens = [{"produto": "Top", "qtd": 20, "preco": 5.0}]
    await registrar_pedido(db, store, "conv-1", itens, None, None,
                           valor_com_desconto=95.0)
    up = db.order_upserts[0]
    assert up["valor_bruto"] == 100.0
    assert up["valor_total"] == 95.0
    assert up["desconto_aplicado"] == 5.0
```

- [ ] **Step 3: Rodar os testes e ver falhar**

Run: `cd "C:/LUE FZ/chat-service" && python -m pytest tests/test_tools.py -k registrar_pedido -v`
Expected: FAIL — `registrar_pedido` ainda espera `store_id` string e não aceita
`valor_com_desconto`; os asserts de `valor_bruto`/`desconto_aplicado` quebram.

- [ ] **Step 4: Reescrever `registrar_pedido`**

Substitua `chat-service/app/agent/tools.py:291-307` por:

```python
async def registrar_pedido(db, store, conversation_id: str,
                           itens, forma_pagamento, forma_entrega,
                           valor_com_desconto=None) -> str:
    norm = _normalize_itens(itens)
    await _fill_missing_prices(db, store.id, norm)
    pag = (forma_pagamento or "").strip() or None
    ent = (forma_entrega or "").strip() or None
    valor_bruto = calcular_valor_total(norm)
    valor_total, desconto = aplicar_desconto(
        valor_bruto, store, norm, valor_com_desconto)
    await db.upsert_lead_order(
        conversation_id=conversation_id, store_id=store.id,
        pedido=norm, forma_pagamento=pag, forma_entrega=ent,
        valor_total=valor_total, valor_bruto=valor_bruto,
        desconto_aplicado=desconto)
    total_str = _format_price(valor_total) if valor_total is not None else "não definido"
    com_desc = " (já com desconto de atacado)" if (desconto or 0) > 0 else ""
    return (
        "Pedido atualizado. ESTADO ATUAL (fonte da verdade, responda com base "
        f"exatamente nisto): Itens: {format_pedido(norm)}. "
        f"Total: {total_str}{com_desc}. "
        f"Pagamento: {pag or 'não definido'}. Entrega: {ent or 'não definido'}.")
```

- [ ] **Step 5: Rodar os testes do arquivo e ver passar**

Run: `cd "C:/LUE FZ/chat-service" && python -m pytest tests/test_tools.py -v`
Expected: PASS (todos, incluindo os ajustados e os novos 4).

- [ ] **Step 6: Commit**

```bash
git add chat-service/app/agent/tools.py chat-service/tests/test_tools.py
git commit -m "feat(chat): registrar_pedido aplica desconto e grava bruto/liquido/desconto"
```

---

## Task 6: Tool `REGISTRAR_PEDIDO` aceita `valor_com_desconto` (runner)

Expõe o campo para a LLM e repassa `store` + valor.

**Files:**
- Modify: `chat-service/app/agent/runner.py:64-98` (schema) e `:162-167` (chamada)
- Test: `chat-service/tests/test_runner.py`

- [ ] **Step 1: Escrever o teste que falha**

Adicione ao fim de `chat-service/tests/test_runner.py`:

```python
async def test_registrar_tool_schema_tem_valor_com_desconto(db, llm, store):
    from app.agent.runner import TOOL_SCHEMA_REGISTRAR
    props = TOOL_SCHEMA_REGISTRAR["function"]["parameters"]["properties"]
    assert "valor_com_desconto" in props
    assert props["valor_com_desconto"]["type"] == "number"


async def test_registrar_pedido_repassa_valor_com_desconto(db, llm, store):
    # loja com desconto custom; a LLM manda o total já com desconto
    store.discount_type = "custom"
    store.discount_custom = "5% acima de 10 peças"
    llm.chat_responses = [
        {"tool_calls": [{"id": "c1", "name": "REGISTRAR_PEDIDO",
                         "arguments": '{"itens": [{"produto": "Top", "qtd": 20, '
                                      '"preco": 5.0}], "valor_com_desconto": 95.0}'}]},
        {"content": "Fechado!"},
    ]
    await run_agent(llm, db, store, shown_list="", chat_input="pode fechar",
                    history=[], conversation_id="conv-1")
    assert db.order_upserts[0]["valor_total"] == 95.0
    assert db.order_upserts[0]["desconto_aplicado"] == 5.0
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "C:/LUE FZ/chat-service" && python -m pytest tests/test_runner.py -k valor_com_desconto -v`
Expected: FAIL — schema não tem o campo e a chamada passa `store.id` em vez de `store`.

- [ ] **Step 3: Adicionar o campo ao schema**

Em `chat-service/app/agent/runner.py`, no `TOOL_SCHEMA_REGISTRAR`:

1. Estenda a `description` da função (linha ~68-74), acrescentando ao final do texto:

```
" Quando a regra de desconto da loja for por faixa ou condicional (texto livre, "
"ex.: '5% acima de 20 peças'), calcule o total JÁ COM o desconto e informe em "
"`valor_com_desconto`. Para descontos simples (percentual ou valor fixo por "
"peça) NÃO preencha `valor_com_desconto` — o sistema calcula sozinho."
```

2. Adicione a propriedade dentro de `properties` (após `forma_entrega`, linha ~93):

```python
                "valor_com_desconto": {"type": "number"},
```

(`required` continua só `["itens"]`.)

- [ ] **Step 4: Repassar `store` e o valor na chamada**

Substitua `chat-service/app/agent/runner.py:162-167` por:

```python
            elif call["name"] == REGISTRAR_TOOL_NAME:
                content = await registrar_pedido(
                    db, store, conversation_id,
                    args.get("itens", []), args.get("forma_pagamento"),
                    args.get("forma_entrega"), args.get("valor_com_desconto"))
                log.debug("REGISTRAR_PEDIDO -> %s", content)
```

- [ ] **Step 5: Rodar e ver passar (arquivo todo)**

Run: `cd "C:/LUE FZ/chat-service" && python -m pytest tests/test_runner.py -v`
Expected: PASS (incluindo o `test_registrar_pedido_tool_is_routed` existente).

- [ ] **Step 6: Commit**

```bash
git add chat-service/app/agent/runner.py chat-service/tests/test_runner.py
git commit -m "feat(chat): REGISTRAR_PEDIDO aceita valor_com_desconto e recebe store"
```

---

## Task 7: WhatsApp obrigatório para fechar (prompt)

Reforça no prompt estático que o agente não fecha sem o número.

**Files:**
- Modify: `chat-service/app/agent/prompt.py:94-107` (seção "Lead (captura + fechamento)")
- Test: `chat-service/tests/test_prompt.py`

- [ ] **Step 1: Escrever o teste que falha**

Adicione a `chat-service/tests/test_prompt.py`:

```python
def test_prompt_exige_whatsapp_para_fechar():
    from app.agent.prompt import STATIC_PROMPT
    p = STATIC_PROMPT.lower()
    assert "whatsapp" in p
    # a obrigatoriedade do número para encaminhar/fechar precisa estar explícita
    assert "obrigat" in p
    assert "não encaminh" in p or "nao encaminh" in p
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd "C:/LUE FZ/chat-service" && python -m pytest tests/test_prompt.py -k whatsapp -v`
Expected: FAIL — o prompt atual não tem a regra de obrigatoriedade.

- [ ] **Step 3: Ajustar o prompt**

Em `chat-service/app/agent/prompt.py`, dentro do `STATIC_PROMPT`, logo após o
item 2 da seção "Lead (captura + fechamento)" (a linha que termina em
`...pule direto para o encaminhamento (passo abaixo).`, ~linha 97), insira um
novo parágrafo:

```
O WhatsApp do cliente é OBRIGATÓRIO para fechar: NÃO encaminhe pra loja nem dê o pedido por fechado sem ter o número (WhatsApp com DDD). Vale pra qualquer loja, atacado ou varejo. Se o cliente não passar o número, peça de novo de forma leve numa frase curta, explicando que é por onde a loja confirma o pedido e combina a entrega — e só siga pro encaminhamento depois que ele passar.
```

E ajuste o parágrafo do encaminhamento (~linha 103) trocando a condição
`Quando já houver nome E WhatsApp` para deixar claro que o WhatsApp é o gatilho
obrigatório — substitua aquela linha por:

```
Só faça o encaminhamento quando já houver o WhatsApp do cliente (o nome ajuda, mas o número é o que não pode faltar): na mesma mensagem em que confirmar os dados, avise que um vendedor vai entrar em contato e ofereça os contatos da loja (o WhatsApp e o Instagram da seção "A loja") como alternativa para ele falar direto.
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd "C:/LUE FZ/chat-service" && python -m pytest tests/test_prompt.py -v`
Expected: PASS (o novo teste e os existentes — o prompt continua contendo
`REGISTRAR_PEDIDO` etc.).

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/agent/prompt.py chat-service/tests/test_prompt.py
git commit -m "feat(chat): WhatsApp obrigatorio para fechar o pedido (prompt)"
```

---

## Task 8: Painel — exibir bruto e desconto

Lê as novas colunas e mostra no card do lead.

**Files:**
- Modify: `src/types/database.ts:248-300` (Row/Insert/Update de `leads`)
- Modify: `src/actions/leads.ts:14-31,44,53-70` (interface, select, map)
- Modify: `src/components/leads/LeadsView.tsx:286-297` (bloco VALOR TOTAL)

- [ ] **Step 1: Adicionar as colunas aos tipos do banco**

Em `src/types/database.ts`, dentro do tipo da tabela `leads`, adicione
`valor_bruto` e `desconto_aplicado` nos três blocos. No bloco `Row` (após
`valor_total: number | null`, ~linha 253):

```ts
          valor_bruto: number | null
          desconto_aplicado: number | null
```

No bloco `Insert` (após `valor_total?: number | null`, ~linha 277) e no bloco
`Update` (após `valor_total?: number | null`, ~linha 299), em cada um:

```ts
          valor_bruto?: number | null
          desconto_aplicado?: number | null
```

- [ ] **Step 2: Ler as colunas na action**

Em `src/actions/leads.ts`:

1. Na interface `LeadRow` (após `valorTotal: number | null`, linha 28):

```ts
  valorBruto: number | null
  descontoAplicado: number | null
```

2. No `.select(...)` (linha 44), acrescente `valor_bruto, desconto_aplicado` à
   string (antes de `tipo_cliente`):

```ts
      'id, name, whatsapp, interest_summary, created_at, contacted_at, contacted_by_name, email, cep, conversation_id, pedido, forma_pagamento, forma_entrega, valor_total, valor_bruto, desconto_aplicado, tipo_cliente, carro_chefe',
```

3. No `.map(...)` (após `valorTotal: l.valor_total ?? null,`, linha 67):

```ts
    valorBruto: l.valor_bruto ?? null,
    descontoAplicado: l.desconto_aplicado ?? null,
```

- [ ] **Step 3: Exibir bruto/desconto no card**

Em `src/components/leads/LeadsView.tsx`, substitua o bloco VALOR TOTAL
(linhas 286-297) por:

```tsx
                    <div className="md:col-span-2">
                      <div className="eyebrow text-ink-500">VALOR TOTAL</div>
                      <div className="text-[13px] mt-0.5">
                        {l.valorTotal != null ? (
                          <span className="text-ink-900 font-medium">
                            {formatBRL(l.valorTotal)}
                            {l.descontoAplicado != null &&
                              l.descontoAplicado > 0 &&
                              l.valorBruto != null && (
                                <span className="text-ink-400 font-normal ml-1">
                                  · bruto {formatBRL(l.valorBruto)} · desconto{' '}
                                  {formatBRL(l.descontoAplicado)}
                                </span>
                              )}
                          </span>
                        ) : (
                          <span className="text-ink-400">Não informado</span>
                        )}
                      </div>
                    </div>
```

- [ ] **Step 4: Typecheck**

Run: `cd "C:/LUE FZ" && npx tsc --noEmit`
Expected: sem erros nos arquivos alterados (`leads.ts`, `database.ts`,
`LeadsView.tsx`).

> Se o projeto tiver um script de typecheck próprio (ver `package.json`), use-o
> no lugar (ex.: `npm run typecheck` ou `npm run lint`).

- [ ] **Step 5: Commit**

```bash
git add src/types/database.ts src/actions/leads.ts src/components/leads/LeadsView.tsx
git commit -m "feat(painel): exibe valor bruto e desconto no card do lead"
```

---

## Task 9: Verificação final

- [ ] **Step 1: Rodar toda a suíte do chat-service**

Run: `cd "C:/LUE FZ/chat-service" && python -m pytest tests/ -q`
Expected: PASS (sem falhas, sem erros de coleta).

- [ ] **Step 2: Typecheck do painel**

Run: `cd "C:/LUE FZ" && npx tsc --noEmit`
Expected: sem novos erros.

- [ ] **Step 3: Conferência manual rápida**

Confirme que:
- `leads.valor_total` agora recebe o líquido (com desconto) quando há desconto e
  mínimo atingido; bruto quando não há.
- A migration 049 está pendente de aplicação no Supabase de produção (passo
  manual, documentado na Task 1).

---

## Resumo de cobertura do spec

- Desconto aplicado só com mínimo atingido → Task 2 (`minimo_atacado_atingido`).
- Cálculo por tipo (percent/fixed determinístico, custom via LLM) → Task 3.
- Tool `valor_com_desconto` + repasse → Task 6.
- Gravar bruto/líquido/desconto (migration + persistência) → Tasks 1, 4, 5.
- Retorno coerente pro agente ("já com desconto") → Task 5.
- WhatsApp obrigatório em todas as lojas (via prompt) → Task 7.
- Painel mostra bruto/desconto → Task 8.

## Fora de escopo (do spec)

- Estruturar desconto `custom` em faixas no painel.
- Gate rígido de código para o WhatsApp.
- Recálculo retroativo de pedidos antigos.
```