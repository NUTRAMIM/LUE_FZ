# Agente Python: pedido estruturado, etapas e pagamento/entrega

**Data:** 2026-06-09
**Serviço:** `chat-service` (agente Python) + UI Next.js (Fila de Leads)

## Contexto e problema

O agente Python (`chat-service`) hoje:

- Monta o system prompt com `build_system_prompt(store, shown_list)` (`app/agent/prompt.py`), **sem** roteiro de etapas explícito e **sem** as Perguntas Frequentes que a loja configura.
- **Ignora** dois campos já existentes em `store_settings`: `service_steps TEXT[]` (migration 005) e `faq JSONB` (migration 033). A query `db.get_store_settings` nem os busca.
- Captura lead **só depois** do turno, via branch `run_lead` (`app/branches/lead.py`), que faz uma chamada LLM separada para extrair nome/telefone/email/cep da última mensagem. O agente **não lê nem escreve** na tabela `leads` durante o atendimento.
- Não tem noção de "pedido": o que o cliente quer levar, forma de pagamento e forma de entrega só existem (se existirem) diluídos no histórico — ou seja, dependem da memória/contexto.

Consequências: o agente não segue um roteiro consistente, não aproveita o FAQ da loja, não pergunta forma de pagamento/entrega no fechamento, e o vendedor humano que assume não recebe um pedido consolidado.

## Objetivo

Quatro melhorias entrelaçadas:

1. **Etapas + FAQ estruturados** no system prompt, alimentados pelas configs da loja.
2. **Pergunta de forma de pagamento e entrega** na etapa de captura de lead.
3. **Pedido, forma de pagamento e forma de entrega** persistidos na tabela `leads` — o agente lê (via prompt) e escreve (via tool), nunca dependendo da memória; visíveis na UI da Fila de Leads.
4. **Nome do lead** injetado no system prompt como chave `{{nome_lead}}` quando já há registro, para não depender da memória.

## Decisões de design (confirmadas com o usuário)

- **Leitura do estado:** injetada no system prompt a cada turno (chaves `{{nome_lead}}`, `{{pedido}}`, `{{forma_pagamento}}`, `{{forma_entrega}}`).
- **Escrita do estado:** tool nova `REGISTRAR_PEDIDO` chamada pelo agente.
- **Formato do pedido:** JSONB estruturado (lista de itens).
- **Etapas:** roteiro padrão sempre presente; `service_steps` da loja **complementam** (não substituem) a espinha dorsal.
- **Quando perguntar pagamento/entrega:** junto com a captura de lead (mesma frase que pede nome/WhatsApp/email).
- **UI:** as novas colunas aparecem na Fila de Leads agora (não só no banco).

## Arquitetura da solução

### 1. Migration `supabase/migrations/035_leads_order_fields.sql`

Idempotente, no padrão das migrations existentes:

```sql
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS pedido          JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS forma_pagamento TEXT,
  ADD COLUMN IF NOT EXISTS forma_entrega   TEXT;
```

- `pedido`: lista de itens. Cada item: `{ "produto": str, "qtd": int, "tamanho": str|null, "cor": str|null, "preco": number|null }`.
- A constraint `leads_conversation_id_unique` (migration 014) já garante 1 lead por conversa → permite upsert por `conversation_id`.

### 2. Leitura do estado no prompt (melhorias #3-leitura e #4)

**`app/db.py`:**
- `get_lead(conversation_id, store_id)` passa a selecionar também `pedido`, `forma_pagamento`, `forma_entrega` (além de `name`, que já retorna).

**`app/pipeline.py`:**
- Hoje o lead só é buscado depois do agente (dentro de `run_lead`). Passa a buscar o lead **antes** de `run_agent` (junto com `shown_list` e `history`, no mesmo `asyncio.gather`) e a repassar para `run_agent` → `build_system_prompt`.
- Em conversa nova (sem lead), todos os campos chegam vazios.

**`app/agent/prompt.py` — `build_system_prompt`:**
- Nova assinatura: `build_system_prompt(store, shown_list, lead)` onde `lead` é o dict de `get_lead` ou `None`.
- Injeta as chaves:
  - `{{nome_lead}}` → `lead["name"]` ou string vazia.
  - `{{pedido}}` → pedido atual formatado em texto legível (ex.: `2x Cropped rosa P; 1x Legging preta M`) ou `(nenhum item ainda)`.
  - `{{forma_pagamento}}` / `{{forma_entrega}}` → valor atual ou `(não definido)`.
- Helper `_format_pedido(itens: list) -> str` para a renderização legível.

> Nota: já existe um `{{nome}}` literal no prompt atual (linha ~82) usado como **instrução de exemplo** para o agente personalizar a frase. É conceito diferente de `{{nome_lead}}` (valor real do banco). A reescrita do prompt elimina a ambiguidade: `{{nome_lead}}` será o valor real injetado; exemplos de personalização não usarão chaves que pareçam variáveis de sistema.

### 3. Escrita do estado via tool (melhoria #3-escrita)

**`app/agent/tools.py` — `registrar_pedido`:**
- Assinatura: `registrar_pedido(db, store_id, conversation_id, itens, forma_pagamento, forma_entrega)`.
- Faz **upsert** em `leads` por `conversation_id`:
  - Se não existe linha: cria (`name` nulo, `source='chat'`) com os campos de pedido.
  - Se existe: atualiza só os campos fornecidos (`pedido` sempre substitui inteiro = fonte única de verdade; `forma_pagamento`/`forma_entrega` só sobrescrevem se vierem preenchidos).
- Retorna uma string curta de confirmação para o agente (ex.: `Pedido atualizado: 2 itens, pagamento Pix, entrega Sedex.`).

**`app/db.py`:** novos métodos `upsert_lead_order(conversation_id, store_id, pedido, forma_pagamento, forma_entrega)` (ou estender `create_lead`/`update_lead`). Implementado via `INSERT ... ON CONFLICT (conversation_id) DO UPDATE`.

**`app/agent/runner.py`:**
- Novo `TOOL_SCHEMA_REGISTRAR` com parâmetros: `itens` (array de objetos), `forma_pagamento` (string opcional), `forma_entrega` (string opcional).
- Adicionado à lista `tools=[...]` da chamada LLM.
- Novo branch no loop de tool calls que invoca `registrar_pedido` e devolve a confirmação como mensagem `tool`.
- `run_agent` recebe `conversation_id` (hoje não recebe) para passar à tool.

**Sequenciamento (sem corrida):** `REGISTRAR_PEDIDO` roda *durante* `run_agent`; `run_lead` roda *depois* em `pipeline.py`, na mesma linha (mesmo `conversation_id`). `run_lead` continua só mexendo em nome/whatsapp/email/cep/interest_summary; não toca em pedido/pagamento/entrega.

### 4. System prompt reestruturado (melhorias #1 e #2)

**`app/db.py`:** `get_store_settings` passa a selecionar `service_steps` e `faq`. **`app/models.py`:** `StoreSettings` ganha `service_steps: list[str]` e `faq: list[dict]`.

**`app/agent/prompt.py`:** prompt reescrito com seções numeradas, mantendo as regras atuais de tom/ferramentas/cards. Espinha dorsal padrão (sempre presente):

1. **Saudação** — varia abertura.
2. **Descoberta da intenção** — entende o que o cliente busca antes de oferecer.
3. **Mostrar produtos** — regras atuais de BUSCAR_PRODUTOS / LISTAR_CATEGORIA / cards.
4. **Captura de lead + fechamento** — ao detectar intenção de compra: registra o pedido via `REGISTRAR_PEDIDO` e, na mesma frase, pede nome, WhatsApp, email **e** pergunta a forma de pagamento e a forma de entrega (dentre as opções configuradas da loja).
5. **Encaminhamento** — confirma dados, avisa que o vendedor entra em contato, oferece contatos da loja.

Complementos da loja:
- Se `service_steps` não vazio → seção "Etapas específicas desta loja" com os passos configurados, refinando a espinha dorsal.
- Se `faq` não vazio → seção "Perguntas frequentes" listando `pergunta`/`resposta` para o agente responder dúvidas comuns sem inventar.

Estado atual do atendimento (injetado): bloco com `{{nome_lead}}`, `{{pedido}}`, `{{forma_pagamento}}`, `{{forma_entrega}}` e o "Já mostrado" existente — para o agente nunca reconstruir da memória.

### 5. UI Fila de Leads

**`src/actions/leads.ts`:**
- `LeadRow` ganha `pedido` (lista tipada), `formaPagamento: string | null`, `formaEntrega: string | null`.
- `getLeads` seleciona `pedido, forma_pagamento, forma_entrega` e mapeia.

**`src/components/leads/LeadsView.tsx`:**
- No painel expandido "Ver detalhes", adicionar 3 blocos: **PEDIDO** (itens formatados, ex.: "2x Cropped rosa P"), **FORMA DE PAGAMENTO**, **FORMA DE ENTREGA**. Mesma estética dos campos atuais (NOME/EMAIL/CEP); "Não informado" quando vazio.

**`src/types/database.ts`:** linhas de `leads` (Row/Insert/Update) ganham `pedido`, `forma_pagamento`, `forma_entrega`.

### 6. Testes

- `tests/test_prompt.py`: `{{nome_lead}}`/`{{pedido}}`/`{{forma_pagamento}}`/`{{forma_entrega}}` injetados corretamente (com e sem lead); etapas padrão presentes; `service_steps` e `faq` da loja aparecem quando configurados; ausentes quando vazios.
- `tests/test_tools.py`: `registrar_pedido` cria linha quando não existe e atualiza quando existe; `pedido` substitui inteiro; pagamento/entrega só sobrescrevem se preenchidos.
- `tests/test_runner.py`: tool `REGISTRAR_PEDIDO` é roteada e o resultado volta como mensagem `tool`; `conversation_id` é repassado.
- `tests/test_branch_lead.py`: `run_lead` continua sem tocar em pedido/pagamento/entrega.
- `tests/test_pipeline.py`: lead buscado antes do agente e passado ao prompt.
- DB: `get_lead` retorna os novos campos.

## Fora de escopo

- Edição manual do pedido pelo vendedor na UI (só leitura por enquanto).
- Relatórios/agregações sobre pedidos.
- Validação de estoque no momento de registrar pedido.
- Cálculo automático de total/desconto a partir do pedido.

## Riscos e mitigações

- **Lead "sem contato" criado só com pedido:** a tool pode criar uma linha antes de o cliente dar nome/WhatsApp. Mitigação: o `run_lead` posterior completa a mesma linha; a Fila de Leads já lida com `name` nulo ("Sem nome"). Aceitável — pedido sem contato ainda é sinal útil.
- **LLM errar o JSON do pedido:** `itens` mal-formado. Mitigação: validar/normalizar na tool antes do upsert; ignorar itens inválidos; nunca derrubar o turno (try/except com log, padrão do projeto).
- **Prompt mais longo** (etapas + FAQ + estado): aumento de tokens. Aceitável; FAQ e etapas só entram se configurados.
