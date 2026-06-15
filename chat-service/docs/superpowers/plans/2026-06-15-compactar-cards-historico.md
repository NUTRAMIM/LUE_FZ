# Compactar cards de produto no histórico do foreground — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parar de reenviar o markup completo dos cards de produto no histórico a cada turno, trocando os despejos antigos por uma referência curta — cortando o maior driver de custo de input em conversas de atacado (que despejam ~metade do estoque).

**Architecture:** O agente continua igual. A mudança é só na montagem do `history_msgs` no `pipeline.py`: uma função pura compacta as mensagens de card ANTIGAS (mantendo o despejo mais recente intacto para follow-up). Os cards completos continuam (a) indo para o cliente e (b) gravados no banco — só o que é **reenviado ao modelo como histórico** fica enxuto. O modelo não perde continuidade porque o bloco "Já mostrado" (`build_dynamic_state`) já lista os nomes de todos os produtos exibidos.

**Tech Stack:** Python 3.12, pytest + pytest-asyncio. Rodar de `chat-service/` com `./.venv/Scripts/python.exe -m pytest`.

**Branch / worktree:** `feat/chat-qualidade-custo` (worktree `.claude/worktrees/chat-qualidade-custo`). Já está mesclada com a `origin/main` de produção; continuar nela.

---

## Contexto técnico (verificado no código)

- `app/agent/tools.py`: `buscar_produtos`/`listar_categoria` retornam `(segmento, ids, resumo)`. `segmento` = markup completo dos cards (`[produto]...[/produto]`); `resumo` = frase curta (é o que vai pro modelo como tool result — já é barato).
- `app/pipeline.py:57-58`: cada `segmento` é inserido como mensagem `assistant` no banco → vira registro da conversa e é mostrado ao cliente.
- `app/pipeline.py:40-45`: o histórico do foreground vem de `db.get_recent_messages(limit=settings.history_limit)` (**ORDER BY created_at DESC → recente-primeiro**) e é mapeado em `history_msgs`, passado a `run_agent`. **É aqui que os cards completos voltam ao modelo todo turno.**
- `app/db.py` `get_shown_products`: o bloco "Já mostrado" já contém os **nomes** de todos os produtos exibidos (`product_mentions` source='ai_shown'). Logo, compactar os cards do histórico NÃO tira do modelo o conhecimento do que foi mostrado.

**Decisão de design:** manter o despejo de cards **mais recente** intacto (o primeiro `assistant` com `[produto]` na lista recente-primeiro), compactar todos os mais antigos. Trade-off aceito: se o cliente perguntar preço/tamanho de um produto de um despejo já compactado, o agente faz um `BUSCAR_PRODUTOS` (chamada barata) em vez de ter o card na memória.

**Escopo:** 2 tarefas. NÃO inclui o achado de ordem-invertida do histórico (ver "Fora de escopo").

---

## Task 1: Função pura que compacta cards antigos do histórico

**Files:**
- Modify: `app/pipeline.py` (adicionar a função `_compact_shown_cards` + o `import re` se faltar)
- Test: `tests/test_pipeline.py`

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/test_pipeline.py`, adicionar (o arquivo já importa `app.pipeline as pipeline_mod`):

```python
def test_compact_keeps_most_recent_dump_and_compacts_older():
    # recente-primeiro: o 1º card é o mais recente (mantém); o 2º é antigo (compacta)
    history = [
        {"role": "user", "content": "me mostra os shorts"},
        {"role": "assistant", "content": "[produto]\nShort A\nR$ 50\n[/produto]\n[produto]\nShort B\nR$ 60\n[/produto]"},
        {"role": "user", "content": "e os tops?"},
        {"role": "assistant", "content": "[produto]\nTop X\nR$ 40\n[/produto]"},
    ]
    out = pipeline_mod._compact_shown_cards(history)
    # despejo mais recente (Short A/B, 1º card da lista) mantido inteiro
    assert "[produto]" in out[1]["content"] and "Short A" in out[1]["content"]
    # despejo antigo (Top X) compactado: sem markup, com a contagem
    assert "[produto]" not in out[3]["content"]
    assert "1" in out[3]["content"]
    # mensagens não-card intactas
    assert out[0]["content"] == "me mostra os shorts"
    assert out[2]["content"] == "e os tops?"


def test_compact_single_dump_is_left_intact():
    history = [
        {"role": "assistant", "content": "[produto]\nTop X\nR$ 40\n[/produto]"},
        {"role": "user", "content": "oi"},
    ]
    out = pipeline_mod._compact_shown_cards(history)
    assert out[0]["content"].count("[produto]") == 1


def test_compact_no_cards_is_noop():
    history = [{"role": "user", "content": "oi"},
               {"role": "assistant", "content": "oi! tudo bem?"}]
    assert pipeline_mod._compact_shown_cards(history) == history
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_pipeline.py -k compact -q`
Expected: FAIL com `AttributeError: module 'app.pipeline' has no attribute '_compact_shown_cards'`.

- [ ] **Step 3: Implementar a função em `app/pipeline.py`**

Garantir `import re` no topo (já pode existir; se não, adicionar junto aos outros imports). Adicionar a função (nível de módulo, perto do topo, depois dos imports):

```python
def _compact_shown_cards(history_msgs: list[dict]) -> list[dict]:
    """Troca os cards de produto ANTIGOS do histórico por uma referência curta,
    pra não reenviar o markup completo a cada turno (atacado despeja ~metade do
    estoque = muitos cards). Mantém o despejo MAIS RECENTE intacto (follow-up
    imediato precisa do detalhe). Os nomes de tudo que foi mostrado já vão no
    bloco 'Já mostrado'. `history_msgs` vem recente-primeiro
    (get_recent_messages ORDER BY created_at DESC), então o 1º card encontrado
    é o mais recente."""
    kept_recent = False
    out = []
    for m in history_msgs:
        n = m["content"].count("[produto]") if m["role"] == "assistant" else 0
        if n > 0 and kept_recent:
            out.append({"role": m["role"],
                        "content": f'[{n} peça(s) mostrada(s) ao cliente — nomes no bloco "Já mostrado"]'})
        else:
            if n > 0:
                kept_recent = True   # 1º card = mais recente: mantém inteiro
            out.append(m)
    return out
```

- [ ] **Step 4: Rodar os testes da função**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_pipeline.py -k compact -q`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add app/pipeline.py tests/test_pipeline.py
git commit -m "feat(chat-service): compacta cards antigos do historico do foreground"
```

---

## Task 2: Aplicar a compactação ao montar o histórico do foreground

**Files:**
- Modify: `app/pipeline.py` (a linha que monta `history_msgs`)
- Test: `tests/test_pipeline.py`

- [ ] **Step 1: Escrever o teste que falha**

Em `tests/test_pipeline.py`, adicionar (espelha os testes de pipeline existentes; `db`/`llm`/`store` são fixtures, `_payload` é helper; `db.recent_messages` é o que `get_recent_messages` devolve — recente-primeiro):

```python
async def test_pipeline_compacts_old_cards_before_sending_to_agent(db, llm, store):
    # "quero esse" não dispara gap nem lead (gating) → só 1 chamada foreground,
    # então 1 resposta no fake basta. O foco é a compactação do histórico.
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "quero esse"}]
    db.catalog = []
    # recente-primeiro: despejo recente (shorts) + despejo antigo (conjuntos)
    db.recent_messages = [
        {"role": "assistant", "content": "[produto]\nShort A\nR$ 50\n[/produto]"},
        {"role": "user", "content": "me mostra os shorts"},
        {"role": "assistant", "content": "[produto]\nConj A\nR$ 99\n[/produto]\n[produto]\nConj B\nR$ 89\n[/produto]"},
        {"role": "user", "content": "me mostra os conjuntos"},
    ]
    llm.chat_responses = [{"content": "fechou!"}]
    await process_message(db, llm, _payload(msg="quero esse", mid="msg-1"))

    sent = llm.chat_calls[0]["messages"]
    blob = "\n".join(m["content"] for m in sent)
    # o despejo ANTIGO (Conj A/B) foi compactado fora do prompt
    assert "Conj A" not in blob and "Conj B" not in blob
    # o despejo RECENTE (Short A) continua inteiro
    assert "Short A" in blob
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_pipeline.py::test_pipeline_compacts_old_cards_before_sending_to_agent -q`
Expected: FAIL — "Conj A" ainda aparece no prompt (compactação não aplicada).

- [ ] **Step 3: Aplicar a compactação no `app/pipeline.py`**

Onde monta `history_msgs` (hoje:
`history_msgs = [{"role": m["role"], "content": m["content"]} for m in history]`),
embrulhar com a função:

```python
    history_msgs = _compact_shown_cards(
        [{"role": m["role"], "content": m["content"]} for m in history])
```

- [ ] **Step 4: Rodar a suíte de pipeline + suíte completa**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_pipeline.py -q` → PASS
Run: `./.venv/Scripts/python.exe -m pytest -q` → PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add app/pipeline.py tests/test_pipeline.py
git commit -m "perf(chat-service): aplica compactacao de cards ao historico do agente"
```

---

## Verificação final

- [ ] **Suíte completa verde** — `./.venv/Scripts/python.exe -m pytest -q`, 0 falhas.
- [ ] **E2E de atacado** (opcional, precisa de `OPENAI_API_KEY` + `DATABASE_URL` num `.env` temporário; remover o `.env` depois): rodar `./.venv/Scripts/python.exe -m scripts.e2e_attendance` e olhar nos logs de `usage da conversa` que o `prompt` por turno após um despejo NÃO carrega mais o markup antigo (input não-cacheado menor). Comparar com a conversa de antes da mudança.
- [ ] **Finalização**: como a branch já tem PR aberto/foi pra `main`, decidir com `superpowers:finishing-a-development-branch` se entra no mesmo PR ou em PR novo. Recomendado: PR próprio ("compacta cards no histórico") pra ficar fácil de revisar/reverter isolado.

---

## Calibração para esta loja (70 produtos)

- Meio estoque ≈ ~35 cards ≈ ~1.500 tokens por despejo. Atacado costuma despejar a categoria do carro-chefe + cross-sell → 1–2 despejos por conversa.
- Manter só o despejo mais recente já corta praticamente todo o replay dos despejos anteriores. Com `HISTORY_LIMIT=8`, raramente há mais de 1–2 despejos na janela, então não é preciso parametrizar "quantos manter" (YAGNI — manter 1).
- Ganho esperado: elimina o reenvio de ~1.500+ tokens/turno de cards antigos e, principalmente, **corta o pico de cache frio** (quando a lojista some e volta após o TTL do cache) — o cenário de custo que mais preocupa.

---

## Fora de escopo (mas IMPORTANTE — investigar separado)

**Ordem do histórico possivelmente invertida.** `db.get_recent_messages` retorna `ORDER BY created_at DESC` (recente-primeiro) e o `pipeline.py` passa isso direto pro `run_agent`, que faz `messages.extend(history)` — ou seja, o modelo pode estar recebendo a conversa **de trás pra frente**. Isso é pré-existente e pode estar degradando a qualidade do atendimento (contexto bagunçado, "recomeça do zero"). **Recomendação:** abrir uma investigação separada — confirmar com um teste se a ordem chega invertida ao modelo e, se sim, reverter o histórico para ordem cronológica antes do `extend`. NÃO fazer junto com este plano (escopos diferentes; mexer em ordenação de histórico merece seu próprio teste/PR). A função `_compact_shown_cards` deste plano é agnóstica de direção desde que "mais recente = primeiro card", premissa que vale enquanto a fonte for `get_recent_messages` DESC; se a ordem for corrigida, ajustar a heurística de "qual manter" junto.
```
