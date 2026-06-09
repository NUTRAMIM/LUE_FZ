# Agente Python: pedido estruturado, etapas e pagamento/entrega — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao agente Python um roteiro de atendimento estruturado (etapas + FAQ da loja), fazer ele perguntar forma de pagamento/entrega no fechamento, e persistir pedido/pagamento/entrega na tabela `leads` (lido via prompt, gravado via tool), exibindo tudo na Fila de Leads.

**Architecture:** Estado do lead (nome, pedido, pagamento, entrega) é lido do banco e injetado no system prompt a cada turno; gravado via tool nova `REGISTRAR_PEDIDO` durante o turno. As configs da loja (`service_steps`, `faq`) — hoje ignoradas — passam a alimentar o prompt. A UI Next.js (Fila de Leads) ganha os novos campos no painel de detalhes.

**Tech Stack:** Python 3.12, pytest (`asyncio_mode=auto`), asyncpg, OpenAI tool-calling; Next.js 16 / React 19 / TypeScript, Supabase, vitest.

**Convenções de teste deste repo:**
- Testes Python rodam de dentro de `chat-service/`: `cd chat-service && python -m pytest`.
- Fakes em memória em `chat-service/tests/conftest.py` (`FakeDB`, `FakeLLM`, fixture `store`). A camada `app/db.py` (SQL real asyncpg) **não** é testada por unidade — é exercida indiretamente via `FakeDB`. Portanto métodos SQL novos em `app/db.py` são implementados sem teste unitário direto; o comportamento é coberto pelos consumidores (tool, runner, pipeline) contra `FakeDB`.
- Front: typecheck com `npx tsc --noEmit`; não há teste de componente para `LeadsView` — verificação por typecheck + checagem manual no navegador.

---

## File Structure

**chat-service (Python):**
- `supabase/migrations/035_leads_order_fields.sql` — **Create**. Colunas `pedido`/`forma_pagamento`/`forma_entrega` em `leads`.
- `chat-service/app/models.py` — **Modify**. `StoreSettings` ganha `service_steps`, `faq`.
- `chat-service/app/db.py` — **Modify**. `get_store_settings` (busca service_steps/faq), `get_lead` (retorna pedido/pagamento/entrega), novo `upsert_lead_order`.
- `chat-service/app/agent/tools.py` — **Modify**. `_format_pedido`, `_normalize_itens`, `registrar_pedido`.
- `chat-service/app/agent/prompt.py` — **Modify**. Reescrita de `build_system_prompt` com etapas, FAQ, estado e ask de pagamento/entrega.
- `chat-service/app/agent/runner.py` — **Modify**. Schema + roteamento de `REGISTRAR_PEDIDO`; params `conversation_id`/`lead`.
- `chat-service/app/pipeline.py` — **Modify**. Busca lead antes do agente e repassa.
- `chat-service/tests/conftest.py` — **Modify**. Fixture `store` com service_steps/faq; `FakeDB.upsert_lead_order`; `FakeDB.lead` com novos campos.
- `chat-service/tests/test_*.py` — **Modify/Create**. Cobertura das mudanças.

**Front (Next.js):**
- `src/types/database.ts` — **Modify**. Linhas de `leads` (Row/Insert/Update).
- `src/actions/leads.ts` — **Modify**. `LeadRow` + `getLeads`.
- `src/components/leads/LeadsView.tsx` — **Modify**. Campos PEDIDO/PAGAMENTO/ENTREGA no detalhe.

---

## Task 1: Migration das colunas de pedido em `leads`

**Files:**
- Create: `supabase/migrations/035_leads_order_fields.sql`

- [ ] **Step 1: Criar a migration**

Conteúdo de `supabase/migrations/035_leads_order_fields.sql`:

```sql
-- 035_leads_order_fields.sql
-- O agente registra o pedido do cliente (itens), a forma de pagamento e a
-- forma de entrega na ficha do lead. Idempotente: seguro re-rodar.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS pedido          JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS forma_pagamento TEXT,
  ADD COLUMN IF NOT EXISTS forma_entrega   TEXT;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/035_leads_order_fields.sql
git commit -m "feat(db): colunas pedido/forma_pagamento/forma_entrega em leads"
```

> Nota: a aplicação da migration no banco (Supabase) é manual/operacional, fora do escopo de código deste plano. O `ON CONFLICT (conversation_id)` usado na Task 4 depende da constraint `leads_conversation_id_unique` (migration 014), que já existe.

---

## Task 2: `StoreSettings` e `get_store_settings` carregam `service_steps` e `faq`

**Files:**
- Modify: `chat-service/app/models.py`
- Modify: `chat-service/app/db.py`
- Test: `chat-service/tests/test_models.py`

- [ ] **Step 1: Escrever o teste falho**

Adicionar ao fim de `chat-service/tests/test_models.py`:

```python
from app.models import StoreSettings


def test_store_settings_has_service_steps_and_faq_defaults():
    s = StoreSettings(id="x", store_name="Loja")
    assert s.service_steps == []
    assert s.faq == []


def test_store_settings_accepts_service_steps_and_faq():
    s = StoreSettings(
        id="x", store_name="Loja",
        service_steps=["Pergunte o tamanho", "Ofereça combo"],
        faq=[{"pergunta": "Troca?", "resposta": "Em 7 dias."}],
    )
    assert s.service_steps[0] == "Pergunte o tamanho"
    assert s.faq[0]["resposta"] == "Em 7 dias."
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `cd chat-service && python -m pytest tests/test_models.py -k "service_steps" -v`
Expected: FAIL com `TypeError: __init__() got an unexpected keyword argument 'service_steps'`.

- [ ] **Step 3: Adicionar os campos ao dataclass**

Em `chat-service/app/models.py`, no dataclass `StoreSettings`, adicionar os dois campos após `instagram_handle`:

```python
@dataclass
class StoreSettings:
    id: str
    store_name: str
    categories: list[str] = field(default_factory=list)
    payment_methods: list[str] = field(default_factory=list)
    delivery_methods: list[str] = field(default_factory=list)
    service_instructions: str = ""
    seller_phone: str = ""
    instagram_handle: str = ""
    service_steps: list[str] = field(default_factory=list)
    faq: list[dict] = field(default_factory=list)
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `cd chat-service && python -m pytest tests/test_models.py -k "service_steps" -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Buscar `service_steps`/`faq` na query real (sem teste unitário direto)**

Em `chat-service/app/db.py`, método `get_store_settings`, alterar a query e a construção do objeto:

```python
    async def get_store_settings(self, store_id):
        from app.models import StoreSettings
        r = await self._pool.fetchrow(
            """SELECT id::text, store_name, categories, payment_methods,
                      delivery_methods, service_instructions, seller_phone,
                      instagram_handle, service_steps, faq
               FROM store_settings WHERE id = $1""", store_id)
        if r is None:
            return None
        faq = r["faq"]
        if isinstance(faq, str):
            faq = json.loads(faq)
        return StoreSettings(
            id=r["id"], store_name=r["store_name"],
            categories=list(r["categories"] or []),
            payment_methods=list(r["payment_methods"] or []),
            delivery_methods=list(r["delivery_methods"] or []),
            service_instructions=r["service_instructions"] or "",
            seller_phone=r["seller_phone"] or "",
            instagram_handle=r["instagram_handle"] or "",
            service_steps=list(r["service_steps"] or []),
            faq=list(faq or []))
```

(`json` já está importado no topo de `app/db.py`.)

- [ ] **Step 6: Rodar a suíte inteira para garantir que nada quebrou**

Run: `cd chat-service && python -m pytest -q`
Expected: PASS (todos verdes).

- [ ] **Step 7: Commit**

```bash
git add chat-service/app/models.py chat-service/app/db.py chat-service/tests/test_models.py
git commit -m "feat(agent): StoreSettings carrega service_steps e faq do banco"
```

---

## Task 3: `get_lead` retorna campos de pedido + `upsert_lead_order` + fakes

**Files:**
- Modify: `chat-service/app/db.py`
- Modify: `chat-service/tests/conftest.py`

- [ ] **Step 1: Estender a query real `get_lead` (sem teste unitário direto)**

Em `chat-service/app/db.py`, método `get_lead`:

```python
    async def get_lead(self, conversation_id, store_id):
        r = await self._pool.fetchrow(
            """SELECT id::text, name, whatsapp, email, cep,
                      pedido, forma_pagamento, forma_entrega
               FROM leads
               WHERE conversation_id = $1 AND store_id = $2 LIMIT 1""",
            conversation_id, store_id)
        if not r:
            return None
        d = dict(r)
        pedido = d.get("pedido")
        if isinstance(pedido, str):
            d["pedido"] = json.loads(pedido)
        elif pedido is None:
            d["pedido"] = []
        return d
```

- [ ] **Step 2: Adicionar `upsert_lead_order` na query real (sem teste unitário direto)**

Em `chat-service/app/db.py`, adicionar o método (depois de `update_lead_interest`):

```python
    async def upsert_lead_order(self, conversation_id, store_id, pedido,
                                forma_pagamento, forma_entrega):
        await self._pool.execute(
            """INSERT INTO leads (conversation_id, store_id, pedido,
                                  forma_pagamento, forma_entrega, source)
               VALUES ($1, $2, $3::jsonb, $4, $5, 'chat')
               ON CONFLICT (conversation_id) DO UPDATE SET
                 pedido = EXCLUDED.pedido,
                 forma_pagamento = COALESCE(EXCLUDED.forma_pagamento, leads.forma_pagamento),
                 forma_entrega   = COALESCE(EXCLUDED.forma_entrega, leads.forma_entrega),
                 last_seen_at = now()""",
            conversation_id, store_id, json.dumps(pedido),
            forma_pagamento, forma_entrega)
```

- [ ] **Step 3: Atualizar `FakeDB` no conftest**

Em `chat-service/tests/conftest.py`, dentro de `FakeDB.__init__`, adicionar ao final:

```python
        self.order_upserts = []
```

E adicionar o método (depois de `update_lead_interest`):

```python
    async def upsert_lead_order(self, conversation_id, store_id, pedido,
                                forma_pagamento, forma_entrega):
        self.order_upserts.append(
            {"conversation_id": conversation_id, "store_id": store_id,
             "pedido": pedido, "forma_pagamento": forma_pagamento,
             "forma_entrega": forma_entrega})
        # reflete o estado para leituras subsequentes de get_lead no mesmo teste
        if self.lead is None:
            self.lead = {}
        self.lead.update({"pedido": pedido, "forma_pagamento": forma_pagamento,
                          "forma_entrega": forma_entrega})
```

- [ ] **Step 4: Rodar a suíte para garantir que o conftest carrega**

Run: `cd chat-service && python -m pytest -q`
Expected: PASS (sem erros de import/coleta).

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/db.py chat-service/tests/conftest.py
git commit -m "feat(db): get_lead com campos de pedido e upsert_lead_order"
```

---

## Task 4: Tool `registrar_pedido` + formatador de pedido

**Files:**
- Modify: `chat-service/app/agent/tools.py`
- Test: `chat-service/tests/test_tools.py`

- [ ] **Step 1: Escrever os testes falhos**

Adicionar ao fim de `chat-service/tests/test_tools.py`:

```python
from app.agent.tools import registrar_pedido, format_pedido


def test_format_pedido_empty():
    assert format_pedido([]) == "(nenhum item ainda)"


def test_format_pedido_lists_items():
    itens = [
        {"produto": "Cropped rosa", "qtd": 2, "tamanho": "P", "cor": "rosa"},
        {"produto": "Legging", "qtd": 1, "tamanho": "M"},
    ]
    out = format_pedido(itens)
    assert out == "2x Cropped rosa (tam P, cor rosa); 1x Legging (tam M)"


async def test_registrar_pedido_upserts_and_confirms(db):
    itens = [{"produto": "Cropped", "qtd": 2, "tamanho": "P"}]
    out = await registrar_pedido(db, "store-1", "conv-1", itens, "Pix", "Sedex")
    assert db.order_upserts[0]["conversation_id"] == "conv-1"
    assert db.order_upserts[0]["store_id"] == "store-1"
    assert db.order_upserts[0]["pedido"] == [
        {"produto": "Cropped", "qtd": 2, "tamanho": "P", "cor": None, "preco": None}
    ]
    assert db.order_upserts[0]["forma_pagamento"] == "Pix"
    assert db.order_upserts[0]["forma_entrega"] == "Sedex"
    assert "Pix" in out and "Sedex" in out


async def test_registrar_pedido_drops_invalid_items(db):
    itens = [{"produto": "", "qtd": 1}, {"qtd": 3}, {"produto": "Top", "qtd": "x"}]
    await registrar_pedido(db, "store-1", "conv-1", itens, None, None)
    # "" e sem produto são descartados; qtd inválida vira 1
    assert db.order_upserts[0]["pedido"] == [
        {"produto": "Top", "qtd": 1, "tamanho": None, "cor": None, "preco": None}
    ]
    assert db.order_upserts[0]["forma_pagamento"] is None
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd chat-service && python -m pytest tests/test_tools.py -k "registrar or format_pedido" -v`
Expected: FAIL com `ImportError: cannot import name 'registrar_pedido'`.

- [ ] **Step 3: Implementar no `tools.py`**

Adicionar ao fim de `chat-service/app/agent/tools.py`:

```python
def _normalize_itens(itens) -> list:
    norm = []
    for it in itens or []:
        if not isinstance(it, dict):
            continue
        produto = (it.get("produto") or "").strip()
        if not produto:
            continue
        try:
            qtd = int(it.get("qtd", 1))
        except (TypeError, ValueError):
            qtd = 1
        norm.append({
            "produto": produto,
            "qtd": qtd,
            "tamanho": it.get("tamanho") or None,
            "cor": it.get("cor") or None,
            "preco": it.get("preco") if isinstance(it.get("preco"), (int, float)) else None,
        })
    return norm


def format_pedido(itens) -> str:
    norm = _normalize_itens(itens)
    if not norm:
        return "(nenhum item ainda)"
    partes = []
    for it in norm:
        base = f"{it['qtd']}x {it['produto']}"
        extras = []
        if it.get("tamanho"):
            extras.append(f"tam {it['tamanho']}")
        if it.get("cor"):
            extras.append(f"cor {it['cor']}")
        if extras:
            base += " (" + ", ".join(extras) + ")"
        partes.append(base)
    return "; ".join(partes)


async def registrar_pedido(db, store_id: str, conversation_id: str,
                           itens, forma_pagamento, forma_entrega) -> str:
    norm = _normalize_itens(itens)
    pag = (forma_pagamento or "").strip() or None
    ent = (forma_entrega or "").strip() or None
    await db.upsert_lead_order(
        conversation_id=conversation_id, store_id=store_id,
        pedido=norm, forma_pagamento=pag, forma_entrega=ent)
    return (f"Pedido atualizado: {len(norm)} item(ns), "
            f"pagamento {pag or 'não definido'}, entrega {ent or 'não definido'}.")
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd chat-service && python -m pytest tests/test_tools.py -k "registrar or format_pedido" -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/agent/tools.py chat-service/tests/test_tools.py
git commit -m "feat(agent): tool registrar_pedido e formatador de pedido"
```

---

## Task 5: Reescrever `build_system_prompt` (etapas, FAQ, estado, pagamento/entrega)

**Files:**
- Modify: `chat-service/app/agent/prompt.py`
- Modify: `chat-service/tests/conftest.py` (fixture `store` ganha service_steps/faq)
- Test: `chat-service/tests/test_prompt.py`

- [ ] **Step 1: Enriquecer a fixture `store` no conftest**

Em `chat-service/tests/conftest.py`, na fixture `store`, adicionar os dois campos:

```python
@pytest.fixture
def store():
    return StoreSettings(
        id="store-1",
        store_name="LUE",
        categories=["top", "vestido", "calça"],
        payment_methods=["pix", "cartão"],
        delivery_methods=["correios"],
        service_instructions="Atendimento das 9h às 18h.",
        seller_phone="5511999999999",
        instagram_handle="lue",
        service_steps=["Confirme o tamanho antes de fechar"],
        faq=[{"pergunta": "Fazem troca?", "resposta": "Sim, em até 7 dias."}],
    )
```

- [ ] **Step 2: Escrever os testes falhos**

Adicionar ao fim de `chat-service/tests/test_prompt.py`:

```python
import dataclasses


def test_prompt_injects_lead_name_when_present(store):
    p = build_system_prompt(store, shown_list="", lead={"name": "Maria"})
    assert "Maria" in p


def test_prompt_lead_name_empty_when_no_lead(store):
    p = build_system_prompt(store, shown_list="", lead=None)
    # não deve aparecer a chave literal não-substituída
    assert "{{nome_lead}}" not in p


def test_prompt_shows_current_order_state(store):
    lead = {"name": "Ana",
            "pedido": [{"produto": "Cropped", "qtd": 2, "tamanho": "P"}],
            "forma_pagamento": "Pix", "forma_entrega": "Sedex"}
    p = build_system_prompt(store, shown_list="", lead=lead)
    assert "2x Cropped" in p
    assert "Pix" in p
    assert "Sedex" in p


def test_prompt_order_placeholder_when_empty(store):
    p = build_system_prompt(store, shown_list="", lead=None)
    assert "(nenhum item ainda)" in p


def test_prompt_includes_store_service_steps(store):
    p = build_system_prompt(store, shown_list="", lead=None)
    assert "Confirme o tamanho antes de fechar" in p


def test_prompt_includes_store_faq(store):
    p = build_system_prompt(store, shown_list="", lead=None)
    assert "Fazem troca?" in p
    assert "Sim, em até 7 dias." in p


def test_prompt_omits_steps_and_faq_when_store_has_none(store):
    bare = dataclasses.replace(store, service_steps=[], faq=[])
    p = build_system_prompt(bare, shown_list="", lead=None)
    assert "Etapas específicas desta loja" not in p
    assert "Perguntas frequentes" not in p


def test_prompt_documents_registrar_pedido_and_payment_question(store):
    p = build_system_prompt(store, shown_list="", lead=None)
    assert "REGISTRAR_PEDIDO" in p
    assert "forma de pagamento" in p
    assert "forma de entrega" in p
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd chat-service && python -m pytest tests/test_prompt.py -v`
Expected: FAIL (os novos testes falham; `build_system_prompt` ainda não aceita `lead`).

- [ ] **Step 4: Reescrever `prompt.py`**

Substituir o conteúdo inteiro de `chat-service/app/agent/prompt.py` por:

```python
# app/agent/prompt.py
from app.models import StoreSettings
from app.agent.tools import format_pedido


def _steps_block(store: StoreSettings) -> str:
    if not store.service_steps:
        return ""
    linhas = "\n".join(f"- {s}" for s in store.service_steps)
    return f"\n\n# Etapas específicas desta loja\nSiga também estas instruções da loja, sem quebrar o roteiro acima:\n{linhas}"


def _faq_block(store: StoreSettings) -> str:
    if not store.faq:
        return ""
    linhas = []
    for item in store.faq:
        p = (item.get("pergunta") or "").strip()
        r = (item.get("resposta") or "").strip()
        if p and r:
            linhas.append(f"P: {p}\nR: {r}")
    if not linhas:
        return ""
    corpo = "\n\n".join(linhas)
    return f"\n\n# Perguntas frequentes\nUse estas respostas para dúvidas comuns. Não invente o que não estiver aqui:\n{corpo}"


def build_system_prompt(store: StoreSettings, shown_list: str, lead=None) -> str:
    lead = lead or {}
    nome_lead = (lead.get("name") or "").strip()
    pedido_atual = format_pedido(lead.get("pedido") or [])
    forma_pagamento_atual = (lead.get("forma_pagamento") or "").strip() or "(não definido)"
    forma_entrega_atual = (lead.get("forma_entrega") or "").strip() or "(não definido)"

    categorias = ", ".join(store.categories)
    pagamento = ", ".join(store.payment_methods)
    entrega = ", ".join(store.delivery_methods)
    shown = shown_list or "(nenhum)"
    saudacao_nome = f' O cliente já se identificou como "{nome_lead}" — use o nome dele naturalmente, não peça de novo.' if nome_lead else ""

    return f"""# Você
Assistente da loja {store.store_name}. Trata o cliente por "você". Descobre a intenção antes de oferecer produto.{saudacao_nome}

# A loja
Categorias: {categorias}
Pagamento: {pagamento}
Entrega: {entrega}
Instruções: {store.service_instructions}
Contato do vendedor: {store.seller_phone}
Instagram da loja: @{store.instagram_handle}

# Como você fala
Texto corrido, jeito conversa. ZERO markdown na resposta: nunca use **, #, - ou lista numerada.

Varia aberturas — nunca repete a mesma frase de saudação entre mensagens. Após "não" claro do cliente, acolhe sem reformular oferta.

Fala sobre os produtos e sobre o cliente — nunca sobre o que você está fazendo internamente (procurar, filtrar, mudar categoria, etc).
Exemplo ruim: "Não vieram opções diferentes, posso mudar de categoria ou mostrar outro estilo"
Exemplo bom: "Os tops que eu tenho são só esses dois. Mas tenho uns croppeds que combinam — olha:"

# Roteiro do atendimento (etapas)
Siga estas etapas na ordem, com bom senso (pule o que não fizer sentido):
1. Saudação — abertura curta e variada.
2. Descoberta — entenda a intenção do cliente antes de oferecer.
3. Mostrar produtos — use as ferramentas de produto conforme as regras abaixo.
4. Captura de lead + pagamento/entrega — quando houver intenção de compra (ver seção Lead).
5. Encaminhamento — confirme os dados e avise que um vendedor assume.

# Qual ferramenta de produto usar (decida ANTES de chamar qualquer uma)
Para todo pedido de produto, decida pela intenção do cliente:
- Quer VER uma categoria inteira, SEM filtro? Sinais: "me mostra os X", "quais X vocês têm", "quero ver todos os X", "todos os seus X", "me mostre suas X", "lista os X". → use LISTAR_CATEGORIA (mostra TODAS as peças da categoria, ignora o teto de 3).
- Tem filtro ou pergunta pontual (cor, tamanho, preço, ocasião, comparação, "tem X azul?", "qual o preço do Y")? → use BUSCAR_PRODUTOS.
"Todos os X" / "todas as X" SEM nenhum outro qualificador é sempre LISTAR_CATEGORIA, nunca BUSCAR_PRODUTOS. Na dúvida para um pedido de categoria sem filtro, prefira LISTAR_CATEGORIA.

# Buscar produtos (tool BUSCAR_PRODUTOS)
Use quando o cliente perguntar disponibilidade, preço, tamanho, cor, comparação COM algum filtro. Se for a categoria inteira sem filtro, NÃO use esta — use LISTAR_CATEGORIA. Aceita linguagem natural ("blusa azul P"). NUNCA invente produto, preço, tamanho, cor ou estoque.

Parâmetros:
- Consulta: o pedido em linguagem natural
- `category`: a categoria EXATA da lista da loja acima (pedido vago → string vazia)

Quando a tool não traz nada novo (todos resultados já estão em "Já mostrado", ou veio vazio):
1. Escolha entre as Categorias da loja a mais próxima do pedido original.
2. Chame BUSCAR_PRODUTOS lá, sem avisar o cliente.
3. Mostre o resultado com transição natural ("Dessa pegada tô só com esses. Mas tenho croppeds que combinam — olha:").
4. Se essa segunda categoria também esgotar, fala honesto: "Pra essa pegada hoje tô limitado. Quer ver [outra categoria]?"

NUNCA pergunte permissão ("quer que eu procure?"). Decida e aja.

# Categoria inteira (tool LISTAR_CATEGORIA)
Quando o cliente pedir uma categoria INTEIRA, SEM nenhum filtro (ex.: "me mostra os croppeds", "quais tops vocês têm", "queria ver todos os conjuntos"), use LISTAR_CATEGORIA — NÃO use BUSCAR_PRODUTOS. Passe em `categoria` a categoria EXATA da lista da loja acima. Esse caso NÃO respeita o limite de 3: o sistema monta e envia todos os cards das peças em estoque sozinho. Depois que a tool rodar, você escreve só uma frase curta de fecho perguntando se quer ver tamanho ou cor de alguma — não reescreva os produtos. Se o pedido tiver QUALQUER filtro (cor, tamanho, ocasião, preço), use BUSCAR_PRODUTOS.

# Sinônimos e termos aproximados de categoria
O cliente raramente usa o nome exato da categoria. Quando ele usar um sinônimo, plural, diminutivo ou termo aproximado, traduza para a categoria existente mais próxima da lista da loja e use o rótulo EXATO dela — tanto em `categoria` (LISTAR_CATEGORIA) quanto em `category` (BUSCAR_PRODUTOS). Exemplos: "cropped"/"croped"/"croppies" → Croppeds; "shortinho"/"short" → Shorts; "top"/"topzinho"/"regata" → Tops; "macaquinho"/"macacão" → MACACÃO; "calça"/"calças"/"legging" → a mais próxima entre Leggings e Bermudas. Se o termo abranger claramente mais de uma categoria da lista (ex.: "calça" cobre Leggings e Bermudas), pode chamar a tool para cada uma. Só diga que não trabalha com aquilo se NENHUMA categoria da lista corresponder ao pedido.

# Já mostrado nesta conversa
{shown}

Não repita esses produtos. Exceção: se o cliente pedir explicitamente um deles pelo nome.

# Mostrar produto
Máximo 3 produtos por mensagem ao usar BUSCAR_PRODUTOS (não vale pra LISTAR_CATEGORIA). Antes, uma frase curta natural ("achei isso", "olha esses dois"). Envolva CADA produto nas tags [produto] e [/produto] (obrigatórias), com os campos em linhas separadas:

[produto]
Nome do produto
R$ XX
Tamanhos: P, M, G
Cores: rosa, branco
https://link
[/produto]

Omita campo vazio. As tags [produto]...[/produto] vão só em volta de cada produto — a frase curta de abertura fica fora delas.

# Pedido atual deste cliente (fonte da verdade — NÃO dependa da memória)
Itens: {pedido_atual}
Forma de pagamento: {forma_pagamento_atual}
Forma de entrega: {forma_entrega_atual}

Sempre que o cliente confirmar, adicionar ou mudar um item, a forma de pagamento ou a forma de entrega, chame a tool REGISTRAR_PEDIDO com a lista COMPLETA e atualizada de itens (ela substitui o pedido inteiro). Para saber o que já foi pedido, leia os campos acima — nunca reconstrua de cabeça.

# Lead (captura + fechamento)
Quando o cliente demonstrar intenção de compra/reserva ("quero comprar", "vou levar", "reserva pra mim", "como faço pra fechar"):
1. Registre o pedido com REGISTRAR_PEDIDO (itens + o que já souber de pagamento/entrega).
2. Na mesma mensagem, peça de uma vez, em frase corrida natural: nome, WhatsApp, email E pergunte qual a forma de pagamento (opções: {pagamento}) e a forma de entrega (opções: {entrega}) o cliente prefere.

Exemplo: "Show, vou anotar! Pra fechar, me manda seu nome, WhatsApp e email — e me diz como prefere pagar ({pagamento}) e receber ({entrega})?"

Conforme o cliente responder pagamento/entrega, chame REGISTRAR_PEDIDO de novo para gravar.

Quando o cliente compartilhar nome E WhatsApp (mesmo que falte o email), na mesma mensagem em que confirmar os dados avise que um vendedor vai entrar em contato e ofereça os contatos da loja como alternativa para ele falar direto.

Exemplo: "Anotei! Um vendedor vai entrar em contato em breve. Se preferir falar direto, é WhatsApp {store.seller_phone} ou Instagram @{store.instagram_handle}."

NÃO peça os dados antes da intenção de compra. NÃO repita os contatos da loja em todas as mensagens — só na que o cliente acabou de compartilhar nome e número.{_steps_block(store)}{_faq_block(store)}"""
```

- [ ] **Step 5: Rodar os testes do prompt e ver passar**

Run: `cd chat-service && python -m pytest tests/test_prompt.py -v`
Expected: PASS (todos, incluindo os antigos `test_prompt_includes_store_fields` etc.).

- [ ] **Step 6: Rodar a suíte inteira**

Run: `cd chat-service && python -m pytest -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add chat-service/app/agent/prompt.py chat-service/tests/conftest.py chat-service/tests/test_prompt.py
git commit -m "feat(agent): prompt com etapas, FAQ, estado do pedido e ask de pagamento/entrega"
```

---

## Task 6: `runner` — schema e roteamento de `REGISTRAR_PEDIDO` + params `conversation_id`/`lead`

**Files:**
- Modify: `chat-service/app/agent/runner.py`
- Test: `chat-service/tests/test_runner.py`

- [ ] **Step 1: Atualizar o teste existente que lista as tools + escrever testes novos**

Em `chat-service/tests/test_runner.py`:

(a) Atualizar `test_both_tools_offered_to_llm` para incluir a tool nova e renomear:

```python
async def test_all_tools_offered_to_llm(db, llm, store):
    llm.chat_responses = [{"content": "oi"}]
    await run_agent(llm, db, store, shown_list="", chat_input="oi", history=[])
    tool_names = {t["function"]["name"] for t in llm.chat_calls[0]["tools"]}
    assert tool_names == {TOOL_NAME, LISTAR_TOOL_NAME, REGISTRAR_TOOL_NAME}
```

(b) Atualizar o import do topo do arquivo:

```python
from app.agent.runner import run_agent, TOOL_NAME, LISTAR_TOOL_NAME, REGISTRAR_TOOL_NAME
```

(c) Adicionar ao fim do arquivo:

```python
async def test_registrar_pedido_tool_is_routed(db, llm, store):
    llm.chat_responses = [
        {"tool_calls": [{"id": "call_1", "name": REGISTRAR_TOOL_NAME,
                         "arguments": json.dumps({
                             "itens": [{"produto": "Cropped", "qtd": 1, "tamanho": "P"}],
                             "forma_pagamento": "Pix", "forma_entrega": "Sedex"})}]},
        {"content": "Anotado! Um vendedor te chama."},
    ]
    out = await run_agent(llm, db, store, shown_list="", chat_input="quero fechar",
                          history=[], conversation_id="conv-1")
    assert out.text == "Anotado! Um vendedor te chama."
    assert db.order_upserts[0]["conversation_id"] == "conv-1"
    assert db.order_upserts[0]["forma_pagamento"] == "Pix"
    tool_msg = next(m for m in llm.chat_calls[1]["messages"] if m.get("role") == "tool")
    assert "Pedido atualizado" in tool_msg["content"]


async def test_lead_passed_into_system_prompt(db, llm, store):
    llm.chat_responses = [{"content": "oi Maria!"}]
    await run_agent(llm, db, store, shown_list="", chat_input="oi", history=[],
                    conversation_id="conv-1", lead={"name": "Maria"})
    system_msg = llm.chat_calls[0]["messages"][0]
    assert system_msg["role"] == "system"
    assert "Maria" in system_msg["content"]
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd chat-service && python -m pytest tests/test_runner.py -v`
Expected: FAIL com `ImportError: cannot import name 'REGISTRAR_TOOL_NAME'`.

- [ ] **Step 3: Implementar no `runner.py`**

Em `chat-service/app/agent/runner.py`:

(a) Atualizar o import de tools (topo):

```python
from app.agent.tools import buscar_produtos, listar_categoria, registrar_pedido
```

(b) Adicionar a constante junto às outras:

```python
REGISTRAR_TOOL_NAME = "REGISTRAR_PEDIDO"
```

(c) Adicionar o schema após `TOOL_SCHEMA_LISTAR`:

```python
TOOL_SCHEMA_REGISTRAR = {
    "type": "function",
    "function": {
        "name": REGISTRAR_TOOL_NAME,
        "description": (
            "Grava ou atualiza o pedido do cliente, a forma de pagamento e a "
            "forma de entrega na ficha do lead. Chame sempre que o cliente "
            "confirmar/alterar um item, a forma de pagamento ou a forma de "
            "entrega. O campo `itens` SUBSTITUI o pedido inteiro — envie a lista "
            "completa e atualizada."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "itens": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "produto": {"type": "string"},
                            "qtd": {"type": "integer"},
                            "tamanho": {"type": "string"},
                            "cor": {"type": "string"},
                            "preco": {"type": "number"},
                        },
                        "required": ["produto", "qtd"],
                    },
                },
                "forma_pagamento": {"type": "string"},
                "forma_entrega": {"type": "string"},
            },
            "required": ["itens"],
        },
    },
}
```

(d) Alterar a assinatura de `run_agent` e a chamada de prompt:

```python
async def run_agent(llm, db, store, shown_list, chat_input, history,
                    conversation_id=None, lead=None) -> AgentResult:
    messages = [{"role": "system", "content": build_system_prompt(store, shown_list, lead)}]
    messages.extend(history)
    messages.append({"role": "user", "content": chat_input})
```

(e) Adicionar `TOOL_SCHEMA_REGISTRAR` à lista de `tools` na chamada `llm.chat` dentro do loop (a única que oferece tools; a chamada final após o loop continua sem tools):

```python
        resp = await llm.chat(
            model=settings.chat_model, messages=messages,
            tools=[TOOL_SCHEMA, TOOL_SCHEMA_LISTAR, TOOL_SCHEMA_REGISTRAR],
            max_tokens=4096)
```

(f) Adicionar o roteamento no loop de tool calls. O bloco `for call in tool_calls:` passa a ter três ramos:

```python
        for call in tool_calls:
            args = json.loads(call["arguments"])
            log.info("tool call %s args=%s", call["name"], args)
            if call["name"] == LISTAR_TOOL_NAME:
                segmento, ids, resumo = await listar_categoria(
                    db, store.id, args.get("categoria", ""))
                if segmento:
                    product_segments.append(segmento)
                    shown_product_ids.extend(ids)
                log.info("LISTAR_CATEGORIA(%r) -> %d peças", args.get("categoria", ""), len(ids))
                content = resumo
            elif call["name"] == REGISTRAR_TOOL_NAME:
                content = await registrar_pedido(
                    db, store.id, conversation_id,
                    args.get("itens", []), args.get("forma_pagamento"),
                    args.get("forma_entrega"))
                log.info("REGISTRAR_PEDIDO -> %s", content)
            else:
                content = await buscar_produtos(
                    db, llm, store.id, args.get("consulta", ""), args.get("category", ""))
                log.info("BUSCAR_PRODUTOS(consulta=%r, category=%r)",
                         args.get("consulta", ""), args.get("category", ""))
            messages.append({"role": "tool", "tool_call_id": call["id"],
                             "content": content})
```

- [ ] **Step 4: Rodar os testes do runner e ver passar**

Run: `cd chat-service && python -m pytest tests/test_runner.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/agent/runner.py chat-service/tests/test_runner.py
git commit -m "feat(agent): runner roteia REGISTRAR_PEDIDO e recebe conversation_id/lead"
```

---

## Task 7: `pipeline` busca o lead antes do agente e repassa

**Files:**
- Modify: `chat-service/app/pipeline.py`
- Test: `chat-service/tests/test_pipeline.py`

- [ ] **Step 1: Escrever o teste falho**

Adicionar ao fim de `chat-service/tests/test_pipeline.py`:

```python
async def test_lead_state_reaches_agent_prompt(db, llm, store):
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "oi"}]
    db.catalog = []
    db.recent_messages = []
    db.lead = {"id": "lead-1", "name": "Joana", "whatsapp": "55", "email": None,
               "cep": None, "pedido": [{"produto": "Cropped", "qtd": 1}],
               "forma_pagamento": "Pix", "forma_entrega": None}
    llm.chat_responses = [
        {"content": "oi Joana!"},
        {"content": json.dumps({"nome": None, "telefone": None,
                                "email": None, "cep": None})},
        {"content": json.dumps({"is_gap": False, "question": "", "tag": "OUTROS"})},
    ]
    await process_message(db, llm, _payload(mid="msg-1"))
    system_msg = llm.chat_calls[0]["messages"][0]
    assert system_msg["role"] == "system"
    assert "Joana" in system_msg["content"]
    assert "1x Cropped" in system_msg["content"]
    assert "Pix" in system_msg["content"]
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd chat-service && python -m pytest tests/test_pipeline.py -k "lead_state_reaches" -v`
Expected: FAIL (o nome/pedido não aparece no system prompt — o lead ainda não é buscado antes do agente).

- [ ] **Step 3: Implementar no `pipeline.py`**

Em `chat-service/app/pipeline.py`, dentro de `process_message`, alterar o `gather` e a chamada de `run_agent`:

```python
    shown_list, history, lead = await asyncio.gather(
        db.get_shown_products(payload.id_conversa),
        db.get_recent_messages(payload.id_conversa, limit=10),
        db.get_lead(payload.id_conversa, store.id),
    )
    history_msgs = [{"role": m["role"], "content": m["content"]} for m in history]

    agent_input = with_reply_context(buf.chat_input, payload.respondendo_a)
    try:
        result = await run_agent(
            llm, db, store, shown_list, agent_input, history_msgs,
            conversation_id=payload.id_conversa, lead=lead)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd chat-service && python -m pytest tests/test_pipeline.py -v`
Expected: PASS (incluindo os testes antigos — `get_lead` no FakeDB devolve `None` por padrão quando `db.lead` não é setado).

- [ ] **Step 5: Rodar a suíte inteira**

Run: `cd chat-service && python -m pytest -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add chat-service/app/pipeline.py chat-service/tests/test_pipeline.py
git commit -m "feat(agent): pipeline injeta estado do lead no prompt do agente"
```

---

## Task 8: Tipos do banco (`database.ts`) com os novos campos de `leads`

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Adicionar os campos em Row/Insert/Update**

Em `src/types/database.ts`, bloco `leads`:

No `Row` (após `contacted_by_name: string | null`):
```typescript
          pedido: Json
          forma_pagamento: string | null
          forma_entrega: string | null
```

No `Insert` (após `contacted_by_name?: string | null`):
```typescript
          pedido?: Json
          forma_pagamento?: string | null
          forma_entrega?: string | null
```

No `Update` (após `contacted_by_name?: string | null`):
```typescript
          pedido?: Json
          forma_pagamento?: string | null
          forma_entrega?: string | null
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros novos relacionados a `leads`.

- [ ] **Step 3: Commit**

```bash
git add src/types/database.ts
git commit -m "types(db): campos pedido/forma_pagamento/forma_entrega em leads"
```

---

## Task 9: `actions/leads.ts` — `LeadRow` e `getLeads` com pedido/pagamento/entrega

**Files:**
- Modify: `src/actions/leads.ts`

- [ ] **Step 1: Definir o tipo do item de pedido e estender `LeadRow`**

Em `src/actions/leads.ts`, antes de `export interface LeadRow`:

```typescript
export interface PedidoItem {
  produto: string
  qtd: number
  tamanho?: string | null
  cor?: string | null
  preco?: number | null
}
```

Adicionar ao `LeadRow` (após `conversationId`):

```typescript
  pedido: PedidoItem[]
  formaPagamento: string | null
  formaEntrega: string | null
```

- [ ] **Step 2: Selecionar e mapear os campos em `getLeads`**

Alterar o `.select(...)` para incluir as novas colunas:

```typescript
    .select(
      'id, name, whatsapp, interest_summary, created_at, contacted_at, contacted_by_name, email, cep, conversation_id, pedido, forma_pagamento, forma_entrega',
    )
```

E no `.map(...)`, adicionar ao objeto retornado (após `conversationId`):

```typescript
    pedido: Array.isArray(l.pedido) ? (l.pedido as unknown as PedidoItem[]) : [],
    formaPagamento: l.forma_pagamento ?? null,
    formaEntrega: l.forma_entrega ?? null,
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/actions/leads.ts
git commit -m "feat(leads): getLeads retorna pedido, forma de pagamento e entrega"
```

---

## Task 10: UI — campos PEDIDO/PAGAMENTO/ENTREGA no detalhe do lead

**Files:**
- Modify: `src/components/leads/LeadsView.tsx`

- [ ] **Step 1: Adicionar helper de formatação do pedido**

Em `src/components/leads/LeadsView.tsx`, após a função `formatLeadDate`:

```typescript
function formatPedidoItem(item: {
  produto: string
  qtd: number
  tamanho?: string | null
  cor?: string | null
}): string {
  const extras = [
    item.tamanho ? `tam ${item.tamanho}` : null,
    item.cor ? `cor ${item.cor}` : null,
  ].filter(Boolean)
  const base = `${item.qtd}x ${item.produto}`
  return extras.length ? `${base} (${extras.join(', ')})` : base
}
```

- [ ] **Step 2: Renderizar os três campos no painel expandido**

Dentro do bloco `{expandedId === l.id && (...)}`, no grid de detalhes, após o bloco "RESUMO DE INTERESSE" (que tem `className="md:col-span-2"`), adicionar:

```tsx
                    <div className="md:col-span-2">
                      <div className="eyebrow text-ink-500">PEDIDO</div>
                      <div className="text-[13px] mt-0.5">
                        {l.pedido.length > 0 ? (
                          <ul className="text-ink-900 list-none space-y-0.5">
                            {l.pedido.map((item, i) => (
                              <li key={i}>{formatPedidoItem(item)}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-ink-400">Nenhum item</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="eyebrow text-ink-500">FORMA DE PAGAMENTO</div>
                      <div className="text-[13px] mt-0.5">
                        {l.formaPagamento ? (
                          <span className="text-ink-900">{l.formaPagamento}</span>
                        ) : (
                          <span className="text-ink-400">Não informado</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="eyebrow text-ink-500">FORMA DE ENTREGA</div>
                      <div className="text-[13px] mt-0.5">
                        {l.formaEntrega ? (
                          <span className="text-ink-900">{l.formaEntrega}</span>
                        ) : (
                          <span className="text-ink-400">Não informado</span>
                        )}
                      </div>
                    </div>
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Verificação manual no navegador**

Run: `npm run dev`
- Abrir a página de Fila de Leads (`/leads`).
- Expandir "Ver detalhes" de um lead que tenha pedido/pagamento/entrega gravados.
- Confirmar que PEDIDO lista os itens (ex.: "2x Cropped (tam P, cor rosa)"), e que PAGAMENTO/ENTREGA aparecem; leads sem esses dados mostram "Nenhum item"/"Não informado".

- [ ] **Step 5: Commit**

```bash
git add src/components/leads/LeadsView.tsx
git commit -m "feat(leads): exibe pedido, pagamento e entrega no detalhe do lead"
```

---

## Verificação final

- [ ] **Suíte Python verde:** `cd chat-service && python -m pytest -q` → todos passam.
- [ ] **Front typecheck:** `npx tsc --noEmit` → sem erros.
- [ ] **Front tests:** `npm run test` → passa (ou `--passWithNoTests`).
- [ ] **Migration aplicada no Supabase** (passo operacional manual): `035_leads_order_fields.sql`.
- [ ] **Teste manual end-to-end:** conversa de compra → agente pergunta pagamento/entrega junto com os dados → pedido/pagamento/entrega aparecem na Fila de Leads.

## Notas de integração

- **Ordem de execução vs. lead:** `REGISTRAR_PEDIDO` roda durante `run_agent`; o branch `run_lead` roda depois, na mesma linha (`conversation_id`), e só toca em name/whatsapp/email/cep/interest_summary. Sem corrida, sem sobrescrita de pedido.
- **Lead "sem contato":** se o agente registrar pedido antes do cliente dar nome, a linha é criada com `name` nulo; a Fila de Leads já trata isso ("Sem nome"). O `run_lead` completa depois.
- **Aplicar a migration** antes de subir o serviço em produção, senão `get_lead`/`upsert_lead_order` falham por coluna inexistente.
