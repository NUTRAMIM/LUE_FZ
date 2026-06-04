# Envio de Categoria Completa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando o lead pede uma categoria inteira sem filtro, o serviço envia todas as peças em estoque dessa categoria como cards `[produto]` montados por código (sem o LLM redigir a lista).

**Architecture:** Nova tool de LLM `LISTAR_CATEGORIA(categoria)` ao lado de `BUSCAR_PRODUTOS`. A função pura `listar_categoria` lê o catálogo e devolve `(segmento, ids, resumo)`; o runner acumula segmentos/ids e manda só o resumo curto ao LLM. `run_agent` passa a retornar `AgentResult`. O pipeline insere os cards, registra `ai_shown` por id e insere a frase de fecho do LLM. O frontend acelera o ritmo de exibição (1,5s) quando há mais de 8 cards.

**Tech Stack:** Python 3.12 / FastAPI / pytest (asyncio_mode=auto) no backend (`chat-service`); Next.js / TypeScript / Vitest no frontend.

**Spec:** `docs/superpowers/specs/2026-06-03-categoria-completa-design.md`

**Working dir:** todos os comandos `pytest` rodam de dentro de `chat-service/`. Comandos `npm`/`vitest` rodam da raiz do worktree.

---

### Task 1: `AgentResult` dataclass

**Files:**
- Modify: `chat-service/app/models.py` (append após `Context`)
- Test: `chat-service/tests/test_models.py` (append)

- [ ] **Step 1: Write the failing test**

Append em `chat-service/tests/test_models.py`:

```python
from app.models import AgentResult


def test_agent_result_defaults_to_empty_lists():
    r = AgentResult(text="oi")
    assert r.text == "oi"
    assert r.product_segments == []
    assert r.shown_product_ids == []


def test_agent_result_holds_segments_and_ids():
    r = AgentResult(text="fecho", product_segments=["[produto]X[/produto]"],
                    shown_product_ids=["p1", "p2"])
    assert r.product_segments == ["[produto]X[/produto]"]
    assert r.shown_product_ids == ["p1", "p2"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_models.py::test_agent_result_defaults_to_empty_lists -v`
Expected: FAIL — `ImportError: cannot import name 'AgentResult'`

- [ ] **Step 3: Write minimal implementation**

Append no fim de `chat-service/app/models.py` (o arquivo já importa `dataclass`, `field`):

```python
@dataclass
class AgentResult:
    text: str
    product_segments: list[str] = field(default_factory=list)
    shown_product_ids: list[str] = field(default_factory=list)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_models.py -v`
Expected: PASS (todos, incluindo os 2 novos)

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/models.py chat-service/tests/test_models.py
git commit -m "feat(chat): add AgentResult dataclass"
```

---

### Task 2: `get_products_by_category` no DB e no FakeDB

**Files:**
- Modify: `chat-service/app/db.py` (novo método após `get_catalog`, linha ~78)
- Modify: `chat-service/tests/conftest.py` (FakeDB: novo atributo + método)

`get_products_by_category` no `Database` real é um método de fronteira (SQL puro), seguindo o mesmo padrão de `match_documents`/`get_catalog`, que não têm teste unitário. O `FakeDB` ganha uma implementação em memória que honra o contrato (categoria case-insensitive + apenas `is_available`) e é o que os testes da Task 3 usam.

- [ ] **Step 1: Adicionar método ao FakeDB**

Em `chat-service/tests/conftest.py`, no `__init__` do `FakeDB`, após a linha `self.catalog = []` adicione:

```python
        self.category_products = []        # list[dict(id,name,price,brand,tamanhos,cores,image_urls,category,is_available)]
```

E adicione o método ao `FakeDB` (após `get_catalog`):

```python
    async def get_products_by_category(self, store_id, category):
        return [p for p in self.category_products
                if (p.get("category") or "").lower() == category.lower()
                and p.get("is_available", True)]
```

- [ ] **Step 2: Adicionar método de fronteira ao Database real**

Em `chat-service/app/db.py`, após o método `get_catalog` (linha ~78), adicione:

```python
    async def get_products_by_category(self, store_id, category):
        rows = await self._pool.fetch(
            """SELECT id::text, name, price, brand, tamanhos, cores, image_urls
               FROM products
               WHERE user_id = $1 AND lower(category) = lower($2)
                 AND is_available = true
               ORDER BY name""", store_id, category)
        return [dict(r) for r in rows]
```

- [ ] **Step 3: Verificar que a suíte ainda passa**

Run: `pytest -q`
Expected: PASS (nenhum teste novo ainda; nada quebrado)

- [ ] **Step 4: Commit**

```bash
git add chat-service/app/db.py chat-service/tests/conftest.py
git commit -m "feat(chat): add get_products_by_category query and fake"
```

---

### Task 3: Função `listar_categoria` em tools.py

**Files:**
- Modify: `chat-service/app/agent/tools.py` (novos helpers + função)
- Test: `chat-service/tests/test_tools.py` (append)

- [ ] **Step 1: Write the failing tests**

Append em `chat-service/tests/test_tools.py`:

```python
from app.agent.tools import listar_categoria


def _prod(pid, name, category, price=89.9, tamanhos=None, cores=None,
          image_urls=None, is_available=True):
    return {"id": pid, "name": name, "category": category, "price": price,
            "brand": None, "tamanhos": tamanhos if tamanhos is not None else ["P", "M"],
            "cores": cores if cores is not None else ["preto", "branco"],
            "image_urls": image_urls if image_urls is not None else [f"http://img/{pid}.jpg"],
            "is_available": is_available}


async def test_listar_categoria_builds_cards_in_order(db):
    db.category_products = [_prod("p1", "Conjunto Alfa", "Conjuntos")]
    segmento, ids, resumo = await listar_categoria(db, "store-1", "Conjuntos")
    assert ids == ["p1"]
    assert segmento == (
        "[produto]\n"
        "Conjunto Alfa\n"
        "http://img/p1.jpg\n"
        "R$ 89,90\n"
        "Tamanhos: P, M\n"
        "Cores: preto, branco\n"
        "[/produto]"
    )
    assert "Conjuntos" in resumo


async def test_listar_categoria_joins_multiple_cards(db):
    db.category_products = [_prod("p1", "A", "Tops"), _prod("p2", "B", "Tops")]
    segmento, ids, _ = await listar_categoria(db, "store-1", "Tops")
    assert ids == ["p1", "p2"]
    assert segmento.count("[produto]") == 2
    assert segmento == (
        "[produto]\nA\nhttp://img/p1.jpg\nR$ 89,90\nTamanhos: P, M\nCores: preto, branco\n[/produto]\n"
        "[produto]\nB\nhttp://img/p2.jpg\nR$ 89,90\nTamanhos: P, M\nCores: preto, branco\n[/produto]"
    )


async def test_listar_categoria_omits_missing_fields(db):
    db.category_products = [_prod("p1", "Sem Tudo", "Tops", price=None,
                                  tamanhos=[], cores=[], image_urls=[])]
    segmento, ids, _ = await listar_categoria(db, "store-1", "Tops")
    assert segmento == "[produto]\nSem Tudo\n[/produto]"


async def test_listar_categoria_is_case_insensitive(db):
    db.category_products = [_prod("p1", "Conjunto", "Conjuntos")]
    segmento, ids, _ = await listar_categoria(db, "store-1", "conjuntos")
    assert ids == ["p1"]


async def test_listar_categoria_skips_out_of_stock(db):
    db.category_products = [
        _prod("p1", "Em estoque", "Tops"),
        _prod("p2", "Esgotado", "Tops", is_available=False),
    ]
    segmento, ids, _ = await listar_categoria(db, "store-1", "Tops")
    assert ids == ["p1"]
    assert "Esgotado" not in segmento


async def test_listar_categoria_empty_when_no_stock(db):
    db.category_products = []
    segmento, ids, resumo = await listar_categoria(db, "store-1", "Tops")
    assert segmento == ""
    assert ids == []
    assert "Nenhuma" in resumo


async def test_listar_categoria_empty_when_no_category(db):
    segmento, ids, resumo = await listar_categoria(db, "store-1", "  ")
    assert segmento == ""
    assert ids == []


async def test_listar_categoria_summarizes_many_colors(db):
    db.category_products = [_prod("p1", "Multi", "Tops",
                                  cores=[f"c{i}" for i in range(10)])]
    segmento, _, _ = await listar_categoria(db, "store-1", "Tops")
    assert "Cores: c0, c1, c2, c3, c4, c5, c6, c7 (+2 de 10)" in segmento
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_tools.py::test_listar_categoria_builds_cards_in_order -v`
Expected: FAIL — `ImportError: cannot import name 'listar_categoria'`

- [ ] **Step 3: Write minimal implementation**

Em `chat-service/app/agent/tools.py`, adicione no fim do arquivo (já importa `summarize_cores` no mesmo módulo):

```python
def _format_price(price) -> str:
    return f"R$ {price:.2f}".replace(".", ",")


def _build_card(p: dict) -> str:
    lines = [p["name"]]
    urls = p.get("image_urls") or []
    if urls:
        lines.append(urls[0])
    if p.get("price") is not None:
        lines.append(_format_price(p["price"]))
    tamanhos = p.get("tamanhos") or []
    if tamanhos:
        lines.append("Tamanhos: " + ", ".join(tamanhos))
    cores = summarize_cores(p.get("cores") or [])
    if cores:
        lines.append("Cores: " + cores)
    body = "\n".join(lines)
    return f"[produto]\n{body}\n[/produto]"


async def listar_categoria(db, store_id: str, categoria: str):
    cat = (categoria or "").strip()
    if not cat:
        return ("", [], "Categoria não informada.")
    rows = await db.get_products_by_category(store_id, cat)
    if not rows:
        return ("", [], f"Nenhuma peça disponível em {cat}.")
    cards = [_build_card(p) for p in rows]
    ids = [p["id"] for p in rows]
    resumo = (f"Mostrei {len(rows)} peças de {cat} ao cliente. "
              "Escreva só uma frase curta de fecho perguntando se quer ver "
              "tamanho ou cor de alguma.")
    return ("\n".join(cards), ids, resumo)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_tools.py -v`
Expected: PASS (todos, incluindo os 8 novos)

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/agent/tools.py chat-service/tests/test_tools.py
git commit -m "feat(chat): add listar_categoria card builder"
```

---

### Task 4: Tool `LISTAR_CATEGORIA` no runner + `run_agent` retorna `AgentResult`

**Files:**
- Modify: `chat-service/app/agent/runner.py`
- Test: `chat-service/tests/test_runner.py` (atualizar 3 testes existentes + adicionar novos)

Atenção: os 3 testes atuais em `test_runner.py` afirmam `out == "..."`. Como `run_agent` passa a retornar `AgentResult`, eles precisam virar `out.text == "..."`.

- [ ] **Step 1: Atualizar os testes existentes e adicionar os novos**

Substitua todo o conteúdo de `chat-service/tests/test_runner.py` por:

```python
# tests/test_runner.py
import json
from app.agent.runner import run_agent, TOOL_NAME, LISTAR_TOOL_NAME


async def test_returns_text_without_tool_call(db, llm, store):
    llm.chat_responses = [{"content": "oi, tudo bem?"}]
    out = await run_agent(llm, db, store, shown_list="", chat_input="oi", history=[])
    assert out.text == "oi, tudo bem?"
    assert out.product_segments == []
    assert out.shown_product_ids == []


async def test_executes_tool_then_returns_text(db, llm, store):
    db.match_results = [{"content": "Top", "similarity": 0.5,
                         "metadata": {"name": "Top Alça", "category": "top",
                                      "price": 50, "tamanhos": ["P"], "cores": ["rosa"],
                                      "brand": None, "image_url": "http://x"}}]
    llm.chat_responses = [
        {"tool_calls": [{"id": "call_1", "name": TOOL_NAME,
                         "arguments": json.dumps({"consulta": "top", "category": "top"})}]},
        {"content": "achei isso: Top Alça"},
    ]
    out = await run_agent(llm, db, store, shown_list="", chat_input="quero top", history=[])
    assert out.text == "achei isso: Top Alça"
    second_call_msgs = llm.chat_calls[1]["messages"]
    assert any(m.get("role") == "tool" for m in second_call_msgs)


async def test_replayed_tool_calls_use_openai_shape(db, llm, store):
    db.match_results = [{"content": "Top", "similarity": 0.5,
                         "metadata": {"name": "Top Alça", "category": "top",
                                      "price": 50, "tamanhos": ["P"], "cores": ["rosa"],
                                      "brand": None, "image_url": "http://x"}}]
    llm.chat_responses = [
        {"tool_calls": [{"id": "call_1", "name": TOOL_NAME,
                         "arguments": json.dumps({"consulta": "top", "category": "top"})}]},
        {"content": "achei isso: Top Alça"},
    ]
    await run_agent(llm, db, store, shown_list="", chat_input="quero top", history=[])
    second_call_msgs = llm.chat_calls[1]["messages"]
    assistant_msg = next(m for m in second_call_msgs if m.get("role") == "assistant")
    tc = assistant_msg["tool_calls"][0]
    assert tc["type"] == "function"
    assert tc["function"]["name"] == TOOL_NAME
    assert tc["function"]["arguments"] == json.dumps({"consulta": "top", "category": "top"})
    assert "name" not in tc


async def test_listar_categoria_collects_segments_and_ids(db, llm, store):
    db.category_products = [
        {"id": "p1", "name": "Conjunto A", "category": "Conjuntos", "price": 99.9,
         "brand": None, "tamanhos": ["P"], "cores": ["preto"],
         "image_urls": ["http://img/p1.jpg"], "is_available": True},
    ]
    llm.chat_responses = [
        {"tool_calls": [{"id": "call_1", "name": LISTAR_TOOL_NAME,
                         "arguments": json.dumps({"categoria": "Conjuntos"})}]},
        {"content": "Esses são nossos conjuntos! Quer ver algum?"},
    ]
    out = await run_agent(llm, db, store, shown_list="", chat_input="me mostra os conjuntos",
                          history=[])
    assert out.text == "Esses são nossos conjuntos! Quer ver algum?"
    assert out.shown_product_ids == ["p1"]
    assert len(out.product_segments) == 1
    assert "[produto]" in out.product_segments[0]
    # o LLM recebeu apenas o resumo curto, NÃO os cards
    tool_msg = next(m for m in llm.chat_calls[1]["messages"] if m.get("role") == "tool")
    assert "[produto]" not in tool_msg["content"]
    assert "Mostrei 1 peças de Conjuntos" in tool_msg["content"]


async def test_listar_categoria_no_stock_collects_nothing(db, llm, store):
    db.category_products = []
    llm.chat_responses = [
        {"tool_calls": [{"id": "call_1", "name": LISTAR_TOOL_NAME,
                         "arguments": json.dumps({"categoria": "Inexistente"})}]},
        {"content": "Não temos peças nessa categoria agora."},
    ]
    out = await run_agent(llm, db, store, shown_list="", chat_input="me mostra X", history=[])
    assert out.product_segments == []
    assert out.shown_product_ids == []
    assert out.text == "Não temos peças nessa categoria agora."


async def test_both_tools_offered_to_llm(db, llm, store):
    llm.chat_responses = [{"content": "oi"}]
    await run_agent(llm, db, store, shown_list="", chat_input="oi", history=[])
    tool_names = {t["function"]["name"] for t in llm.chat_calls[0]["tools"]}
    assert tool_names == {TOOL_NAME, LISTAR_TOOL_NAME}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_runner.py -v`
Expected: FAIL — `ImportError: cannot import name 'LISTAR_TOOL_NAME'` (e os `out.text` ainda não existem)

- [ ] **Step 3: Write implementation**

Substitua todo o conteúdo de `chat-service/app/agent/runner.py` por:

```python
# app/agent/runner.py
import json
from app.config import settings
from app.models import AgentResult
from app.agent.prompt import build_system_prompt
from app.agent.tools import buscar_produtos, listar_categoria

TOOL_NAME = "BUSCAR_PRODUTOS"
LISTAR_TOOL_NAME = "LISTAR_CATEGORIA"
MAX_TOOL_ROUNDS = 5

TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": TOOL_NAME,
        "description": (
            "Busca semântica no catálogo de produtos da loja. Use quando o "
            "cliente pedir produtos COM algum filtro (cor, tamanho, ocasião, "
            "estilo, preço). Na consulta descreva o pedido em linguagem natural. "
            "`category` é a categoria EXATA da loja (string vazia se vago)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "consulta": {"type": "string"},
                "category": {"type": "string"},
            },
            "required": ["consulta", "category"],
        },
    },
}

TOOL_SCHEMA_LISTAR = {
    "type": "function",
    "function": {
        "name": LISTAR_TOOL_NAME,
        "description": (
            "Mostra TODAS as peças de uma categoria de uma vez. Use SOMENTE "
            "quando o cliente pedir a categoria inteira SEM nenhum filtro "
            "(ex.: 'me mostra os conjuntos', 'quais tops vocês têm'). Se houver "
            "qualquer filtro (cor, tamanho, ocasião, preço), use BUSCAR_PRODUTOS. "
            "`categoria` deve ser a categoria EXATA da loja."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "categoria": {"type": "string"},
            },
            "required": ["categoria"],
        },
    },
}


async def run_agent(llm, db, store, shown_list, chat_input, history) -> AgentResult:
    messages = [{"role": "system", "content": build_system_prompt(store, shown_list)}]
    messages.extend(history)
    messages.append({"role": "user", "content": chat_input})

    product_segments: list[str] = []
    shown_product_ids: list[str] = []

    for _ in range(MAX_TOOL_ROUNDS):
        resp = await llm.chat(
            model=settings.chat_model, messages=messages,
            tools=[TOOL_SCHEMA, TOOL_SCHEMA_LISTAR], max_tokens=4096)

        tool_calls = resp.get("tool_calls")
        if not tool_calls:
            return AgentResult(
                text=resp.get("content") or "",
                product_segments=product_segments,
                shown_product_ids=shown_product_ids)

        messages.append({
            "role": "assistant",
            "content": resp.get("content"),
            "tool_calls": [
                {"id": tc["id"], "type": "function",
                 "function": {"name": tc["name"], "arguments": tc["arguments"]}}
                for tc in tool_calls
            ],
        })
        for call in tool_calls:
            args = json.loads(call["arguments"])
            if call["name"] == LISTAR_TOOL_NAME:
                segmento, ids, resumo = await listar_categoria(
                    db, store.id, args.get("categoria", ""))
                if segmento:
                    product_segments.append(segmento)
                    shown_product_ids.extend(ids)
                content = resumo
            else:
                content = await buscar_produtos(
                    db, llm, store.id, args.get("consulta", ""), args.get("category", ""))
            messages.append({"role": "tool", "tool_call_id": call["id"],
                             "content": content})

    resp = await llm.chat(model=settings.chat_model, messages=messages, max_tokens=4096)
    return AgentResult(
        text=resp.get("content") or "",
        product_segments=product_segments,
        shown_product_ids=shown_product_ids)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_runner.py -v`
Expected: PASS (todos, incluindo os novos)

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/agent/runner.py chat-service/tests/test_runner.py
git commit -m "feat(chat): add LISTAR_CATEGORIA tool and AgentResult return"
```

---

### Task 5: Pipeline consome `AgentResult` (insere cards + mentions + fecho)

**Files:**
- Modify: `chat-service/app/pipeline.py:44-56`
- Test: `chat-service/tests/test_pipeline.py` (append)

- [ ] **Step 1: Write the failing test**

Append em `chat-service/tests/test_pipeline.py`:

```python
async def test_category_dump_inserts_cards_then_closing(db, llm, store):
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "me mostra os conjuntos"}]
    db.recent_messages = []
    db.category_products = [
        {"id": "p1", "name": "Conjunto A", "category": "Conjuntos", "price": 99.9,
         "brand": None, "tamanhos": ["P"], "cores": ["preto"],
         "image_urls": ["http://img/p1.jpg"], "is_available": True},
        {"id": "p2", "name": "Conjunto B", "category": "Conjuntos", "price": 79.9,
         "brand": None, "tamanhos": ["M"], "cores": ["branco"],
         "image_urls": ["http://img/p2.jpg"], "is_available": True},
    ]
    llm.chat_responses = [
        {"tool_calls": [{"id": "c1", "name": "LISTAR_CATEGORIA",
                         "arguments": json.dumps({"categoria": "Conjuntos"})}]},
        {"content": "Esses são nossos conjuntos! Quer ver algum?"},
        {"content": json.dumps({"nome": None, "telefone": None,
                                "email": None, "cep": None})},
        {"content": json.dumps({"is_gap": False, "question": "", "tag": "OUTROS"})},
    ]
    await process_message(db, llm, _payload(mid="msg-1"))

    assistant_msgs = [m for m in db.inserted_messages if m["role"] == "assistant"]
    # 1 mensagem de cards (com os dois blocos) + 1 de fecho
    assert len(assistant_msgs) == 2
    assert "[produto]" in assistant_msgs[0]["content"]
    assert "Conjunto A" in assistant_msgs[0]["content"]
    assert "Conjunto B" in assistant_msgs[0]["content"]
    assert assistant_msgs[1]["content"] == "Esses são nossos conjuntos! Quer ver algum?"
    # produtos registrados como ai_shown por id
    shown = [m for m in db.inserted_mentions if m["source"] == "ai_shown"]
    assert {m["product_id"] for m in shown} == {"p1", "p2"}


async def test_category_dump_skips_text_insert_when_empty(db, llm, store):
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "me mostra os conjuntos"}]
    db.recent_messages = []
    db.category_products = [
        {"id": "p1", "name": "Conjunto A", "category": "Conjuntos", "price": 99.9,
         "brand": None, "tamanhos": ["P"], "cores": ["preto"],
         "image_urls": ["http://img/p1.jpg"], "is_available": True},
    ]
    llm.chat_responses = [
        {"tool_calls": [{"id": "c1", "name": "LISTAR_CATEGORIA",
                         "arguments": json.dumps({"categoria": "Conjuntos"})}]},
        {"content": ""},
        {"content": json.dumps({"nome": None, "telefone": None,
                                "email": None, "cep": None})},
        {"content": json.dumps({"is_gap": False, "question": "", "tag": "OUTROS"})},
    ]
    await process_message(db, llm, _payload(mid="msg-1"))
    assistant_msgs = [m for m in db.inserted_messages if m["role"] == "assistant"]
    # só os cards; nenhuma mensagem vazia de fecho
    assert len(assistant_msgs) == 1
    assert "[produto]" in assistant_msgs[0]["content"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_pipeline.py::test_category_dump_inserts_cards_then_closing -v`
Expected: FAIL — `AttributeError: 'str' object has no attribute 'product_segments'` (o pipeline ainda trata o retorno como string)

- [ ] **Step 3: Write implementation**

Em `chat-service/app/pipeline.py`, substitua o bloco das linhas 44-56 (do `agent_input = ...` até a criação do `ctx`) por:

```python
    agent_input = with_reply_context(buf.chat_input, payload.respondendo_a)
    try:
        result = await run_agent(
            llm, db, store, shown_list, agent_input, history_msgs)
    except Exception:
        log.exception("agent failed; inserting instability fallback")
        await db.insert_message(payload.id_conversa, "system", INSTABILITY_MSG)
        return

    for segmento in result.product_segments:
        await db.insert_message(payload.id_conversa, "assistant", segmento)
    for product_id in result.shown_product_ids:
        await db.insert_product_mention(
            store.id, payload.id_conversa, product_id, "ai_shown")
    if result.text:
        await db.insert_message(payload.id_conversa, "assistant", result.text)

    ctx = Context(store=store, conversation_id=payload.id_conversa,
                  chat_input=buf.chat_input, ai_output=result.text)
```

(O `shown_list`/`history_msgs` acima das linhas 44 permanecem inalterados; só o trecho a partir de `agent_input` muda.)

- [ ] **Step 4: Run the full suite**

Run: `pytest -q`
Expected: PASS — incluindo os existentes `test_happy_path_inserts_assistant_and_runs_branches` (caminho normal: `product_segments` vazio → primeira inserção assistant é o texto) e `test_agent_failure_inserts_instability_system_message`.

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/pipeline.py chat-service/tests/test_pipeline.py
git commit -m "feat(chat): pipeline inserts category cards and ai_shown mentions"
```

---

### Task 6: Pacing condicional no `delayForSegment`

**Files:**
- Modify: `src/app/chat/[slug]/components/ai-split.ts:8-9,55-58`
- Test: `src/app/chat/[slug]/components/__tests__/ai-split.test.ts` (append no bloco `describe('delayForSegment')`)

- [ ] **Step 1: Write the failing tests**

Em `src/app/chat/[slug]/components/__tests__/ai-split.test.ts`, atualize o import do topo para incluir as novas constantes:

```typescript
import {
  splitAIMessage,
  delayForSegment,
  PRODUCT_DELAY_MS,
  FAST_PRODUCT_DELAY_MS,
  PRODUCT_BURST_THRESHOLD,
  TEXT_DELAY_MS_PER_CHAR,
} from '../ai-split'
```

E adicione, dentro do `describe('delayForSegment', ...)`, os casos:

```typescript
  it('product with productCount > 8 → FAST_PRODUCT_DELAY_MS', () => {
    expect(
      delayForSegment({ kind: 'product', content: 'any' }, 9),
    ).toBe(FAST_PRODUCT_DELAY_MS)
  })

  it('product with productCount === threshold (8) → PRODUCT_DELAY_MS', () => {
    expect(
      delayForSegment({ kind: 'product', content: 'any' }, PRODUCT_BURST_THRESHOLD),
    ).toBe(PRODUCT_DELAY_MS)
  })

  it('product with no count arg → PRODUCT_DELAY_MS (backward compatible)', () => {
    expect(delayForSegment({ kind: 'product', content: 'any' })).toBe(
      PRODUCT_DELAY_MS,
    )
  })

  it('text delay ignores productCount', () => {
    expect(delayForSegment({ kind: 'text', content: 'abcde' }, 20)).toBe(
      5 * TEXT_DELAY_MS_PER_CHAR,
    )
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/chat/[slug]/components/__tests__/ai-split.test.ts`
Expected: FAIL — `FAST_PRODUCT_DELAY_MS`/`PRODUCT_BURST_THRESHOLD` não exportados

- [ ] **Step 3: Write implementation**

Em `src/app/chat/[slug]/components/ai-split.ts`, após a linha `export const PRODUCT_DELAY_MS = 4_000` adicione:

```typescript
export const FAST_PRODUCT_DELAY_MS = 1_500
export const PRODUCT_BURST_THRESHOLD = 8
```

E substitua a função `delayForSegment` (linhas 55-58) por:

```typescript
export function delayForSegment(seg: AISegment, productCount = 0): number {
  if (seg.kind === 'product') {
    return productCount > PRODUCT_BURST_THRESHOLD
      ? FAST_PRODUCT_DELAY_MS
      : PRODUCT_DELAY_MS
  }
  return seg.content.length * TEXT_DELAY_MS_PER_CHAR
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/chat/[slug]/components/__tests__/ai-split.test.ts`
Expected: PASS (todos, incluindo os antigos de `delayForSegment` que chamam sem o 2º arg)

- [ ] **Step 5: Commit**

```bash
git add "src/app/chat/[slug]/components/ai-split.ts" "src/app/chat/[slug]/components/__tests__/ai-split.test.ts"
git commit -m "feat(chat): faster pacing when product burst exceeds 8 cards"
```

---

### Task 7: `ChatClient` passa `productCount` ao `delayForSegment`

**Files:**
- Modify: `src/app/chat/[slug]/ChatClient.tsx` (`enqueueAI` ~135-153 e o avanço da fila ~189-194)

Não há teste unitário para `ChatClient.tsx` (componente com efeitos/realtime); a verificação é a suíte existente + checagem visual manual no fim.

- [ ] **Step 1: Calcular `productCount` no enqueue e usar na primeira emissão**

Em `src/app/chat/[slug]/ChatClient.tsx`, dentro de `enqueueAI`, logo após `const segments = splitAIMessage(msg.content)` (linha ~135) adicione:

```typescript
    const productCount = segments.filter((s) => s.kind === 'product').length
```

E na construção da `queue`, troque a linha `nextEmitAt: now + delayForSegment(segments[0]),` (linha ~151) por:

```typescript
      nextEmitAt: now + delayForSegment(segments[0], productCount),
```

- [ ] **Step 2: Usar `productCount` no avanço da fila**

No trecho que avança a fila (linha ~192), troque
`nextEmitAt: now + delayForSegment(q.segments[nextIdx]),` por:

```typescript
      nextEmitAt:
        now +
        delayForSegment(
          q.segments[nextIdx],
          q.segments.filter((s) => s.kind === 'product').length,
        ),
```

- [ ] **Step 3: Rodar a suíte do frontend**

Run: `npx vitest run`
Expected: PASS (nada quebrado)

- [ ] **Step 4: Commit**

```bash
git add "src/app/chat/[slug]/ChatClient.tsx"
git commit -m "feat(chat): pass product count to segment pacing"
```

---

### Task 8: Validação manual end-to-end

**Files:** nenhum (verificação)

- [ ] **Step 1: Rodar as duas suítes completas**

Run (de `chat-service/`): `pytest -q` → Expected: todos PASS
Run (da raiz): `npx vitest run` → Expected: todos PASS

- [ ] **Step 2: Subir os serviços e testar no navegador**

Subir uvicorn (porta 8000, com `SSL_CERT_FILE` apontando pro bundle combinado) e `npm run dev` (porta do worktree). No chat:
- Pedir "me mostra os conjuntos" (categoria sem filtro) → conferir que vários cards aparecem com ordem **nome → imagem → preço → tamanhos → cores**, seguidos da frase de fecho do LLM.
- Conferir o ritmo: categoria com > 8 peças deve emitir cards a ~1,5s; com ≤ 8, a ~4s.
- Pedir "tem conjunto azul P?" (com filtro) → conferir que continua usando a busca normal (`BUSCAR_PRODUTOS`), no máximo 3 itens.
- Pedir uma categoria sem estoque → conferir que a IA avisa que não há peças e não despeja cards.

- [ ] **Step 3: Reportar resultado**

Se algo divergir do esperado, anotar e abrir tarefa de correção. Se tudo OK, a feature está pronta para finalização da branch.
```
