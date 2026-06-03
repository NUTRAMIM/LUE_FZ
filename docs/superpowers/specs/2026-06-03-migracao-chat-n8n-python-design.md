# Migração do chat de atendimento: n8n → serviço Python (FastAPI)

**Data:** 2026-06-03
**Status:** Design aprovado (aguardando revisão do spec)

## Contexto e motivação

O chat de atendimento por IA da LUE FZ roda hoje num workflow n8n (`n8n/workflow-chat-agent.json`). Ele recebe um webhook, bufferiza mensagens rápidas, chama um agente LLM com busca semântica de produtos (RAG via `match_documents`), responde o cliente e dispara vários efeitos colaterais (extração de lead, resumo de interesse, detecção de gaps de conhecimento, rastreio de produtos citados, divisão da resposta em pedaços).

O time quer migrar para um serviço próprio em **Python** (o time programa em Python). A migração também viabiliza quatro melhorias difíceis de fazer bem no n8n:

1. **Reduzir consumo de tokens** — hoje são ~6 chamadas de LLM por mensagem.
2. **Resolver o problema das cores** — o catálogo Facilzap traz ~200 cores por produto (combinações cor+tamanho); despejar isso no contexto do LLM é caro.
3. **Enviar produtos da categoria via streaming, sem o LLM redigir a lista** (fase 2).
4. **Memória/contexto do lead entre conversas** (fase 2).

## Estratégia

**Híbrido:** portar o núcleo da conversa com **paridade de comportamento** (incluindo todos os efeitos colaterais), já incorporando as melhorias **baratas e de baixo risco** (resumo de cores, redução de tokens via remoção do splitter LLM e `topK: 6`). As melhorias maiores — streaming de produtos (#3) e memória entre conversas (#4) — ficam para a **fase 2**, e a arquitetura é desenhada para acomodá-las sem rearquitetar.

## Estado atual (descobertas relevantes)

- **Entrega ao frontend já é via Supabase Realtime.** `src/app/chat/[slug]/ChatClient.tsx` assina INSERTs na tabela `messages` (filtro por `conversation_id`) e renderiza o que aparecer. O serviço novo só precisa **inserir linhas em `messages`** — o transporte já existe.
- **Envio:** o server action `sendMessage` (`src/actions/chat.ts`) insere a mensagem do usuário em `messages` e chama `dispatchToN8n` (`src/lib/n8n.ts`) com o payload `{mensagem, id_mensagem, id_conversa, nome_loja, id_loja, tipo_de_mensagem, media_url?}`.
- **Divisão da resposta já existe no frontend** (`ai-split.ts` / `cycle.ts`): a UI divide a mensagem do assistente em segmentos com delay de digitação. O splitter LLM do n8n é redundante.
- **Fallback de instabilidade já existe** no `sendMessage` (insere `role='system'` "Estamos com instabilidade...").
- **Buffer no n8n é stateless** (consulta a janela de mensagens recentes e só processa se a atual é a última).

## Decisões fechadas

| Tópico | Decisão |
|---|---|
| Estratégia | Híbrido: núcleo fiel + cores/tokens na fase 1 |
| Hosting | Indefinido → adotar a opção mais simples (1 container FastAPI) |
| Concorrência | `asyncio` / background tasks; **sem Redis** no início |
| Orquestração LLM | OpenAI SDK puro (sem LangChain/LangGraph) |
| Splitter | Removido o splitter LLM; o frontend divide |
| Efeitos colaterais | Paridade completa na fase 1 (lead, interesse, gap, mentions) |
| Modelo de requisição | **B + C**: responde `202` imediato + processa em background; buffer stateless no Postgres |
| LLMs auxiliares | **Manter os 3 separados** (lead, interesse, gap) — paridade pura, sem consolidar |
| Resumo de cores | Em Python (função pura), não no SQL (migrations 035/036 ficam revertidas) |

## Seção 1 — Arquitetura e fronteiras

```
ChatClient (Next.js)
   │  sendMessage (server action)
   │   ├─ insere msg do user em `messages`
   │   └─ dispatchToN8n(URL nova) ──▶ Serviço Python (FastAPI)
   │                                     POST /chat → 202
   ▲                                     + task asyncio em background
   │ Realtime (INSERT em messages)             │
   └──────────────── Supabase (Postgres + pgvector + Realtime) ◀── lê/escreve
```

- **Única mudança no app Next.js:** a URL de destino em `src/lib/n8n.ts` passa a apontar para o serviço Python. **Payload idêntico.** Frontend, `sendMessage`, realtime e schema permanecem inalterados.
- **O serviço Python** é a única peça nova. Recebe o webhook, processa a conversa e **escreve em `messages`** e nas tabelas de efeito colateral. Nunca fala direto com o frontend — entrega sempre via Realtime.
- **Acesso a dados:** service role key (mesmo nível do `createAdminClient`). Lê `store_settings`, `products`, `documents`, `messages`, `product_mentions`; escreve `messages`, `leads`, `knowledge_gaps`, `product_mentions`.
- **Convivência com o n8n:** durante a migração, a URL aponta para o Python apenas para uma loja de teste (via env/flag), mantendo o n8n nas demais. Ao validar, vira a chave para todas e desliga o workflow n8n.

## Seção 2 — Fluxo de dados (uma mensagem, ponta a ponta)

```
POST /chat (payload do dispatchToN8n)
   ├─▶ valida payload → responde 202 na hora
   └─▶ task asyncio em background:
        1. BUFFER (stateless no Postgres)
              espera ~7s → SELECT mensagens 'user' da janela recente
              se a última da janela ≠ id_mensagem atual → ABORTA
              senão → chat_input = junção das mensagens da janela
        2. CARREGA CONTEXTO (em paralelo)
              • store_settings  • histórico recente de messages  • product_mentions 'ai_shown'
        3. AGENTE PRINCIPAL (OpenAI SDK, loop de tool-calling)
              system prompt + histórico + chat_input
              tool buscar_produtos(consulta, category) → embed → match_documents → cores resumidas
              → texto final
        4. ENTREGA
              INSERT 1 linha role='assistant' em messages (frontend divide; realtime entrega)
        5. BRANCHES PARALELOS (asyncio.gather, return_exceptions=True)
              • lead: extrai nome/tel/email/cep → upsert leads → resumo de interesse
              • gap: detecta pergunta sem resposta → insert knowledge_gaps
              • mentions: casa nomes de produto (texto da IA + msg do cliente) → product_mentions
```

- **Prioridade:** passos 1-4 (resposta ao cliente) vêm primeiro; os branches (5) rodam após o INSERT da resposta e não atrasam o cliente.
- **Idempotência:** entre tasks concorrentes, só continua a que tem `id_mensagem` == última da janela; as demais abortam no passo 1.
- **Memória de conversa (fase 1):** histórico recente lido de `messages`. A memória entre conversas (fase 2) encaixa no passo 2 sem rearquitetar.

## Seção 3 — Estrutura de módulos

```
chat-service/
├── app/
│   ├── main.py            # FastAPI: POST /chat → valida, 202, dispara task
│   ├── config.py          # env vars (SUPABASE_URL, SERVICE_KEY, OPENAI_KEY, modelo, flags)
│   ├── pipeline.py        # orquestra o fluxo da Seção 2
│   ├── db.py              # acesso ao Postgres via asyncpg. Único lugar com SQL.
│   ├── buffer.py          # janela de mensagens + decisão de abortar
│   ├── agent/
│   │   ├── runner.py      # loop de tool-calling (OpenAI SDK)
│   │   ├── prompt.py      # monta system prompt a partir de store_settings + "já mostrado"
│   │   └── tools.py       # buscar_produtos: embed + match_documents + resumo de cores
│   ├── branches/
│   │   ├── lead.py        # extrai lead → upsert leads → resumo de interesse
│   │   ├── gap.py         # detecta gap → knowledge_gaps
│   │   └── mentions.py    # casa nomes de produto → product_mentions
│   └── models.py          # pydantic/dataclasses: WebhookPayload, StoreSettings, Product, etc.
└── tests/
    ├── test_buffer.py
    ├── test_tools.py
    ├── test_agent.py
    ├── test_branches_*.py
    └── conftest.py        # fixtures + fakes de OpenAI/DB
```

**Interfaces principais:**

- `buffer.resolve_window(conv_id, msg_id) -> BufferResult{should_process, chat_input}` — lógica + 1 query.
- `agent.tools.buscar_produtos(store_id, consulta, category) -> list[Product]` — embed + `match_documents` + resumo de cores (resumo é função pura).
- `branches/*.run(ctx: Context)` — cada uma recebe um `Context` (store, conv, chat_input, ai_output) e faz seu efeito; independentes entre si.
- `db.py` concentra todo SQL via `asyncpg` (pool) — único ponto de acesso, fácil de mockar nos testes.

**Racional:** `pipeline.py` é o único que conhece a ordem; cada peça se entende e se testa sozinha. A fase 2 entra como módulos novos (listagem por categoria em `tools.py`; perfil do lead em `prompt.py`/`branches`) sem mexer no resto.

## Seção 4 — Recuperação de produtos: cores, tokens e fallback de categoria

**1. Resumo de cores (objetivo #2), em Python:**

```python
cores_visiveis = cores[:8]
if len(cores) > 8:
    rotulo = f"{', '.join(cores_visiveis)} (+{len(cores)-8} de {len(cores)})"
```

Chama `match_documents` na versão original (sem o corte SQL); o resumo é função pura, testável, e fica perto do código que usa.

**2. Fallback de categoria:**

```python
res = match_documents(query, category=cat)
if not res and cat:
    res = match_documents(query, category=None)  # refaz só semântico
```

Evita a falha quando o termo do cliente não bate com nenhuma categoria exata.

**3. Token diet (objetivo #1), fase 1:**

| Fonte de token (n8n) | Fase 1 (Python) |
|---|---|
| Splitter LLM | eliminado (frontend divide) |
| `topK: 12` com cores cheias | `topK: 6` + cores resumidas |
| Lead + Interesse + Gap (3 LLMs) | mantidos separados (paridade — decisão (a)) |
| System prompt inteiro toda vez | mantido (persona); enxugar é fase 2 |

## Seção 5 — Error handling

| Situação | Comportamento |
|---|---|
| Payload inválido | `400`, não dispara task |
| Buffer aborta (não é a última da janela) | task encerra silenciosa, sem inserir nada |
| `match_documents`/embed falha | `buscar_produtos` retorna vazio; agente pede mais detalhes (não inventa) |
| Agente principal falha/timeout | insere `role='system'` "Estamos com instabilidade. Sua mensagem foi recebida." (mesmo fallback do `sendMessage` atual) |
| Branch paralelo falha | logado e isolado (`asyncio.gather(return_exceptions=True)`); não afeta resposta nem outros branches |
| Serviço reinicia no meio | buffer stateless → próxima msg relê a janela; perde no máximo a task em voo |

**Princípio:** a resposta ao cliente é o caminho crítico (com fallback de instabilidade); efeitos colaterais são best-effort e nunca derrubam a resposta. Timeouts explícitos em toda chamada de rede.

## Seção 6 — Testes (TDD, pytest)

- **`buffer.py`** — última-da-janela processa; não-última aborta; janela de 1; junção de múltiplas (DB fake).
- **`tools.py`** — resumo de cores (≤8 não mexe; >8 amostra+contagem; bicolor preservado) e fallback de categoria. Funções puras.
- **`agent/prompt.py`** — system prompt monta com regras + "já mostrado" corretos.
- **`agent/runner.py`** — loop de tool-calling com fake do OpenAI.
- **`branches/*`** — extrações com inputs conhecidos (DB fake).
- **Integração leve** — `pipeline` ponta a ponta com OpenAI e DB fakes.

Mocks só para o inevitável (OpenAI, fronteira de DB); lógica de negócio testa com dados reais.

## Fora de escopo (fase 2)

- Streaming de cards de produto sem o LLM redigir a lista (objetivo #3) — exigirá novo `message_type` estruturado em `messages` e render de card no frontend.
- Memória/perfil do lead entre conversas (objetivo #4) — perfil persistente + RAG sobre conversas passadas do lead.
- Consolidação dos LLMs auxiliares para economia de token.
- Enxugar o system prompt.

## Riscos

- **Paridade de comportamento vs n8n:** validar lado a lado numa loja de teste antes de virar a chave.
- **Hosting indefinido:** o design não depende de Redis nem de estado em memória, então qualquer container serve; decidir hosting antes do deploy.
- **Buffer de 7s segurando recursos:** mitigado por `asyncio` (não bloqueia) e timeouts.
