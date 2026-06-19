# Chat-service — Qualidade do atendimento + custo de tokens — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recuperar a qualidade do atendimento perdida na otimização de custo e cortar mais tokens/chamadas, sem trocar a arquitetura de agente único.

**Architecture:** Mantém-se o **agente único com tools** (`run_agent`) — o diagnóstico mostrou que a regressão veio do *tiering de modelo* e do *gating*, não da topologia. Roteador/orquestrador foram rejeitados por reintroduzir o bug de "regra some na fronteira entre agentes" e adicionar chamadas. As otimizações são incrementais: robustez de extração via Structured Outputs, redução de history/rounds, ajuste fino dos gates e habilitação do `reasoning_effort` do foreground via A/B.

**Tech Stack:** Python 3.12, OpenAI Python SDK (chat completions, function calling, Structured Outputs / `response_format` json_schema), pytest + pytest-asyncio. Provider é OpenAI (gpt-5-mini foreground/lead, gpt-5-nano background). **Não é Anthropic.**

**Branch / worktree:** `feat/chat-qualidade-custo` (worktree `.claude/worktrees/chat-qualidade-custo`), baseada em `feat/gating-background`. Rodar tudo de dentro de `chat-service/` com o venv local: `./.venv/Scripts/python.exe -m pytest`.

---

## Estado atual da branch (o que JÁ está feito — não refazer)

Confirmado por leitura do código em `feat/gating-background`:

- ✅ **Prompt em 3 camadas p/ prompt caching de prefixo** — `prompt.py`: `STATIC_PROMPT` (camada 1, global-estática), `build_store_prompt` (camada 2, por-loja-estática), `build_dynamic_state` (camada 3, dinâmica). `runner.py:104-111` envia na ordem certa (estático → loja → history → dinâmico → order-state → user). **Nada a fazer.**
- ✅ **Medição de `cached_tokens`** — `llm.py:12-17` captura `prompt_tokens_details.cached_tokens`; `pipeline.py:81-89` loga e grava por modelo via `record_daily_usage`. **Nada a fazer.**
- ✅ **Knob `foreground_reasoning_effort`** — `config.py:15` + `runner.py:120,171` já passam o valor. Default `None` aguardando A/B (ver Task 7).
- ✅ **Gates sem-LLM** — `should_extract_lead` (`lead.py`) e `looks_like_question` (`gap.py:40-44`) já cortam chamadas em saudação/elogio. Task 6 só refina o gate de gap.
- ✅ **Fix #0 (alucinação de comportamento do lead)** — `_summarize_interest` voltou de `background_model`(nano)+`minimal` para `lead_model`(mini). Já commitado nesta branch (`8248730`).

## Escopo deste plano (o que FALTA)

1. **Task 1** — Infra de Structured Outputs no `LLMClient.chat` + `FakeLLM`.
2. **Task 2** — Extração de lead via Structured Outputs (robustez; encolhe prompt).
3. **Task 3** — Detecção de gap via Structured Outputs (robustez; encolhe prompt).
4. **Task 4** — `MAX_TOOL_ROUNDS` 5→3, configurável.
5. **Task 5** — History do agente configurável, 10→8.
6. **Task 6** — Gate de gap pega afirmações de atacado/política sem "?".
7. **Task 7** — (Operacional) Rodar A/B do `foreground_reasoning_effort` e setar env.

**Fora de escopo (futuro, ver fim do doc):** FAQ via retrieval, fusão lead+gap numa chamada.

---

## Task 1: Infra de Structured Outputs no LLMClient

Adiciona suporte a `response_format` (json_schema) no cliente e no fake de teste. Habilita as Tasks 2 e 3.

**Files:**
- Modify: `app/llm.py:27-45`
- Modify: `tests/conftest.py:115-120` (FakeLLM.chat)
- Test: `tests/test_llm_usage.py`

- [ ] **Step 1: Escrever o teste que falha**

Em `tests/test_llm_usage.py`, adicionar (segue o padrão de `test_chat_passes_reasoning_effort_through`, que usa um stub do client):

```python
async def test_chat_passes_response_format_through():
    captured = {}

    class _Stub:
        class chat:
            class completions:
                @staticmethod
                async def create(**kwargs):
                    captured.update(kwargs)
                    class _M: content = "{}"; tool_calls = None
                    class _C: message = _M()
                    class _R: choices = [_C()]; usage = None
                    return _R()

    from app.llm import LLMClient
    client = LLMClient("k")
    client._client = _Stub()
    rf = {"type": "json_schema", "json_schema": {"name": "x", "strict": True,
          "schema": {"type": "object", "additionalProperties": False,
                     "properties": {}, "required": []}}}
    await client.chat(model="m", messages=[], response_format=rf)
    assert captured["response_format"] == rf

    captured.clear()
    await client.chat(model="m", messages=[])
    assert "response_format" not in captured
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_llm_usage.py::test_chat_passes_response_format_through -q`
Expected: FAIL com `TypeError: chat() got an unexpected keyword argument 'response_format'`.

- [ ] **Step 3: Implementar no `app/llm.py`**

Trocar a assinatura e o corpo de `chat`:

```python
    async def chat(self, model, messages, tools=None, max_tokens=None,
                   reasoning_effort=None, response_format=None) -> dict:
        kwargs = {"model": model, "messages": messages}
        if tools:
            kwargs["tools"] = tools
        if max_tokens:
            kwargs["max_completion_tokens"] = max_tokens
        # GPT-5 cobra reasoning tokens como output. Em tarefas simples
        # (classificação/extração) "minimal" corta esse custo.
        if reasoning_effort:
            kwargs["reasoning_effort"] = reasoning_effort
        # Structured Outputs: garante JSON válido conforme schema (sem markdown),
        # tornando o parsing das branches robusto e permitindo encolher os prompts.
        if response_format:
            kwargs["response_format"] = response_format
        resp = await self._client.chat.completions.create(**kwargs)
```

- [ ] **Step 4: Atualizar o `FakeLLM` em `tests/conftest.py`**

Trocar a assinatura de `FakeLLM.chat` e registrar o campo:

```python
    async def chat(self, model, messages, tools=None, max_tokens=None,
                   reasoning_effort=None, response_format=None):
        self.chat_calls.append({"model": model, "messages": messages, "tools": tools,
                                "reasoning_effort": reasoning_effort,
                                "response_format": response_format})
        record_usage("chat", model, 10, 4, 14)
        return self.chat_responses.pop(0)
```

- [ ] **Step 5: Rodar a suíte inteira**

Run: `./.venv/Scripts/python.exe -m pytest -q`
Expected: PASS (todos; o novo teste verde e nenhum quebrado pela mudança de assinatura).

- [ ] **Step 6: Commit**

```bash
git add app/llm.py tests/conftest.py tests/test_llm_usage.py
git commit -m "feat(chat-service): suporte a response_format (Structured Outputs) no LLMClient"
```

---

## Task 2: Extração de lead via Structured Outputs

Garante JSON válido e permite remover o boilerplate "retorne APENAS JSON puro" dos prompts. **Mantém `lead_model` (mini)** — não rebaixar (memória do projeto registra que modelo pequeno quebra extração de lead).

**Files:**
- Modify: `app/branches/lead.py` (definir schemas, passar `response_format` em `run_lead`, enxugar `LEAD_SYSTEM`/`LEAD_SYSTEM_ATACADO`)
- Test: `tests/test_branch_lead.py`

- [ ] **Step 1: Escrever o teste que falha**

Em `tests/test_branch_lead.py`, adicionar:

```python
async def test_lead_extraction_uses_structured_outputs(db, llm, store):
    db.lead = None
    db.recent_messages = [{"role": "user", "content": "oi"}]
    llm.chat_responses = [
        {"content": json.dumps({"nome": "Ana", "telefone": "5511999998888",
                                "email": None, "cep": None})},
        {"content": "null"},
    ]
    await run_lead(db, llm, _ctx(store, "sou a Ana, 11999998888"))
    rf = llm.chat_calls[0]["response_format"]   # 1ª chamada = extração
    assert rf["type"] == "json_schema"
    assert rf["json_schema"]["schema"]["properties"].keys() >= {
        "nome", "telefone", "email", "cep"}
    assert "carro_chefe" not in rf["json_schema"]["schema"]["properties"]
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_branch_lead.py::test_lead_extraction_uses_structured_outputs -q`
Expected: FAIL com `TypeError: 'NoneType' object is not subscriptable` (response_format ainda é None).

- [ ] **Step 3: Definir os schemas em `app/branches/lead.py`**

Logo após os imports (antes de `LEAD_SYSTEM`):

```python
def _lead_schema(atacado: bool) -> dict:
    props = {
        "nome": {"type": ["string", "null"]},
        "telefone": {"type": ["string", "null"]},
        "email": {"type": ["string", "null"]},
        "cep": {"type": ["string", "null"]},
    }
    if atacado:
        props["carro_chefe"] = {"type": ["string", "null"]}
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "lead_extraction",
            "strict": True,
            "schema": {
                "type": "object",
                "additionalProperties": False,
                "properties": props,
                "required": list(props.keys()),
            },
        },
    }
```

- [ ] **Step 4: Passar `response_format` em `run_lead`**

Na chamada de extração (`lead.py`, dentro de `run_lead`), trocar:

```python
    resp = await llm.chat(model=settings.lead_model,
                          messages=[{"role": "system", "content": system},
                                    {"role": "user", "content": ctx.chat_input}],
                          response_format=_lead_schema(atacado))
```

- [ ] **Step 5: Enxugar os prompts de lead**

Em `LEAD_SYSTEM` e `LEAD_SYSTEM_ATACADO`, **remover** os parágrafos de formato (o "Retorne APENAS um JSON puro…", os blocos `{"nome": ... }` e o "Se nada foi compartilhado…") — o schema agora garante o formato. **Manter** a lista de campos, o bloco `_DISAMBIGUA_NUMEROS` e as regras de Normalize (são instruções de conteúdo, não de formato). Exemplo do novo `LEAD_SYSTEM`:

```python
LEAD_SYSTEM = """Você é um extrator de informações pessoais. Analise a mensagem do cliente e identifique se ele compartilhou algum destes dados:

- nome (próprio do cliente, ex: "meu nome é João", "sou a Maria")
- telefone (WhatsApp ou fixo — 10 a 13 dígitos, sempre com DDD)
- email
- cep (exatamente 8 dígitos, formato 00000-000)

""" + _DISAMBIGUA_NUMEROS + """

Para cada campo não informado, use null.

Normalize:
- telefone: somente dígitos, com código do país (Brasil = 55).
- cep: formato 00000-000.
- nome: capitalizado ("João", não "joão")."""
```

Aplicar o mesmo corte em `LEAD_SYSTEM_ATACADO` (mantendo a linha de `carro_chefe` e seu Normalize).

- [ ] **Step 6: Rodar os testes de lead**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_branch_lead.py -q`
Expected: PASS (todos — os testes existentes já mandam JSON válido pelo fake, e `_parse_lead`/`_normalize_numbers` seguem iguais).

- [ ] **Step 7: Commit**

```bash
git add app/branches/lead.py tests/test_branch_lead.py
git commit -m "feat(chat-service): extracao de lead via Structured Outputs + prompt enxuto"
```

---

## Task 3: Detecção de gap via Structured Outputs

Mesma ideia para o gap. **Mantém `background_model` (nano)** — com schema garantido, nano dá conta da classificação.

**Files:**
- Modify: `app/branches/gap.py` (schema, `response_format` em `run_gap`, enxugar `_gap_system`)
- Test: `tests/test_branch_gap.py`

- [ ] **Step 1: Escrever o teste que falha**

Em `tests/test_branch_gap.py`, adicionar:

```python
async def test_gap_uses_structured_outputs(db, llm, store):
    llm.chat_responses = [{"content": json.dumps(
        {"is_gap": True, "question": "vocês entregam em sp?", "tag": "PRAZO"})}]
    await run_gap(db, llm, _ctx(store, "vocês entregam em SP?"))
    rf = llm.chat_calls[0]["response_format"]
    assert rf["type"] == "json_schema"
    props = rf["json_schema"]["schema"]["properties"]
    assert props["is_gap"]["type"] == "boolean"
    assert "ATACADO" in props["tag"]["enum"]
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_branch_gap.py::test_gap_uses_structured_outputs -q`
Expected: FAIL (`response_format` é None → `TypeError`).

- [ ] **Step 3: Definir o schema e passar em `run_gap`**

Em `app/branches/gap.py`, adicionar a constante no topo (após imports):

```python
GAP_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "gap_detection",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "is_gap": {"type": "boolean"},
                "question": {"type": "string"},
                "tag": {"type": "string", "enum": [
                    "POLÍTICA DE ENTREGA", "PRAZO", "ATACADO",
                    "SKU INEXISTENTE", "PAGAMENTO", "OUTROS"]},
            },
            "required": ["is_gap", "question", "tag"],
        },
    },
}
```

E na chamada em `run_gap`:

```python
    resp = await llm.chat(
        model=settings.background_model,
        messages=[{"role": "system", "content": _gap_system(ctx.store)},
                  {"role": "user", "content": f"Mensagem do cliente: {ctx.chat_input}"}],
        reasoning_effort="minimal",
        response_format=GAP_SCHEMA)
```

- [ ] **Step 4: Enxugar `_gap_system`**

Remover do retorno de `_gap_system` o parágrafo "Retorne APENAS JSON puro… no formato {…}" (linhas do bloco de formato). Manter as instruções de QUANDO marcar `is_gap` true/false. O schema cuida do formato e do enum de `tag`.

- [ ] **Step 5: Rodar os testes de gap**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_branch_gap.py -q`
Expected: PASS (todos).

- [ ] **Step 6: Commit**

```bash
git add app/branches/gap.py tests/test_branch_gap.py
git commit -m "feat(chat-service): deteccao de gap via Structured Outputs + prompt enxuto"
```

---

## Task 4: MAX_TOOL_ROUNDS configurável, 5→3

O loop reenvia o prompt (mesmo cacheado) a cada round; 5 é folgado para 3 tools simples. Reduz o pior caso de chamadas.

**Files:**
- Modify: `app/config.py` (novo campo), `app/agent/runner.py:16,116`
- Test: `tests/test_runner.py`

- [ ] **Step 1: Escrever o teste que falha**

Em `tests/test_runner.py`, adicionar um teste que força o LLM a sempre pedir tool e conta as chamadas (segue o padrão do fake; ver os outros testes de runner para os helpers `db`, `llm`, `store`):

```python
async def test_tool_rounds_capped_by_settings(db, llm, store, monkeypatch):
    monkeypatch.setattr(runner.settings, "max_tool_rounds", 3)
    # responde sempre com uma tool call -> nunca encerra pelo conteúdo
    tool_resp = {"tool_calls": [{"id": "1", "name": "LISTAR_CATEGORIA",
                                 "arguments": json.dumps({"categoria": "Tops"})}]}
    llm.chat_responses = [dict(tool_resp) for _ in range(3)] + [{"content": "fim"}]
    await runner.run_agent(llm, db, store, "(nenhum)", "oi", [])
    # 3 rounds no loop + 1 chamada final fora do loop = 4
    assert len(llm.chat_calls) == 4
```

(Confirmar no topo do arquivo que há `import json` e `from app.agent import runner`; se não, adicionar.)

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_runner.py::test_tool_rounds_capped_by_settings -q`
Expected: FAIL — `settings` não tem `max_tool_rounds` (AttributeError) ou contagem 6 (default atual 5+1).

- [ ] **Step 3: Adicionar o campo em `app/config.py`**

Após `match_count`:

```python
    # Rounds máximos de tool no loop do agente. 3 cobre buscar/listar→registrar→
    # responder; cada round reenvia o prompt, então não inflar. Env: MAX_TOOL_ROUNDS.
    max_tool_rounds: int = 3
```

- [ ] **Step 4: Usar o setting em `app/agent/runner.py`**

Remover a constante `MAX_TOOL_ROUNDS = 5` (linha 16) e trocar o loop (linha 116):

```python
    for _ in range(settings.max_tool_rounds):
```

- [ ] **Step 5: Rodar a suíte de runner**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_runner.py -q`
Expected: PASS (o novo teste e os existentes; se algum existente dependia de `MAX_TOOL_ROUNDS` importado, ajustar para `settings.max_tool_rounds`).

- [ ] **Step 6: Commit**

```bash
git add app/config.py app/agent/runner.py tests/test_runner.py
git commit -m "perf(chat-service): MAX_TOOL_ROUNDS 5->3 configuravel por env"
```

---

## Task 5: History do agente configurável, 10→8

Reenviado a cada round; o ESTADO ATUAL DO PEDIDO já é a fonte da verdade, então dá pra encurtar. **Default 8 (conservador para qualidade)**, ajustável por env; validar com e2e antes de baixar mais.

**Files:**
- Modify: `app/config.py` (novo campo), `app/pipeline.py:42`
- Test: `tests/test_pipeline.py`

- [ ] **Step 1: Estender o `FakeDB` para registrar o `limit`**

Em `tests/conftest.py`, no `FakeDB`: adicionar `self.recent_limit = None` no `__init__` (junto dos outros campos) e gravar o limite em `get_recent_messages`:

```python
    async def get_recent_messages(self, conversation_id, limit=10):
        self.recent_limit = limit
        return list(self.recent_messages)
```

- [ ] **Step 2: Escrever o teste que falha**

Em `tests/test_pipeline.py`, adicionar (espelha `test_gating_skips_background_for_plain_greeting`: saudação simples → só o agente roda, então o único `get_recent_messages` é o do pipeline):

```python
async def test_pipeline_uses_history_limit_setting(db, llm, store, monkeypatch):
    monkeypatch.setattr(pipeline_mod.settings, "history_limit", 8)
    db.store = store
    db.window_messages = [{"id": "msg-1", "content": "oi tudo bem"}]
    db.catalog = []
    db.recent_messages = []
    llm.chat_responses = [{"content": "oi! como posso ajudar?"}]
    await process_message(db, llm, _payload(msg="oi tudo bem", mid="msg-1"))
    assert db.recent_limit == 8
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_pipeline.py::test_pipeline_uses_history_limit_setting -q`
Expected: FAIL — `history_limit` inexistente (AttributeError), ou `recent_limit == 10`.

- [ ] **Step 4: Adicionar o campo em `app/config.py`**

```python
    # Nº de mensagens recentes do history reenviadas ao agente a cada turno.
    # O ESTADO ATUAL DO PEDIDO já é fonte da verdade; 8 mantém contexto de
    # descoberta sem inflar tokens. Validar com e2e antes de baixar. Env: HISTORY_LIMIT.
    history_limit: int = 8
```

- [ ] **Step 5: Usar o setting em `app/pipeline.py`**

Na linha 42, trocar `limit=10` por `limit=settings.history_limit`:

```python
        db.get_recent_messages(payload.id_conversa, limit=settings.history_limit),
```

(Não mexer no `limit=10` de `_summarize_interest` em `lead.py` — o resumo de interesse se beneficia de mais contexto.)

- [ ] **Step 6: Rodar a suíte de pipeline**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_pipeline.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/config.py app/pipeline.py tests/test_pipeline.py tests/conftest.py
git commit -m "perf(chat-service): history do agente configuravel (default 8)"
```

---

## Task 6: Gate de gap pega afirmações de atacado/política sem "?"

`looks_like_question` (`gap.py:33-44`) descarta frases afirmativas relevantes que não casam o regex (ex.: "trabalho com revenda de moda fitness", "compro pra minha loja", "sou sacoleira"). Essas revelam contexto de atacado que vale registrar como gap quando a loja não cobre.

**Files:**
- Modify: `app/branches/gap.py:33-44`
- Test: `tests/test_branch_gap.py`

- [ ] **Step 1: Escrever o teste que falha**

```python
def test_looks_like_question_catches_atacado_statement():
    assert looks_like_question("trabalho com revenda de moda fitness")
    assert looks_like_question("compro pra minha loja")
    assert looks_like_question("sou sacoleira")

def test_looks_like_question_still_skips_plain_greeting():
    assert not looks_like_question("oi tudo bem")
    assert not looks_like_question("kkk adorei")
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_branch_gap.py::test_looks_like_question_catches_atacado_statement -q`
Expected: FAIL (frases afirmativas de atacado não casam o regex atual).

- [ ] **Step 3: Estender o regex em `app/branches/gap.py`**

Adicionar uma alternância de termos de atacado/revenda ao `_QUESTION_RE` (manter o resto):

```python
_QUESTION_RE = re.compile(
    r"\?|\b(qual|quais|quanto|quantos|quanta|quantas|quando|onde|cad[eê]|como|"
    r"por que|porque|por quê|tem|t[eê]m|teria|h[aá] |posso|consigo|consegue|"
    r"d[aá] pra|aceita|aceitam|fazem|faz |entrega|entregam|envia|enviam|demora|"
    r"prazo|troca|garantia|funciona|precisa|vale a pena|"
    r"revend\w*|atacado|sacoleir\w*|lojist\w*|pra minha loja|pra revender)\b", re.I)
```

- [ ] **Step 4: Rodar os testes de gap**

Run: `./.venv/Scripts/python.exe -m pytest tests/test_branch_gap.py -q`
Expected: PASS (novos + existentes; as saudações continuam sem casar).

- [ ] **Step 5: Commit**

```bash
git add app/branches/gap.py tests/test_branch_gap.py
git commit -m "fix(chat-service): gate de gap reconhece contexto de atacado sem '?'"
```

---

## Task 7: (Operacional) A/B do foreground_reasoning_effort + env

O maior bolso de custo restante: o agente gasta ~8k reasoning tokens/conversa (cobrados como output). O knob já existe; falta validar que `low`/`minimal` não degradam o tool-calling e então ligar via env. **Não é mudança de código** — é rodar o script e decidir.

**Files:** nenhum (config via env no EasyPanel). Usa `scripts/ab_foreground_effort.py` e/ou `scripts/ab_foreground_broad.py`.

- [ ] **Step 1: Ler o script de A/B**

`Read scripts/ab_foreground_effort.py` (e `scripts/ab_foreground_broad.py`) para entender entradas (precisa de `OPENAI_API_KEY` e provavelmente de conversas/loja de teste) e o que ele reporta.

- [ ] **Step 2: Rodar o A/B**

Com a env do projeto carregada (ver `.env.example`):
```bash
./.venv/Scripts/python.exe scripts/ab_foreground_effort.py
```
Comparar `None` (atual) vs `low` vs `minimal` nos eixos: acerto de tool-calling (escolha BUSCAR vs LISTAR, REGISTRAR), qualidade das respostas e tokens de output/reasoning.

- [ ] **Step 3: Decidir e registrar**

Se `low` mantém a qualidade do tool-calling: definir `FOREGROUND_REASONING_EFFORT=low` no EasyPanel. Se houver degradação, manter `None` e documentar o resultado. Anotar o número (tokens economizados/conversa) no PR.

- [ ] **Step 4: Sem commit de código** (mudança é só de env). Registrar a decisão na descrição do PR / numa nota de memória do projeto.

---

## Verificação final

- [ ] **Suíte completa verde**

Run: `./.venv/Scripts/python.exe -m pytest -q`
Expected: PASS, 0 failures. Contar que o total subiu vs. baseline (143) pelos testes novos.

- [ ] **E2E de atendimento (smoke de qualidade)**

`Read scripts/e2e_attendance.py` e rodá-lo (precisa de `OPENAI_API_KEY` e DB de teste) para confirmar que: (a) numa loja atacado o agente pergunta o carro-chefe e lista a categoria certa; (b) o resumo de interesse do lead não inventa comportamento; (c) lead com nome+telefone é capturado. Comparar com o comportamento esperado das regras em `STATIC_PROMPT`/`build_store_prompt`.

- [ ] **Finalização**: usar `superpowers:finishing-a-development-branch` para abrir PR de `feat/chat-qualidade-custo` (inclui o fix #0 já commitado). No corpo do PR, resumir: regressões corrigidas, redução estimada de chamadas/tokens, e o resultado do A/B (Task 7).

---

## Fora de escopo (futuro)

- **FAQ via retrieval (tool `CONSULTAR_FAQ`)** — hoje a FAQ está na camada 2 (por-loja), então **já é cacheada** dentro da janela de cache da OpenAI; o ganho de tirá-la do prompt só compensa para FAQs muito grandes ou caches frios. Reavaliar depois de medir o `cached_tokens` real em produção (já instrumentado).
- **Fusão lead+gap numa chamada** — só economiza quando os dois gates disparam na MESMA mensagem (contato + pergunta), que é raro; hoje já rodam em paralelo via `asyncio.gather`. Baixo ganho, risco de acoplar duas responsabilidades. Não fazer agora.
- **Roteador/orquestrador** — rejeitado: reintroduz risco de regra sumir na fronteira entre agentes e adiciona chamadas. Documentado na análise dos subagentes.
