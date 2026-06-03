# Migração do chat n8n → serviço Python (FastAPI) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o workflow n8n "LUE FZ - Chat Agent" por um serviço Python (FastAPI) que recebe o mesmo webhook, responde o cliente via INSERT em `messages` (entregue por Supabase Realtime) e dispara os mesmos efeitos colaterais (lead, interesse, gap, mentions), já com resumo de cores e dieta de tokens.

**Architecture:** Um container FastAPI. `POST /chat` valida o payload, responde `202` na hora e processa em background (`asyncio`). O background task faz: buffer stateless no Postgres → carrega contexto → agente principal (OpenAI SDK, loop de tool-calling com `buscar_produtos`) → INSERT da resposta → branches paralelos. Sem Redis, sem estado em memória, sem LangChain. Todo SQL fica em `db.py` (asyncpg pool). Os módulos de lógica recebem `db` e `llm` injetados para testar com fakes.

**Tech Stack:** Python 3.12, FastAPI, uvicorn, asyncpg, openai (SDK puro), pydantic v2, pytest + pytest-asyncio. Postgres/pgvector (Supabase) já existente. Modelos: `gpt-5.4-mini` (chat, maxTokens 4096), `text-embedding-3-small` (dimensions 1536).

---

## Estado atual relevante (não redescobrir)

- **Entrega já é Realtime.** `src/app/chat/[slug]/ChatClient.tsx` assina INSERTs em `messages`. O serviço só precisa inserir linhas. A divisão em segmentos é feita no frontend (`ai-split.ts`) — **não** portar o splitter LLM.
- **Payload de entrada** (`src/lib/n8n.ts` → `dispatchToN8n`): `{ mensagem, id_mensagem, id_conversa, nome_loja, id_loja, tipo_de_mensagem, media_url? }`. O n8n lê `body.id_conversa`, `body.mensagem`, `body.id_loja`, `body.id_mensagem`.
- **Schema (colunas reais):**
  - `messages(id, conversation_id, role['user'|'assistant'|'operator'|'system'], content, metadata, message_type['text'|'image'|'audio'] default 'text', media_path, store_id, created_at)`. Trigger preenche `store_id` a partir da conversa no INSERT, então inserir `store_id` é opcional.
  - `store_settings(id, store_name, service_instructions, payment_methods TEXT[], delivery_methods TEXT[], categories TEXT[], seller_phone, instagram_handle, ...)`.
  - `leads(id, name, whatsapp, email, cep, source, conversation_id, store_id, interest_summary, last_seen_at, first_seen_at, ...)`.
  - `knowledge_gaps(id, store_id, conversation_id, question, tag, resolved_at, created_at)`.
  - `product_mentions(id, store_id, conversation_id, product_id, source['ai_shown'|'customer_asked'], created_at)`.
  - `products(id, sku, name, price, category, brand, image_urls TEXT[], cores, tamanhos, user_id, ...)`.
  - `documents` + `match_documents(query_embedding VECTOR(1536), match_count INT DEFAULT 5, filter JSONB DEFAULT '{}', match_threshold FLOAT DEFAULT 0.3) RETURNS (id BIGINT, content TEXT, metadata JSONB, similarity FLOAT)`. `filter` especial: `category` é extraída (`NULLIF(filter->>'category','')`) e o resto vira `strict_filter` (`@>`). `metadata` traz `name, price, category, cores, tamanhos, brand, image_url, user_id, product_id`.
- **Memória de conversa (fase 1):** ler histórico recente de `messages` (n8n usava Postgres Chat Memory; trocamos por leitura direta — decisão do spec).

---

## File Structure

```
chat-service/
├── pyproject.toml             # deps + config pytest
├── Dockerfile
├── .env.example
├── app/
│   ├── __init__.py
│   ├── main.py                # FastAPI: POST /chat → valida, 202, dispara task
│   ├── config.py              # Settings (env vars)
│   ├── models.py              # pydantic: WebhookPayload, StoreSettings, Product, Message, Lead, Context, BufferResult
│   ├── db.py                  # Database (asyncpg pool). Único lugar com SQL.
│   ├── llm.py                 # LLMClient (OpenAI SDK): chat() + embed(). Boundary de rede.
│   ├── buffer.py              # resolve_window(db, conv_id, msg_id, original_input) -> BufferResult
│   ├── pipeline.py            # process_message(db, llm, payload): orquestra o fluxo
│   ├── agent/
│   │   ├── __init__.py
│   │   ├── prompt.py          # build_system_prompt(store, shown_list) -> str
│   │   ├── tools.py           # summarize_cores(...) + buscar_produtos(db, llm, store_id, consulta, category)
│   │   └── runner.py          # run_agent(llm, db, store, shown_list, chat_input, history) -> str
│   └── branches/
│       ├── __init__.py
│       ├── lead.py            # run_lead(db, llm, ctx)
│       ├── gap.py             # run_gap(db, llm, ctx)
│       └── mentions.py        # run_mentions(db, ctx)
└── tests/
    ├── __init__.py
    ├── conftest.py            # FakeDB, FakeLLM, fixtures
    ├── test_models.py
    ├── test_buffer.py
    ├── test_tools.py
    ├── test_prompt.py
    ├── test_runner.py
    ├── test_branch_lead.py
    ├── test_branch_gap.py
    ├── test_branch_mentions.py
    ├── test_pipeline.py
    └── test_main.py
```

**Boundaries:** `db.py` e `llm.py` são as duas fronteiras de I/O. Todo o resto recebe `db`/`llm` por parâmetro e é testado com `FakeDB`/`FakeLLM` (em `conftest.py`). `pipeline.py` é o único que conhece a ordem.

---

### Task 1: Scaffolding do projeto Python

**Files:**
- Create: `chat-service/pyproject.toml`
- Create: `chat-service/.env.example`
- Create: `chat-service/app/__init__.py` (vazio)
- Create: `chat-service/app/agent/__init__.py` (vazio)
- Create: `chat-service/app/branches/__init__.py` (vazio)
- Create: `chat-service/tests/__init__.py` (vazio)

Config files — exceção justificada ao TDD (não há comportamento a testar).

- [ ] **Step 1: Criar `pyproject.toml`**

```toml
[project]
name = "lue-chat-service"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "asyncpg>=0.30",
    "openai>=1.54",
    "pydantic>=2.9",
    "pydantic-settings>=2.6",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.3",
    "pytest-asyncio>=0.24",
    "httpx>=0.27",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.setuptools.packages.find]
where = ["."]
include = ["app*"]
```

- [ ] **Step 2: Criar `.env.example`**

```bash
DATABASE_URL=postgresql://postgres:[senha]@db.[proj].supabase.co:5432/postgres
OPENAI_API_KEY=sk-...
CHAT_MODEL=gpt-5.4-mini
EMBED_MODEL=text-embedding-3-small
BUFFER_WAIT_SECONDS=7
MATCH_COUNT=6
```

- [ ] **Step 3: Criar os 4 `__init__.py` vazios** (`app/`, `app/agent/`, `app/branches/`, `tests/`).

- [ ] **Step 4: Instalar e verificar**

Run: `cd chat-service && python -m venv .venv && .venv\Scripts\pip install -e ".[dev]"`
Expected: instala sem erro. `cd chat-service && .venv\Scripts\pytest` → "no tests ran".

- [ ] **Step 5: Commit**

```bash
git add chat-service/pyproject.toml chat-service/.env.example chat-service/app/__init__.py chat-service/app/agent/__init__.py chat-service/app/branches/__init__.py chat-service/tests/__init__.py
git commit -m "chore(chat-service): scaffold Python FastAPI project"
```

---

### Task 2: Modelos (`models.py`)

**Files:**
- Create: `chat-service/app/models.py`
- Test: `chat-service/tests/test_models.py`

- [ ] **Step 1: Escrever o teste que falha**

```python
# tests/test_models.py
import pytest
from pydantic import ValidationError
from app.models import WebhookPayload


def test_webhook_payload_parses_dispatch_shape():
    p = WebhookPayload.model_validate({
        "mensagem": "oi",
        "id_mensagem": "2689acbf-4fcb-42e6-97b2-fb1e1bd67c8d",
        "id_conversa": "92ee6d49-7dad-47f1-99ad-5f2ff13fc818",
        "nome_loja": "Teste",
        "id_loja": "c96ad899-bdaf-4ed4-919d-6f596e0f7db8",
        "tipo_de_mensagem": "text",
    })
    assert p.mensagem == "oi"
    assert p.id_conversa == "92ee6d49-7dad-47f1-99ad-5f2ff13fc818"
    assert p.media_url is None


def test_webhook_payload_requires_mensagem():
    with pytest.raises(ValidationError):
        WebhookPayload.model_validate({
            "id_mensagem": "x", "id_conversa": "y",
            "nome_loja": "z", "id_loja": "w", "tipo_de_mensagem": "text",
        })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv\Scripts\pytest tests/test_models.py -v`
Expected: FAIL com `ModuleNotFoundError: No module named 'app.models'`.

- [ ] **Step 3: Implementar `models.py`**

```python
# app/models.py
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal
from pydantic import BaseModel


class WebhookPayload(BaseModel):
    mensagem: str
    id_mensagem: str
    id_conversa: str
    nome_loja: str
    id_loja: str
    tipo_de_mensagem: Literal["text", "image", "audio"]
    media_url: str | None = None


@dataclass
class Message:
    id: str
    role: str
    content: str


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


@dataclass
class Product:
    name: str
    price: float | None = None
    category: str | None = None
    brand: str | None = None
    image_url: str | None = None
    tamanhos: list[str] = field(default_factory=list)
    cores: list[str] = field(default_factory=list)


@dataclass
class Lead:
    id: str
    name: str | None = None
    whatsapp: str | None = None
    email: str | None = None
    cep: str | None = None


@dataclass
class BufferResult:
    should_process: bool
    chat_input: str = ""


@dataclass
class Context:
    store: StoreSettings
    conversation_id: str
    chat_input: str
    ai_output: str
```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv\Scripts\pytest tests/test_models.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/models.py chat-service/tests/test_models.py
git commit -m "feat(chat-service): payload and domain models"
```

---

### Task 3: Fakes de teste (`conftest.py`)

**Files:**
- Create: `chat-service/tests/conftest.py`

Infra de teste (fakes do DB e do LLM). Sem teste próprio; será exercitada pelas tasks seguintes.

- [ ] **Step 1: Criar `conftest.py`**

```python
# tests/conftest.py
import pytest
from app.models import StoreSettings


class FakeDB:
    """Implementa a mesma interface de app.db.Database, em memória."""

    def __init__(self):
        self.window_messages = []          # list[dict(id, content)]
        self.store = None                  # StoreSettings | None
        self.shown_list = ""
        self.recent_messages = []          # list[dict(role, content)]
        self.match_results = []            # list[dict(content, metadata, similarity)]
        self.catalog = []                  # list[dict(id, name)]
        self.lead = None                   # dict | None
        self.inserted_messages = []
        self.created_leads = []
        self.updated_leads = []
        self.interest_updates = []
        self.inserted_gaps = []
        self.inserted_mentions = []

    async def get_user_messages_in_window(self, conversation_id):
        return list(self.window_messages)

    async def get_store_settings(self, store_id):
        return self.store

    async def get_shown_products(self, conversation_id):
        return self.shown_list

    async def get_recent_messages(self, conversation_id, limit=10):
        return list(self.recent_messages)

    async def match_documents(self, embedding, match_count, user_id, category):
        # honra o filtro de categoria do fake quando setado
        if category:
            return [r for r in self.match_results
                    if (r["metadata"].get("category") or "").lower() == category.lower()]
        return list(self.match_results)

    async def get_catalog(self, store_id):
        return list(self.catalog)

    async def insert_message(self, conversation_id, role, content, store_id=None):
        self.inserted_messages.append(
            {"conversation_id": conversation_id, "role": role, "content": content})

    async def get_lead(self, conversation_id, store_id):
        return self.lead

    async def create_lead(self, **kw):
        self.created_leads.append(kw)

    async def update_lead(self, lead_id, **kw):
        self.updated_leads.append({"id": lead_id, **kw})

    async def update_lead_interest(self, conversation_id, store_id, interest_summary):
        self.interest_updates.append(
            {"conversation_id": conversation_id, "store_id": store_id,
             "interest_summary": interest_summary})

    async def insert_knowledge_gap(self, store_id, conversation_id, question, tag):
        self.inserted_gaps.append(
            {"store_id": store_id, "conversation_id": conversation_id,
             "question": question, "tag": tag})

    async def insert_product_mention(self, store_id, conversation_id, product_id, source):
        self.inserted_mentions.append(
            {"store_id": store_id, "conversation_id": conversation_id,
             "product_id": product_id, "source": source})


class FakeLLM:
    """Fila de respostas pré-programadas para chat(); embed() retorna vetor fixo."""

    def __init__(self):
        self.chat_responses = []   # list[dict]: {"content": str} ou {"tool_calls": [...]}
        self.chat_calls = []
        self.embed_calls = []

    async def chat(self, model, messages, tools=None, max_tokens=None):
        self.chat_calls.append({"messages": messages, "tools": tools})
        return self.chat_responses.pop(0)

    async def embed(self, model, text):
        self.embed_calls.append(text)
        return [0.0] * 1536


@pytest.fixture
def db():
    return FakeDB()


@pytest.fixture
def llm():
    return FakeLLM()


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
    )
```

- [ ] **Step 2: Verificar import**

Run: `.venv\Scripts\pytest tests/ -q`
Expected: ainda passa (só `test_models`); conftest carrega sem erro.

- [ ] **Step 3: Commit**

```bash
git add chat-service/tests/conftest.py
git commit -m "test(chat-service): in-memory FakeDB and FakeLLM"
```

---

### Task 4: Buffer (`buffer.py`)

Réplica do "Buffer Check" do n8n: sem mensagens na janela → processa input original; última da janela ≠ minha → aborta; senão junta os `content` com `\n`.

**Files:**
- Create: `chat-service/app/buffer.py`
- Test: `chat-service/tests/test_buffer.py`

- [ ] **Step 1: Escrever o teste que falha**

```python
# tests/test_buffer.py
from app.buffer import resolve_window


async def test_empty_window_processes_original_input(db):
    db.window_messages = []
    res = await resolve_window(db, "conv-1", "msg-1", "olá original")
    assert res.should_process is True
    assert res.chat_input == "olá original"


async def test_not_latest_aborts(db):
    db.window_messages = [{"id": "msg-1", "content": "a"},
                          {"id": "msg-2", "content": "b"}]
    res = await resolve_window(db, "conv-1", "msg-1", "a")
    assert res.should_process is False


async def test_latest_joins_window_contents(db):
    db.window_messages = [{"id": "msg-1", "content": "quero"},
                          {"id": "msg-2", "content": "um top"}]
    res = await resolve_window(db, "conv-1", "msg-2", "um top")
    assert res.should_process is True
    assert res.chat_input == "quero\num top"


async def test_single_message_window(db):
    db.window_messages = [{"id": "msg-1", "content": "oi"}]
    res = await resolve_window(db, "conv-1", "msg-1", "oi")
    assert res.should_process is True
    assert res.chat_input == "oi"
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv\Scripts\pytest tests/test_buffer.py -v`
Expected: FAIL `ModuleNotFoundError: No module named 'app.buffer'`.

- [ ] **Step 3: Implementar `buffer.py`**

```python
# app/buffer.py
from app.models import BufferResult


async def resolve_window(db, conversation_id, my_message_id, original_input) -> BufferResult:
    items = await db.get_user_messages_in_window(conversation_id)
    if not items:
        return BufferResult(should_process=True, chat_input=original_input)

    latest = items[-1]
    if latest["id"] != my_message_id:
        return BufferResult(should_process=False)

    joined = "\n".join(m["content"] for m in items)
    return BufferResult(should_process=True, chat_input=joined)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv\Scripts\pytest tests/test_buffer.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/buffer.py chat-service/tests/test_buffer.py
git commit -m "feat(chat-service): stateless buffer window resolution"
```

---

### Task 5: Resumo de cores (`tools.summarize_cores`)

Função pura (objetivo #2). ≤8 cores → inalterado; >8 → primeiras 8 + "(+N de TOTAL)".

**Files:**
- Create: `chat-service/app/agent/tools.py`
- Test: `chat-service/tests/test_tools.py`

- [ ] **Step 1: Escrever o teste que falha**

```python
# tests/test_tools.py
from app.agent.tools import summarize_cores


def test_few_colors_unchanged():
    cores = ["rosa", "branco", "preto"]
    assert summarize_cores(cores) == "rosa, branco, preto"


def test_exactly_eight_unchanged():
    cores = [f"c{i}" for i in range(8)]
    assert summarize_cores(cores) == ", ".join(cores)


def test_many_colors_sampled_with_count():
    cores = [f"c{i}" for i in range(204)]
    out = summarize_cores(cores)
    assert out == "c0, c1, c2, c3, c4, c5, c6, c7 (+196 de 204)"


def test_empty_returns_empty_string():
    assert summarize_cores([]) == ""
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv\Scripts\pytest tests/test_tools.py -v`
Expected: FAIL `ImportError: cannot import name 'summarize_cores'`.

- [ ] **Step 3: Implementar `summarize_cores` em `tools.py`**

```python
# app/agent/tools.py
import json

KEEP_CORES = 8


def summarize_cores(cores: list[str], keep: int = KEEP_CORES) -> str:
    if not cores:
        return ""
    if len(cores) <= keep:
        return ", ".join(cores)
    visiveis = cores[:keep]
    return f"{', '.join(visiveis)} (+{len(cores) - keep} de {len(cores)})"
```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv\Scripts\pytest tests/test_tools.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/agent/tools.py chat-service/tests/test_tools.py
git commit -m "feat(chat-service): pure color summarization"
```

---

### Task 6: `buscar_produtos` (embed + match_documents + fallback de categoria)

Embed da consulta → `match_documents(match_count=6, filter={user_id, category})` → se vazio e havia categoria, refaz sem categoria → monta lista de produtos com cores resumidas → devolve JSON (resultado de tool para o LLM).

**Files:**
- Modify: `chat-service/app/agent/tools.py`
- Test: `chat-service/tests/test_tools.py`

- [ ] **Step 1: Escrever os testes que falham (adicionar ao arquivo)**

```python
# tests/test_tools.py  (append)
import json
from app.agent.tools import buscar_produtos


def _doc(name, category, cores):
    return {"content": name, "similarity": 0.5,
            "metadata": {"name": name, "category": category, "price": 99.9,
                         "tamanhos": ["P", "M"], "cores": cores,
                         "brand": None, "image_url": f"http://x/{name}"}}


async def test_buscar_produtos_summarizes_colors(db, llm):
    db.match_results = [_doc("Top Alça", "top", [f"c{i}" for i in range(10)])]
    out = await buscar_produtos(db, llm, "store-1", "top floral", "top")
    data = json.loads(out)
    assert data[0]["name"] == "Top Alça"
    assert data[0]["cores"] == "c0, c1, c2, c3, c4, c5, c6, c7 (+2 de 10)"
    assert llm.embed_calls == ["top floral"]


async def test_category_fallback_when_filtered_empty(db, llm):
    # só existe doc na categoria "vestido"; busca por "top" volta vazio e refaz sem categoria
    db.match_results = [_doc("Vestido Longo", "vestido", ["azul"])]
    out = await buscar_produtos(db, llm, "store-1", "algo", "top")
    data = json.loads(out)
    assert len(data) == 1
    assert data[0]["name"] == "Vestido Longo"


async def test_empty_result_returns_empty_list(db, llm):
    db.match_results = []
    out = await buscar_produtos(db, llm, "store-1", "x", "")
    assert json.loads(out) == []
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv\Scripts\pytest tests/test_tools.py -v`
Expected: FAIL `ImportError: cannot import name 'buscar_produtos'`.

- [ ] **Step 3: Implementar `buscar_produtos` (adicionar ao `tools.py`)**

```python
# app/agent/tools.py  (append)
from app.config import settings


async def buscar_produtos(db, llm, store_id: str, consulta: str, category: str) -> str:
    embedding = await llm.embed(settings.embed_model, consulta)
    cat = (category or "").strip()

    rows = await db.match_documents(
        embedding=embedding, match_count=settings.match_count,
        user_id=store_id, category=cat or None)
    if not rows and cat:
        rows = await db.match_documents(
            embedding=embedding, match_count=settings.match_count,
            user_id=store_id, category=None)

    produtos = []
    for r in rows:
        m = r.get("metadata", {})
        produtos.append({
            "name": m.get("name"),
            "price": m.get("price"),
            "category": m.get("category"),
            "brand": m.get("brand"),
            "tamanhos": m.get("tamanhos") or [],
            "cores": summarize_cores(m.get("cores") or []),
            "image_url": m.get("image_url"),
        })
    return json.dumps(produtos, ensure_ascii=False)
```

- [ ] **Step 4: Criar `config.py` (necessário para o import acima)**

```python
# app/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = ""
    openai_api_key: str = ""
    chat_model: str = "gpt-5.4-mini"
    embed_model: str = "text-embedding-3-small"
    buffer_wait_seconds: float = 7.0
    match_count: int = 6


settings = Settings()
```

- [ ] **Step 5: Rodar e ver passar**

Run: `.venv\Scripts\pytest tests/test_tools.py -v`
Expected: PASS (7 passed no arquivo).

- [ ] **Step 6: Commit**

```bash
git add chat-service/app/agent/tools.py chat-service/app/config.py chat-service/tests/test_tools.py
git commit -m "feat(chat-service): buscar_produtos with category fallback and config"
```

---

### Task 7: System prompt (`agent/prompt.py`)

Réplica fiel do system message do "AI Agent2", com campos da loja e a lista "Já mostrado".

**Files:**
- Create: `chat-service/app/agent/prompt.py`
- Test: `chat-service/tests/test_prompt.py`

- [ ] **Step 1: Escrever o teste que falha**

```python
# tests/test_prompt.py
from app.agent.prompt import build_system_prompt


def test_prompt_includes_store_fields(store):
    p = build_system_prompt(store, shown_list="Top Alça")
    assert "Assistente da loja LUE" in p
    assert "Categorias: top, vestido, calça" in p
    assert "Pagamento: pix, cartão" in p
    assert "Entrega: correios" in p
    assert "Atendimento das 9h às 18h." in p
    assert "5511999999999" in p
    assert "@lue" in p
    assert "Top Alça" in p


def test_prompt_shown_list_placeholder_when_empty(store):
    p = build_system_prompt(store, shown_list="")
    assert "(nenhum)" in p
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv\Scripts\pytest tests/test_prompt.py -v`
Expected: FAIL `ModuleNotFoundError: No module named 'app.agent.prompt'`.

- [ ] **Step 3: Implementar `prompt.py`** (texto exato do n8n; arrays unidos por `, `)

```python
# app/agent/prompt.py
from app.models import StoreSettings


def build_system_prompt(store: StoreSettings, shown_list: str) -> str:
    categorias = ", ".join(store.categories)
    pagamento = ", ".join(store.payment_methods)
    entrega = ", ".join(store.delivery_methods)
    shown = shown_list or "(nenhum)"
    return f"""# Você
Assistente da loja {store.store_name}. Trata o cliente por "você". Descobre a intenção antes de oferecer produto.

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

# Buscar produtos (tool BUSCAR_PRODUTOS)
Use sempre que o cliente perguntar disponibilidade, preço, tamanho, cor, comparação. Aceita linguagem natural ("blusa azul P"). NUNCA invente produto, preço, tamanho, cor ou estoque.

Parâmetros:
- Consulta: o pedido em linguagem natural
- `category`: a categoria EXATA da lista da loja acima (pedido vago → string vazia)

Quando a tool não traz nada novo (todos resultados já estão em "Já mostrado", ou veio vazio):
1. Escolha entre as Categorias da loja a mais próxima do pedido original.
2. Chame BUSCAR_PRODUTOS lá, sem avisar o cliente.
3. Mostre o resultado com transição natural ("Dessa pegada tô só com esses. Mas tenho croppeds que combinam — olha:").
4. Se essa segunda categoria também esgotar, fala honesto: "Pra essa pegada hoje tô limitado. Quer ver [outra categoria]?"

NUNCA pergunte permissão ("quer que eu procure?"). Decida e aja.

# Já mostrado nesta conversa
{shown}

Não repita esses produtos. Exceção: se o cliente pedir explicitamente um deles pelo nome.

# Mostrar produto
Máximo 3 produtos por mensagem. Antes, uma frase curta natural ("achei isso", "olha esses dois"). Cada produto em bloco de linhas separadas:

Nome do produto
R$ XX
Tamanhos: P, M, G
Cores: rosa, branco
https://link

Omita campo vazio.

# Lead
Quando o cliente demonstrar intenção de compra/reserva ("quero comprar", "vou levar", "reserva pra mim", "como faço pra fechar"), peça os três dados de uma vez, em uma frase corrida natural.

Exemplo: "Show, vou anotar. Pra te conectar com a gente, manda seu nome, WhatsApp e email?"

Quando o cliente compartilhar nome E WhatsApp (mesmo que falte o email), na mesma mensagem em que confirmar os dados avise que um vendedor vai entrar em contato e ofereça os contatos da loja como alternativa para ele falar direto.

Exemplo: "Anotei, {{nome}}. Um vendedor vai entrar em contato em breve. Se preferir falar direto, é WhatsApp {store.seller_phone} ou Instagram @{store.instagram_handle}."

NÃO peça os dados antes da intenção de compra. NÃO peça um por vez. NÃO repita os contatos da loja em todas as mensagens — só na que o cliente acabou de compartilhar nome e número."""
```

Nota: `{{nome}}` é literal (placeholder de runtime do modelo, não f-string).

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv\Scripts\pytest tests/test_prompt.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/agent/prompt.py chat-service/tests/test_prompt.py
git commit -m "feat(chat-service): system prompt builder (n8n parity)"
```

---

### Task 8: Loop de tool-calling (`agent/runner.py`)

Loop OpenAI: monta messages (system + histórico + chat_input), oferece a tool `BUSCAR_PRODUTOS`; enquanto vier `tool_calls`, executa `buscar_produtos` e devolve o resultado; quando vier texto, retorna.

**Files:**
- Create: `chat-service/app/agent/runner.py`
- Test: `chat-service/tests/test_runner.py`

- [ ] **Step 1: Escrever o teste que falha**

```python
# tests/test_runner.py
import json
from app.agent.runner import run_agent, TOOL_NAME


async def test_returns_text_without_tool_call(db, llm, store):
    llm.chat_responses = [{"content": "oi, tudo bem?"}]
    out = await run_agent(llm, db, store, shown_list="", chat_input="oi", history=[])
    assert out == "oi, tudo bem?"


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
    assert out == "achei isso: Top Alça"
    # a 2ª chamada ao LLM recebeu o resultado da tool no histórico
    second_call_msgs = llm.chat_calls[1]["messages"]
    assert any(m.get("role") == "tool" for m in second_call_msgs)
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv\Scripts\pytest tests/test_runner.py -v`
Expected: FAIL `ModuleNotFoundError: No module named 'app.agent.runner'`.

- [ ] **Step 3: Implementar `runner.py`**

```python
# app/agent/runner.py
import json
from app.config import settings
from app.agent.prompt import build_system_prompt
from app.agent.tools import buscar_produtos

TOOL_NAME = "BUSCAR_PRODUTOS"
MAX_TOOL_ROUNDS = 5

TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": TOOL_NAME,
        "description": (
            "Busca semântica no catálogo de produtos da loja. Use sempre que o "
            "cliente perguntar sobre produtos. Na consulta descreva o pedido em "
            "linguagem natural (cor, ocasião, estilo). `category` é a categoria "
            "EXATA da loja (string vazia se vago)."
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


async def run_agent(llm, db, store, shown_list, chat_input, history) -> str:
    messages = [{"role": "system", "content": build_system_prompt(store, shown_list)}]
    messages.extend(history)
    messages.append({"role": "user", "content": chat_input})

    for _ in range(MAX_TOOL_ROUNDS):
        resp = await llm.chat(
            model=settings.chat_model, messages=messages,
            tools=[TOOL_SCHEMA], max_tokens=4096)

        tool_calls = resp.get("tool_calls")
        if not tool_calls:
            return resp.get("content") or ""

        messages.append({"role": "assistant", "content": resp.get("content"),
                         "tool_calls": tool_calls})
        for call in tool_calls:
            args = json.loads(call["arguments"])
            result = await buscar_produtos(
                db, llm, store.id, args.get("consulta", ""), args.get("category", ""))
            messages.append({"role": "tool", "tool_call_id": call["id"],
                             "content": result})

    # esgotou as rodadas: força uma resposta textual
    resp = await llm.chat(model=settings.chat_model, messages=messages, max_tokens=4096)
    return resp.get("content") or ""
```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv\Scripts\pytest tests/test_runner.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/agent/runner.py chat-service/tests/test_runner.py
git commit -m "feat(chat-service): OpenAI tool-calling agent loop"
```

---

### Task 9: Branch de lead (`branches/lead.py`)

Réplica de: Lead Analyzer (extrai JSON) → se houver dado, upsert por (conversation_id, store_id) → recent messages → Interest Summarizer → update interest.

**Files:**
- Create: `chat-service/app/branches/lead.py`
- Test: `chat-service/tests/test_branch_lead.py`

- [ ] **Step 1: Escrever o teste que falha**

```python
# tests/test_branch_lead.py
import json
from app.branches.lead import run_lead
from app.models import Context, Lead


def _ctx(store, msg="quero comprar, sou a Maria, 11999998888"):
    return Context(store=store, conversation_id="conv-1", chat_input=msg, ai_output="ok")


async def test_no_data_does_nothing(db, llm, store):
    llm.chat_responses = [{"content": json.dumps(
        {"nome": None, "telefone": None, "email": None, "cep": None})}]
    await run_lead(db, llm, _ctx(store, "oi"))
    assert db.created_leads == [] and db.updated_leads == []


async def test_creates_lead_when_absent_then_summarizes(db, llm, store):
    db.lead = None
    db.recent_messages = [{"role": "user", "content": "quero um top"}]
    llm.chat_responses = [
        {"content": json.dumps({"nome": "Maria", "telefone": "5511999998888",
                                "email": None, "cep": None})},
        {"content": "top, tamanho M, cor rosa"},
    ]
    await run_lead(db, llm, _ctx(store))
    assert db.created_leads[0]["name"] == "Maria"
    assert db.created_leads[0]["whatsapp"] == "5511999998888"
    assert db.interest_updates[0]["interest_summary"] == "top, tamanho M, cor rosa"


async def test_updates_existing_lead(db, llm, store):
    db.lead = {"id": "lead-1", "name": None, "whatsapp": None, "email": None, "cep": None}
    db.recent_messages = [{"role": "user", "content": "oi"}]
    llm.chat_responses = [
        {"content": json.dumps({"nome": "João", "telefone": None,
                                "email": "j@x.com", "cep": None})},
        {"content": "null"},
    ]
    await run_lead(db, llm, _ctx(store))
    assert db.updated_leads[0]["id"] == "lead-1"
    assert db.updated_leads[0]["name"] == "João"
    # interest "null" → não atualiza
    assert db.interest_updates == []
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv\Scripts\pytest tests/test_branch_lead.py -v`
Expected: FAIL `ModuleNotFoundError: No module named 'app.branches.lead'`.

- [ ] **Step 3: Implementar `lead.py`**

```python
# app/branches/lead.py
import json
from app.config import settings

LEAD_SYSTEM = """Você é um extrator de informações pessoais. Analise a mensagem do cliente e identifique se ele compartilhou algum destes dados:

- nome (próprio do cliente, ex: "meu nome é João", "sou a Maria")
- telefone (WhatsApp ou fixo — qualquer número com >= 10 dígitos)
- email
- cep (formato 00000-000 ou 00000000)

Retorne APENAS um JSON puro, sem markdown e sem texto adicional, no formato:
{"nome": "João" ou null, "telefone": "5511999999999" ou null, "email": "x@y.com" ou null, "cep": "01310-100" ou null}

Se nada foi compartilhado, retorne:
{"nome": null, "telefone": null, "email": null, "cep": null}

Normalize:
- telefone: somente dígitos, com código do país (Brasil = 55).
- cep: formato 00000-000.
- nome: capitalizado ("João", não "joão")."""

INTEREST_SYSTEM = """Você sintetiza o interesse do cliente para o vendedor humano que vai assumir. Em 1-2 frases (até ~200 caracteres), descreva: categoria/tipo de produto procurado, atributos mencionados (cor, tamanho, ocasião, estilo, faixa de preço). Não invente nada. Se a conversa não revelou interesse claro, devolva exatamente null. Sem markdown, sem aspas, sem prefixar com 'O cliente...' — vá direto ao ponto."""


def _strip_fences(raw: str) -> str:
    s = (raw or "").strip()
    if s.startswith("```"):
        s = s.split("```")[1] if "```" in s[3:] else s
        s = s.replace("json", "", 1).strip("` \n")
    return s.strip()


def _parse_lead(raw: str) -> dict:
    try:
        obj = json.loads(_strip_fences(raw))
        return {"nome": obj.get("nome") or None, "telefone": obj.get("telefone") or None,
                "email": obj.get("email") or None, "cep": obj.get("cep") or None}
    except Exception:
        return {"nome": None, "telefone": None, "email": None, "cep": None}


async def run_lead(db, llm, ctx) -> None:
    resp = await llm.chat(model=settings.chat_model,
                          messages=[{"role": "system", "content": LEAD_SYSTEM},
                                    {"role": "user", "content": ctx.chat_input}])
    parsed = _parse_lead(resp.get("content", ""))
    if not any(parsed.values()):
        return

    existing = await db.get_lead(ctx.conversation_id, ctx.store.id)
    if existing:
        await db.update_lead(
            existing["id"],
            name=parsed["nome"] or existing.get("name"),
            whatsapp=parsed["telefone"] or existing.get("whatsapp"),
            email=parsed["email"] or existing.get("email"),
            cep=parsed["cep"] or existing.get("cep"))
    else:
        await db.create_lead(
            conversation_id=ctx.conversation_id, store_id=ctx.store.id,
            name=parsed["nome"], whatsapp=parsed["telefone"],
            email=parsed["email"], cep=parsed["cep"], source="chat")

    await _summarize_interest(db, llm, ctx)


async def _summarize_interest(db, llm, ctx) -> None:
    recent = await db.get_recent_messages(ctx.conversation_id, limit=10)
    text = "\n".join(f"{m['role']}: {m['content']}" for m in recent)
    resp = await llm.chat(
        model=settings.chat_model,
        messages=[{"role": "system", "content": INTEREST_SYSTEM},
                  {"role": "user", "content": f"Mensagens recentes (mais recente primeiro):\n{text}"}])
    cleaned = _strip_fences(resp.get("content", ""))
    if not cleaned or cleaned.lower() == "null":
        return
    await db.update_lead_interest(ctx.conversation_id, ctx.store.id, cleaned)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv\Scripts\pytest tests/test_branch_lead.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/branches/lead.py chat-service/tests/test_branch_lead.py
git commit -m "feat(chat-service): lead extraction and interest summary branch"
```

---

### Task 10: Branch de gap (`branches/gap.py`)

Réplica do Gap Detector + Parse Gap: detecta pergunta sem resposta nas instruções → insere em `knowledge_gaps`.

**Files:**
- Create: `chat-service/app/branches/gap.py`
- Test: `chat-service/tests/test_branch_gap.py`

- [ ] **Step 1: Escrever o teste que falha**

```python
# tests/test_branch_gap.py
import json
from app.branches.gap import run_gap
from app.models import Context


def _ctx(store, msg):
    return Context(store=store, conversation_id="conv-1", chat_input=msg, ai_output="ok")


async def test_inserts_gap_when_detected(db, llm, store):
    llm.chat_responses = [{"content": json.dumps(
        {"is_gap": True, "question": "vocês entregam em sp?", "tag": "PRAZO"})}]
    await run_gap(db, llm, _ctx(store, "vocês entregam em SP?"))
    assert db.inserted_gaps[0]["question"] == "vocês entregam em sp?"
    assert db.inserted_gaps[0]["tag"] == "PRAZO"


async def test_no_gap_inserts_nothing(db, llm, store):
    llm.chat_responses = [{"content": json.dumps(
        {"is_gap": False, "question": "", "tag": "OUTROS"})}]
    await run_gap(db, llm, _ctx(store, "oi"))
    assert db.inserted_gaps == []


async def test_gap_true_but_empty_question_inserts_nothing(db, llm, store):
    llm.chat_responses = [{"content": json.dumps(
        {"is_gap": True, "question": "", "tag": "OUTROS"})}]
    await run_gap(db, llm, _ctx(store, "?"))
    assert db.inserted_gaps == []
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv\Scripts\pytest tests/test_branch_gap.py -v`
Expected: FAIL `ModuleNotFoundError: No module named 'app.branches.gap'`.

- [ ] **Step 3: Implementar `gap.py`**

```python
# app/branches/gap.py
import json
from app.config import settings
from app.branches.lead import _strip_fences


def _gap_system(store) -> str:
    categorias = ", ".join(store.categories)
    pagamento = ", ".join(store.payment_methods)
    entrega = ", ".join(store.delivery_methods)
    return f"""Você analisa a mensagem do cliente e detecta perguntas que a loja não consegue responder com as instruções abaixo.

Instruções da loja:
- Categorias: {categorias}
- Pagamento: {pagamento}
- Entrega: {entrega}
- Outras: {store.service_instructions}

Retorne APENAS JSON puro, sem markdown, no formato:
{{"is_gap": true|false, "question": "pergunta normalizada em minúsculas", "tag": "POLÍTICA DE ENTREGA"|"PRAZO"|"ATACADO"|"SKU INEXISTENTE"|"PAGAMENTO"|"OUTROS"}}

Marque is_gap=true APENAS se:
- A mensagem contém pergunta concreta (com '?' ou claramente interrogativa).
- A resposta NÃO está nas instruções acima.
- A pergunta NÃO é sobre um produto específico do catálogo (isso é trabalho do vendedor).

Marque is_gap=false se: saudação, comentário, declaração de interesse, pergunta sobre produto/cor/tamanho específico, ou pergunta já coberta pelas instruções acima.

Se is_gap=false, devolva question="" e tag="OUTROS"."""


async def run_gap(db, llm, ctx) -> None:
    resp = await llm.chat(
        model=settings.chat_model,
        messages=[{"role": "system", "content": _gap_system(ctx.store)},
                  {"role": "user", "content": f"Mensagem do cliente: {ctx.chat_input}"}])
    try:
        obj = json.loads(_strip_fences(resp.get("content", "")))
        is_gap = bool(obj.get("is_gap"))
        question = str(obj.get("question") or "").lower().strip()
        tag = str(obj.get("tag") or "OUTROS").upper().strip()
    except Exception:
        return

    if not (is_gap and question):
        return
    await db.insert_knowledge_gap(ctx.store.id, ctx.conversation_id, question, tag)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv\Scripts\pytest tests/test_branch_gap.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/branches/gap.py chat-service/tests/test_branch_gap.py
git commit -m "feat(chat-service): knowledge gap detection branch"
```

---

### Task 11: Branch de mentions (`branches/mentions.py`)

Réplica do "Match Mentions": casa nomes de produto (word-boundary, case-insensitive, nomes mais longos primeiro, sem dupla contagem) no texto da IA (`ai_shown`) e na msg do cliente (`customer_asked`).

**Files:**
- Create: `chat-service/app/branches/mentions.py`
- Test: `chat-service/tests/test_branch_mentions.py`

- [ ] **Step 1: Escrever o teste que falha**

```python
# tests/test_branch_mentions.py
from app.branches.mentions import run_mentions
from app.models import Context


def _ctx(store, ai_output, customer_msg):
    return Context(store=store, conversation_id="conv-1",
                   chat_input=customer_msg, ai_output=ai_output)


async def test_matches_ai_output_and_customer_msg(db, store):
    db.catalog = [{"id": "p1", "name": "Top Alça"}, {"id": "p2", "name": "Vestido Longo"}]
    ctx = _ctx(store, ai_output="olha o Top Alça que achei",
               customer_msg="tem Vestido Longo?")
    await run_mentions(db, ctx)
    pairs = {(m["product_id"], m["source"]) for m in db.inserted_mentions}
    assert ("p1", "ai_shown") in pairs
    assert ("p2", "customer_asked") in pairs


async def test_longest_name_wins_no_double_count(db, store):
    db.catalog = [{"id": "p1", "name": "Top"}, {"id": "p2", "name": "Top Alça"}]
    ctx = _ctx(store, ai_output="o Top Alça é lindo", customer_msg="")
    await run_mentions(db, ctx)
    ids = [m["product_id"] for m in db.inserted_mentions]
    assert ids == ["p2"]   # "Top Alça" consumiu o trecho; "Top" não recasa


async def test_no_match_inserts_nothing(db, store):
    db.catalog = [{"id": "p1", "name": "Top Alça"}]
    ctx = _ctx(store, ai_output="oi tudo bem", customer_msg="bom dia")
    await run_mentions(db, ctx)
    assert db.inserted_mentions == []
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv\Scripts\pytest tests/test_branch_mentions.py -v`
Expected: FAIL `ModuleNotFoundError: No module named 'app.branches.mentions'`.

- [ ] **Step 3: Implementar `mentions.py`**

```python
# app/branches/mentions.py
import re


def _find_matches(text: str, products: list[dict]) -> list[str]:
    buffer = text
    found = []
    for p in products:
        pattern = r"\b" + re.escape(p["name"]) + r"\b"
        if re.search(pattern, buffer, flags=re.IGNORECASE):
            found.append(p["id"])
            buffer = re.sub(pattern, lambda m: " " * len(m.group()),
                            buffer, flags=re.IGNORECASE)
    return found


async def run_mentions(db, ctx) -> None:
    catalog = await db.get_catalog(ctx.store.id)
    products = sorted(
        [p for p in catalog if p.get("id") and p.get("name")],
        key=lambda p: len(p["name"]), reverse=True)

    rows = [(pid, "ai_shown") for pid in _find_matches(ctx.ai_output, products)]
    rows += [(pid, "customer_asked") for pid in _find_matches(ctx.chat_input, products)]

    for product_id, source in rows:
        await db.insert_product_mention(
            ctx.store.id, ctx.conversation_id, product_id, source)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv\Scripts\pytest tests/test_branch_mentions.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/branches/mentions.py chat-service/tests/test_branch_mentions.py
git commit -m "feat(chat-service): product mention matching branch"
```

---

### Task 12: Pipeline (`pipeline.py`)

Orquestra o fluxo da Seção 2 do spec: buffer → (aborta ou) carrega contexto → agente → INSERT resposta → branches paralelos (isolados). Fallback de instabilidade se o agente falhar.

**Files:**
- Create: `chat-service/app/pipeline.py`
- Test: `chat-service/tests/test_pipeline.py`

- [ ] **Step 1: Escrever o teste que falha**

```python
# tests/test_pipeline.py
import json
from app.pipeline import process_message
from app.models import WebhookPayload


def _payload(msg="quero um top", mid="msg-1", conv="conv-1"):
    return WebhookPayload(mensagem=msg, id_mensagem=mid, id_conversa=conv,
                          nome_loja="LUE", id_loja="store-1", tipo_de_mensagem="text")


async def test_aborts_when_not_latest(db, llm, store):
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "a"}, {"id": "msg-2", "content": "b"}]
    await process_message(db, llm, _payload(mid="msg-1"))
    assert db.inserted_messages == []   # abortou no buffer


async def test_happy_path_inserts_assistant_and_runs_branches(db, llm, store):
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "quero um top"}]
    db.catalog = []
    db.recent_messages = []
    llm.chat_responses = [
        {"content": "achei isso pra você"},                       # agente principal
        {"content": json.dumps({"nome": None, "telefone": None,   # lead analyzer (sem dado)
                                "email": None, "cep": None})},
        {"content": json.dumps({"is_gap": False, "question": "", "tag": "OUTROS"})},  # gap
    ]
    await process_message(db, llm, _payload(mid="msg-1"))
    assert db.inserted_messages[0]["role"] == "assistant"
    assert db.inserted_messages[0]["content"] == "achei isso pra você"


async def test_agent_failure_inserts_instability_system_message(db, llm, store):
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "oi"}]

    async def boom(*a, **k):
        raise RuntimeError("openai down")
    llm.chat = boom

    await process_message(db, llm, _payload(mid="msg-1"))
    assert db.inserted_messages[0]["role"] == "system"
    assert "instabilidade" in db.inserted_messages[0]["content"].lower()
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv\Scripts\pytest tests/test_pipeline.py -v`
Expected: FAIL `ModuleNotFoundError: No module named 'app.pipeline'`.

- [ ] **Step 3: Implementar `pipeline.py`**

```python
# app/pipeline.py
import asyncio
import logging
from app.buffer import resolve_window
from app.agent.runner import run_agent
from app.branches.lead import run_lead
from app.branches.gap import run_gap
from app.branches.mentions import run_mentions
from app.models import Context

log = logging.getLogger("chat-service")

INSTABILITY_MSG = "Estamos com instabilidade. Sua mensagem foi recebida."


async def process_message(db, llm, payload) -> None:
    buf = await resolve_window(
        db, payload.id_conversa, payload.id_mensagem, payload.mensagem)
    if not buf.should_process:
        return

    store = await db.get_store_settings(payload.id_loja)
    if store is None:
        log.error("store not found: %s", payload.id_loja)
        return

    shown_list, history = await asyncio.gather(
        db.get_shown_products(payload.id_conversa),
        db.get_recent_messages(payload.id_conversa, limit=10),
    )
    history_msgs = [{"role": m["role"], "content": m["content"]} for m in history]

    try:
        ai_output = await run_agent(
            llm, db, store, shown_list, buf.chat_input, history_msgs)
    except Exception:
        log.exception("agent failed; inserting instability fallback")
        await db.insert_message(payload.id_conversa, "system", INSTABILITY_MSG)
        return

    await db.insert_message(payload.id_conversa, "assistant", ai_output)

    ctx = Context(store=store, conversation_id=payload.id_conversa,
                  chat_input=buf.chat_input, ai_output=ai_output)
    results = await asyncio.gather(
        run_lead(db, llm, ctx),
        run_gap(db, llm, ctx),
        run_mentions(db, ctx),
        return_exceptions=True,
    )
    for r in results:
        if isinstance(r, Exception):
            log.error("branch failed: %r", r)
```

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv\Scripts\pytest tests/test_pipeline.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/pipeline.py chat-service/tests/test_pipeline.py
git commit -m "feat(chat-service): pipeline orchestration with instability fallback"
```

---

### Task 13: HTTP entrypoint (`main.py`)

`POST /chat`: valida payload (`400` se inválido), responde `202` na hora, processa em background.

**Files:**
- Create: `chat-service/app/main.py`
- Test: `chat-service/tests/test_main.py`

- [ ] **Step 1: Escrever o teste que falha**

```python
# tests/test_main.py
from fastapi.testclient import TestClient
import app.main as main_mod


def test_valid_payload_returns_202(monkeypatch):
    captured = {}

    def fake_schedule(payload):
        captured["payload"] = payload

    monkeypatch.setattr(main_mod, "schedule_processing", fake_schedule)
    client = TestClient(main_mod.app)
    resp = client.post("/chat", json={
        "mensagem": "oi", "id_mensagem": "m1", "id_conversa": "c1",
        "nome_loja": "LUE", "id_loja": "s1", "tipo_de_mensagem": "text"})
    assert resp.status_code == 202
    assert captured["payload"].mensagem == "oi"


def test_invalid_payload_returns_422_and_no_schedule(monkeypatch):
    called = {"n": 0}
    monkeypatch.setattr(main_mod, "schedule_processing", lambda p: called.__setitem__("n", 1))
    client = TestClient(main_mod.app)
    resp = client.post("/chat", json={"id_conversa": "c1"})  # falta campos
    assert resp.status_code == 422
    assert called["n"] == 0
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `.venv\Scripts\pytest tests/test_main.py -v`
Expected: FAIL `ModuleNotFoundError: No module named 'app.main'`.

- [ ] **Step 3: Implementar `main.py`**

```python
# app/main.py
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Response
from app.config import settings
from app.models import WebhookPayload
from app.pipeline import process_message
from app.db import Database
from app.llm import LLMClient

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("chat-service")

_db: Database | None = None
_llm: LLMClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _db, _llm
    _db = await Database.create(settings.database_url)
    _llm = LLMClient(settings.openai_api_key)
    yield
    await _db.close()


app = FastAPI(lifespan=lifespan)


async def _run(payload: WebhookPayload):
    try:
        await process_message(_db, _llm, payload)
    except Exception:
        log.exception("process_message crashed")


def schedule_processing(payload: WebhookPayload):
    asyncio.create_task(_run(payload))


@app.post("/chat", status_code=202)
async def chat(payload: WebhookPayload):
    schedule_processing(payload)
    return Response(status_code=202)


@app.get("/health")
async def health():
    return {"ok": True}
```

Nota: validação inválida do pydantic devolve `422` (padrão FastAPI). O teste reflete isso; o spec dizia "400" genérico — `422` é o comportamento idiomático e aceitável.

- [ ] **Step 4: Rodar e ver passar**

Run: `.venv\Scripts\pytest tests/test_main.py -v`
Expected: PASS (2 passed). (Import de `app.db`/`app.llm` exige a Task 14; se rodar antes, criar stubs vazios — mas a ordem recomendada é fazer a Task 14 antes do Step 4. Ver nota abaixo.)

> **Ordem:** implemente `db.py` e `llm.py` (Task 14) ANTES de rodar o Step 4, pois `main.py` os importa. Se preferir, troque a ordem das Tasks 13 e 14.

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/main.py chat-service/tests/test_main.py
git commit -m "feat(chat-service): FastAPI /chat endpoint returning 202"
```

---

### Task 14: Fronteiras de I/O (`db.py` + `llm.py`)

As duas fronteiras reais. Lógica mínima; testadas por smoke/integração leve (não unitário com mock — são justamente o mock dos outros testes).

**Files:**
- Create: `chat-service/app/db.py`
- Create: `chat-service/app/llm.py`

- [ ] **Step 1: Implementar `llm.py`**

```python
# app/llm.py
from openai import AsyncOpenAI


class LLMClient:
    def __init__(self, api_key: str):
        self._client = AsyncOpenAI(api_key=api_key)

    async def chat(self, model, messages, tools=None, max_tokens=None) -> dict:
        kwargs = {"model": model, "messages": messages}
        if tools:
            kwargs["tools"] = tools
        if max_tokens:
            kwargs["max_tokens"] = max_tokens
        resp = await self._client.chat.completions.create(**kwargs)
        msg = resp.choices[0].message
        tool_calls = None
        if msg.tool_calls:
            tool_calls = [{"id": tc.id, "name": tc.function.name,
                           "arguments": tc.function.arguments} for tc in msg.tool_calls]
        return {"content": msg.content, "tool_calls": tool_calls}

    async def embed(self, model, text) -> list[float]:
        resp = await self._client.embeddings.create(
            model=model, input=text, dimensions=1536)
        return resp.data[0].embedding
```

- [ ] **Step 2: Implementar `db.py`** (asyncpg pool; queries idênticas às do n8n)

```python
# app/db.py
import json
import asyncpg


class Database:
    def __init__(self, pool: asyncpg.Pool):
        self._pool = pool

    @classmethod
    async def create(cls, dsn: str) -> "Database":
        pool = await asyncpg.create_pool(dsn, min_size=1, max_size=10)
        return cls(pool)

    async def close(self):
        await self._pool.close()

    async def get_user_messages_in_window(self, conversation_id):
        rows = await self._pool.fetch(
            """SELECT id::text, content FROM messages
               WHERE conversation_id = $1 AND role = 'user'
                 AND created_at >= now() - interval '8 seconds'
               ORDER BY created_at ASC""", conversation_id)
        return [dict(r) for r in rows]

    async def get_store_settings(self, store_id):
        from app.models import StoreSettings
        r = await self._pool.fetchrow(
            """SELECT id::text, store_name, categories, payment_methods,
                      delivery_methods, service_instructions, seller_phone,
                      instagram_handle
               FROM store_settings WHERE id = $1""", store_id)
        if r is None:
            return None
        return StoreSettings(
            id=r["id"], store_name=r["store_name"],
            categories=list(r["categories"] or []),
            payment_methods=list(r["payment_methods"] or []),
            delivery_methods=list(r["delivery_methods"] or []),
            service_instructions=r["service_instructions"] or "",
            seller_phone=r["seller_phone"] or "",
            instagram_handle=r["instagram_handle"] or "")

    async def get_shown_products(self, conversation_id):
        r = await self._pool.fetchrow(
            """SELECT COALESCE(string_agg(DISTINCT p.name, ', '), '') AS shown_list
               FROM product_mentions pm JOIN products p ON p.id = pm.product_id
               WHERE pm.conversation_id = $1 AND pm.source = 'ai_shown'""",
            conversation_id)
        return r["shown_list"] if r else ""

    async def get_recent_messages(self, conversation_id, limit=10):
        rows = await self._pool.fetch(
            """SELECT role, content FROM messages
               WHERE conversation_id = $1
               ORDER BY created_at DESC LIMIT $2""", conversation_id, limit)
        return [dict(r) for r in rows]

    async def match_documents(self, embedding, match_count, user_id, category):
        flt = {"user_id": user_id}
        if category:
            flt["category"] = category
        vec = "[" + ",".join(str(x) for x in embedding) + "]"
        rows = await self._pool.fetch(
            "SELECT id, content, metadata, similarity FROM match_documents($1::vector, $2, $3::jsonb, 0.3)",
            vec, match_count, json.dumps(flt))
        out = []
        for r in rows:
            md = r["metadata"]
            out.append({"content": r["content"],
                        "metadata": json.loads(md) if isinstance(md, str) else md,
                        "similarity": r["similarity"]})
        return out

    async def get_catalog(self, store_id):
        rows = await self._pool.fetch(
            "SELECT id::text, name FROM products WHERE user_id = $1", store_id)
        return [dict(r) for r in rows]

    async def insert_message(self, conversation_id, role, content, store_id=None):
        await self._pool.execute(
            """INSERT INTO messages (conversation_id, role, content, message_type)
               VALUES ($1, $2, $3, 'text')""", conversation_id, role, content)

    async def get_lead(self, conversation_id, store_id):
        r = await self._pool.fetchrow(
            """SELECT id::text, name, whatsapp, email, cep FROM leads
               WHERE conversation_id = $1 AND store_id = $2 LIMIT 1""",
            conversation_id, store_id)
        return dict(r) if r else None

    async def create_lead(self, conversation_id, store_id, name, whatsapp,
                          email, cep, source="chat"):
        await self._pool.execute(
            """INSERT INTO leads (conversation_id, store_id, name, whatsapp,
                                  email, cep, source)
               VALUES ($1, $2, $3, $4, $5, $6, $7)""",
            conversation_id, store_id, name, whatsapp, email, cep, source)

    async def update_lead(self, lead_id, name, whatsapp, email, cep):
        await self._pool.execute(
            """UPDATE leads SET name=$2, whatsapp=$3, email=$4, cep=$5,
                                last_seen_at=now() WHERE id=$1""",
            lead_id, name, whatsapp, email, cep)

    async def update_lead_interest(self, conversation_id, store_id, interest_summary):
        await self._pool.execute(
            """UPDATE leads SET interest_summary=$3
               WHERE conversation_id=$1 AND store_id=$2""",
            conversation_id, store_id, interest_summary)

    async def insert_knowledge_gap(self, store_id, conversation_id, question, tag):
        await self._pool.execute(
            """INSERT INTO knowledge_gaps (store_id, conversation_id, question, tag)
               VALUES ($1, $2, $3, $4)""", store_id, conversation_id, question, tag)

    async def insert_product_mention(self, store_id, conversation_id, product_id, source):
        await self._pool.execute(
            """INSERT INTO product_mentions (store_id, conversation_id, product_id, source)
               VALUES ($1, $2, $3, $4)""", store_id, conversation_id, product_id, source)
```

- [ ] **Step 3: Rodar a suíte inteira**

Run: `.venv\Scripts\pytest -v`
Expected: PASS (todos os testes verdes, incluindo `test_main`). Output limpo.

- [ ] **Step 4: Smoke test contra um Postgres real (opcional, manual)**

Se houver `DATABASE_URL` de teste, rodar:
```python
# scratch (não commitar): python -c
import asyncio; from app.db import Database
async def m():
    db = await Database.create("postgresql://...")
    print(await db.get_store_settings("c96ad899-bdaf-4ed4-919d-6f596e0f7db8"))
    await db.close()
asyncio.run(m())
```
Expected: imprime a `StoreSettings` da loja de teste.

- [ ] **Step 5: Commit**

```bash
git add chat-service/app/db.py chat-service/app/llm.py
git commit -m "feat(chat-service): asyncpg Database and OpenAI LLMClient boundaries"
```

---

### Task 15: Dockerfile + run

**Files:**
- Create: `chat-service/Dockerfile`

- [ ] **Step 1: Criar `Dockerfile`**

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml .
RUN pip install --no-cache-dir .
COPY app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Build local**

Run: `cd chat-service && docker build -t lue-chat-service .`
Expected: build OK.

- [ ] **Step 3: Smoke do container**

Run: `docker run --rm -p 8000:8000 --env-file .env lue-chat-service` e em outro terminal `curl localhost:8000/health`
Expected: `{"ok":true}`.

- [ ] **Step 4: Commit**

```bash
git add chat-service/Dockerfile
git commit -m "chore(chat-service): containerize with uvicorn"
```

---

### Task 16: Cutover do Next.js (loja de teste via env)

Apontar o `dispatchToN8n` para o serviço Python apenas quando uma flag/loja de teste casar; default continua n8n. **Payload inalterado.**

**Files:**
- Modify: `src/lib/n8n.ts`
- Test: `src/lib/__tests__/n8n.test.ts` (criar; verificar se já existe convenção de teste)

> Antes de editar: leia `node_modules/next/dist/docs/` se for tocar em código de runtime do Next (aqui é util puro, mas confira a convenção de testes do repo — `vitest`/`jest`).

- [ ] **Step 1: Escrever o teste que falha** (ajuste o runner ao do repo)

```typescript
// src/lib/__tests__/n8n.test.ts
import { resolveWebhookUrl } from '../n8n'

describe('resolveWebhookUrl', () => {
  it('uses python url for the test store', () => {
    const url = resolveWebhookUrl('store-test-123', {
      N8N_WEBHOOK_URL: 'https://n8n/webhook',
      CHAT_PY_WEBHOOK_URL: 'https://py/chat',
      CHAT_PY_STORE_IDS: 'store-test-123',
    })
    expect(url).toBe('https://py/chat')
  })

  it('falls back to n8n for other stores', () => {
    const url = resolveWebhookUrl('other', {
      N8N_WEBHOOK_URL: 'https://n8n/webhook',
      CHAT_PY_WEBHOOK_URL: 'https://py/chat',
      CHAT_PY_STORE_IDS: 'store-test-123',
    })
    expect(url).toBe('https://n8n/webhook')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- n8n` (ou o runner do repo)
Expected: FAIL `resolveWebhookUrl is not a function`.

- [ ] **Step 3: Implementar em `n8n.ts`**

```typescript
// src/lib/n8n.ts  (adicionar export e usar em dispatchToN8n)
export function resolveWebhookUrl(
  storeId: string,
  env: { N8N_WEBHOOK_URL?: string; CHAT_PY_WEBHOOK_URL?: string; CHAT_PY_STORE_IDS?: string } = process.env,
): string | undefined {
  const pyStores = (env.CHAT_PY_STORE_IDS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  if (env.CHAT_PY_WEBHOOK_URL && pyStores.includes(storeId)) {
    return env.CHAT_PY_WEBHOOK_URL
  }
  return env.N8N_WEBHOOK_URL
}
```

E em `dispatchToN8n`, trocar a resolução da URL:

```typescript
export async function dispatchToN8n(
  payload: N8nDispatchPayload,
): Promise<Response | null> {
  const webhookUrl = resolveWebhookUrl(payload.id_loja)
  if (!webhookUrl) return null
  // ...resto inalterado...
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- n8n`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/lib/n8n.ts src/lib/__tests__/n8n.test.ts
git commit -m "feat(chat): route test store to Python chat service via env flag"
```

---

## Self-Review (preenchido)

**Spec coverage:**
- Estratégia híbrida / paridade → Tasks 4–12, 14 (réplica fiel dos nós n8n).
- Objetivo #1 (tokens): splitter removido (não portado), `topK=6` (Task 6/config), prompt mantido → coberto.
- Objetivo #2 (cores): `summarize_cores` (Task 5) usado em `buscar_produtos` (Task 6) → coberto.
- Objetivos #3 e #4 → explicitamente fase 2, fora deste plano (alinha com o spec).
- Buffer stateless → Task 4 + query real em Task 14.
- Carregar contexto em paralelo → Task 12 (`asyncio.gather`).
- Entrega via INSERT em `messages` (Realtime) → Task 12/14.
- Branches isolados (`return_exceptions=True`) → Task 12.
- Fallback de instabilidade → Task 12 (`role='system'`).
- Error handling (payload inválido `422`, store ausente, agente falha) → Tasks 12, 13.
- Cutover por loja de teste, payload idêntico → Task 16.

**Placeholder scan:** sem TBD/TODO; todo step de código tem código completo. Prompts reproduzidos na íntegra.

**Type consistency:** nomes de métodos do `FakeDB` (Task 3) batem com `Database` (Task 14): `get_user_messages_in_window`, `get_store_settings`, `get_shown_products`, `get_recent_messages`, `match_documents`, `get_catalog`, `insert_message`, `get_lead`, `create_lead`, `update_lead`, `update_lead_interest`, `insert_knowledge_gap`, `insert_product_mention`. `LLMClient.chat/embed` batem com `FakeLLM`. `Context`/`BufferResult`/`StoreSettings` usados de forma consistente.

**Dependência cruzada notável:** `main.py` (Task 13) importa `app.db`/`app.llm` (Task 14) — nota de ordem incluída na Task 13.

---

## Riscos e validação

- **Paridade vs n8n:** rodar lado a lado na loja de teste (Task 16) antes de virar a chave para todas as lojas e desligar o workflow.
- **Memória de conversa:** trocamos Postgres Chat Memory por leitura de `messages` (últimas 10). Validar que o agente mantém contexto suficiente; se faltar, aumentar o limite no `get_recent_messages`.
- **`match_documents` vetor:** o serviço passa o embedding como `::vector` literal; conferir no smoke (Task 14 Step 4) que retorna linhas para a loja de teste.
- **Hosting:** sem Redis/estado em memória; qualquer container serve. Decidir o host antes do deploy.
