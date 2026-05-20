# Workflow Melhorias (interest_summary, humanização, anti-repetição, painéis reais) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aprimorar o workflow n8n do chat agent em 4 frentes (síntese de interesse no lead, atendimento humanizado, fim das repetições de produtos, dois painéis com dados reais).

**Architecture:** Adicionar 3 fluxos paralelos ao webhook do workflow (Interest Summarizer, Gap Detector, Mention Extractor) que populam 1 coluna existente (`leads.interest_summary`) e 2 tabelas novas (`knowledge_gaps`, `product_mentions`). No app, criar 2 server actions e religar 2 componentes de painel que hoje usam mock.

**Tech Stack:** n8n (workflow JSON), Supabase (PostgreSQL + RLS), Next.js 16, React 19, OpenAI `gpt-5.4-mini`, Vitest 4 (testes existentes ficam intactos).

**Spec de referência:** `docs/superpowers/specs/2026-05-19-workflow-melhorias-design.md`

**Arquivo principal do workflow:** `n8n/workflow-chat-agent.json`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/027_knowledge_gaps.sql` (create) | Tabela `knowledge_gaps` + índices + RLS |
| `supabase/migrations/028_product_mentions.sql` (create) | Tabela `product_mentions` + índices + RLS |
| `n8n/workflow-chat-agent.json` (modify) | Adiciona 3 fluxos paralelos, reescreve system prompt, ajusta topK |
| `src/actions/painel.ts` (modify) | Adiciona `getKnowledgeGaps()` e `getProductIntent()` |
| `src/components/painel/GapsConhecimento.tsx` (rewrite) | Consome props reais, remove mock |
| `src/components/painel/IntentCatalogo.tsx` (rewrite) | Consome props reais, remove coluna VIEWS, remove mock |
| `src/components/painel/PainelDashboard.tsx` (modify) | Passa `gaps` e `intent` aos componentes |
| `src/app/painel/page.tsx` (modify) | Faz fetch das novas server actions |

---

## Task 1: Migration 027 — `knowledge_gaps`

**Files:**
- Create: `supabase/migrations/027_knowledge_gaps.sql`

- [ ] **Step 1: Criar o arquivo da migration**

Conteúdo:

```sql
-- 027_knowledge_gaps.sql
-- Tabela de perguntas sem resposta capturadas pelo Gap Detector do workflow
-- n8n. Consumida pelo painel `GapsConhecimento.tsx`.

CREATE TABLE knowledge_gaps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES store_settings(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  question        TEXT NOT NULL,
  tag             TEXT NOT NULL,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_kgaps_store_created ON knowledge_gaps (store_id, created_at DESC);
CREATE INDEX idx_kgaps_store_unresolved ON knowledge_gaps (store_id) WHERE resolved_at IS NULL;

ALTER TABLE knowledge_gaps ENABLE ROW LEVEL SECURITY;

-- Dono da loja vê tudo
CREATE POLICY "kgaps_owner_all" ON knowledge_gaps FOR ALL
  USING (auth.uid() = store_id);

-- O workflow n8n insere via service_role bypass; mas para o caso de inserir via
-- chave anon (não acontece hoje), permitimos insert irrestrito — store_id é
-- validado pelo FK.
CREATE POLICY "kgaps_service_insert" ON knowledge_gaps FOR INSERT WITH CHECK (true);
```

- [ ] **Step 2: Aplicar no Supabase**

Run no SQL Editor do Supabase: cole o conteúdo de `027_knowledge_gaps.sql` e execute.
Expected: "Success. No rows returned."

- [ ] **Step 3: Verificar criação**

Run no SQL Editor:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'knowledge_gaps' ORDER BY ordinal_position;
```
Expected: 7 colunas — id (uuid), store_id (uuid), conversation_id (uuid), question (text), tag (text), resolved_at (timestamp with time zone), created_at (timestamp with time zone).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/027_knowledge_gaps.sql
git commit -m "feat(db): add knowledge_gaps table for unanswered questions"
```

---

## Task 2: Migration 028 — `product_mentions`

**Files:**
- Create: `supabase/migrations/028_product_mentions.sql`

- [ ] **Step 1: Criar o arquivo da migration**

Conteúdo:

```sql
-- 028_product_mentions.sql
-- Tabela de menções de produtos no chat. Populada pelo Mention Extractor do
-- workflow n8n (matching por nome no output do AI Agent e na mensagem do
-- cliente). Consumida pelo painel `IntentCatalogo.tsx`.

CREATE TABLE product_mentions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id        UUID NOT NULL REFERENCES store_settings(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  source          TEXT NOT NULL CHECK (source IN ('ai_shown', 'customer_asked')),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pmentions_store_product ON product_mentions (store_id, product_id);
CREATE INDEX idx_pmentions_store_created ON product_mentions (store_id, created_at DESC);

ALTER TABLE product_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pmentions_owner_all" ON product_mentions FOR ALL
  USING (auth.uid() = store_id);

CREATE POLICY "pmentions_service_insert" ON product_mentions FOR INSERT WITH CHECK (true);
```

- [ ] **Step 2: Aplicar no Supabase**

Run no SQL Editor: cole o conteúdo de `028_product_mentions.sql` e execute.
Expected: "Success. No rows returned."

- [ ] **Step 3: Verificar criação**

Run no SQL Editor:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'product_mentions' ORDER BY ordinal_position;
```
Expected: 6 colunas — id, store_id, conversation_id, product_id, source, created_at.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/028_product_mentions.sql
git commit -m "feat(db): add product_mentions table for chat intent tracking"
```

---

## Task 3: Workflow — reescrever `systemMessage` do AI Agent2 e ajustar topK

Por que vir primeiro: as tasks de fluxo (4, 5, 6) referenciam decisões já tomadas no novo prompt. Fazer isto antes evita re-edições.

**Files:**
- Modify: `n8n/workflow-chat-agent.json`

- [ ] **Step 1: Substituir o `systemMessage` do nó `AI Agent2`**

Abra `n8n/workflow-chat-agent.json`. Localize o nó com `"name": "AI Agent2"` (id `04021648-9c43-4257-80c8-51f2378ac4a8`). O campo é `parameters.options.systemMessage`. Substitua TODO o valor desse campo por:

```
=# Quem você é
Vendedor virtual da {{ $('Informaçoes da loja1').item.json.store_name }}.
Atende como consultor amigo — não como vendedor de loja. Curioso, direto, simpático sem ser bajulador.
Descobre a intenção antes de oferecer.

# Como você fala
- Varie aberturas. Nunca comece duas mensagens iguais. Evite começar mensagens de produto com "Aqui estão...".
- Antes de listar produto, uma micro-validação curta: "boa pedida", "entendi", "deixa eu te mostrar", "achei isso aqui".
- Espelhe a energia: mensagem curta do cliente → resposta curta. Mensagem detalhada → você devolve detalhe.
- Uma pergunta por vez. Nunca peça cor + tamanho + ocasião juntos.
- Após um "não" claro: acolha e proponha algo diferente sem insistir ("Sem problemas. Quer ver outra coisa ou prefere continuar olhando?").
- Emoji: no máximo 1 por mensagem. Nunca em mensagem que é só preço/tamanho/cor.

# Contexto da loja
- Categorias: {{ $('Informaçoes da loja1').item.json.categories }}
- Pagamento: {{ $('Informaçoes da loja1').item.json.payment_methods }}
- Entrega: {{ $('Informaçoes da loja1').item.json.delivery_methods }}
- Instruções da loja: {{ $('Informaçoes da loja1').item.json.service_instructions }}

# Tool disponível
BUSCAR_PRODUTOS — busca semântica no catálogo. Use quando a conversa envolver disponibilidade, preço, tamanho, cor, recomendação ou comparação. A tool aceita linguagem natural ("blusa azul P", "vestido floral"). Nunca invente produto, preço, tamanho, cor ou estoque: use só o que vier da tool.

# Chamando a BUSCAR_PRODUTOS
Sempre passe DOIS parâmetros:
- `query`: termo livre (cor, ocasião, estilo, marca, atributo).
- `category`: a categoria EXATA da loja que casa com o pedido — copie do bloco "Categorias" acima. Se o pedido é vago, passe `category=""`.

A tool JÁ FILTRA pela categoria no banco. Ainda assim faça duas checagens em cada resultado:
1. O `name` tem "conjunto", "kit", "combo", "set", "dupla"? Se sim e o cliente pediu solo, descarte.
2. Se nada sobrar, NÃO invente — diga que não achou esse tipo e pergunte detalhes.

# Regra anti-repetição (CRÍTICO)
Antes de chamar BUSCAR_PRODUTOS, OLHE O HISTÓRICO DA CONVERSA e liste mentalmente todos os produtos que VOCÊ JÁ MOSTROU (por `name`). Você NUNCA repete um produto já mostrado na mesma conversa.

Quando o cliente pede "mais", "outros", "diferentes", "outra coisa" da mesma categoria:
- Acrescente um ATRIBUTO DIFERENTE no `query` (mude foco: se mostrou "floral", agora busca "liso"/"estampado"; se mostrou "preto", busca outra cor; se mostrou "cintura alta", busca "cintura baixa"). Isso muda o embedding e a ordenação.
- Ao receber os resultados, descarte TODOS os nomes que já apareceram na conversa.
- Se sobrar 1-3 itens novos, mostre todos. Se sobrarem zero: chame a tool de novo com query ainda mais distinta (outro atributo). Se ainda assim zero, diga "não achei mais opções nessa linha, quer mudar o estilo?" e pergunte um atributo diferente.

# Apresentação de produtos
- Antes da lista, uma frase curta de transição (variar).
- Máximo 3 produtos por mensagem.
- Por produto: nome, preço (R$), tamanhos, cores, link da imagem. Omita campos vazios.
- Se cores ou tamanhos tiverem mais de 6 itens, mostre 5 e diga "e mais".

# Coleta de dados (outro sistema observa e registra)
Você só pede naturalmente, um dado por vez:
- Nome quando a conversa engatar.
- WhatsApp quando o cliente demonstrar interesse real (comprar, reservar).
- Email quando fizer sentido (catálogo, lista de espera).
Não peça tudo junto. Não insista em dado recusado.

# Don'ts
- Não invente nada (produto, preço, prazo, desconto).
- Não use mais de 1 emoji por mensagem.
- Não repita produto já mostrado na conversa.
- Não mostre produto que não bate com o pedido só porque a tool retornou.
- Não exponha falha de busca — se nada bater, redirecione com pergunta.
- Não force venda depois de "não" claro.
```

- [ ] **Step 2: Subir `topK` da tool BUSCAR_PRODUTOS de 5 para 12**

No mesmo JSON, localize o nó com `"name": "BUSCAR_PRODUTOS"` (id `d95a19eb-26a4-4eff-b9e3-2b16c94fa863`). Em `parameters.topK`, trocar `5` por `12`.

- [ ] **Step 3: Validar o JSON com a MCP**

Run via MCP n8n-mcp: `mcp__n8n-mcp__validate_workflow` passando o JSON completo do arquivo.
Expected: validação passa (zero erros). Warnings sobre nodes não conectados ainda podem aparecer (vamos conectar nas próximas tasks); ignore só aqueles.

- [ ] **Step 4: Commit**

```bash
git add n8n/workflow-chat-agent.json
git commit -m "feat(n8n): humanize AI Agent prompt + anti-repetition rules + topK=12"
```

---

## Task 4: Workflow — Interest Summarizer

Adiciona 4 nós: `Get Recent Messages` (Postgres), `Interest Summarizer` (LLM Chain), `Parse Interest` (Code), `Update Lead Interest` (Supabase). Mais um LM node `OpenAI Chat Model - Interest` para alimentar o Summarizer.

Conectados em sequência DEPOIS de `Update Lead` E `Create Lead` (os dois apontam para `Get Recent Messages`).

**Files:**
- Modify: `n8n/workflow-chat-agent.json`

- [ ] **Step 1: Adicionar os nós ao array `nodes`**

Acrescentar estes 5 nós ao array `nodes`:

```json
{
  "parameters": {
    "operation": "executeQuery",
    "query": "SELECT string_agg(role || ': ' || content, E'\\n') AS messages_text FROM (SELECT role, content, created_at FROM messages WHERE conversation_id = '{{ $('Parse Lead').item.json.conversation_id }}' ORDER BY created_at DESC LIMIT 10) sub",
    "options": {}
  },
  "id": "i1a2b3c4-d5e6-4789-0123-456789abcdef",
  "name": "Get Recent Messages",
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.4,
  "position": [2096, -1600],
  "credentials": {
    "postgres": {
      "id": "5LgfkDaHLkpMWYfd",
      "name": "Postgres account 3"
    }
  }
},
{
  "parameters": {
    "promptType": "define",
    "text": "=Mensagens recentes (mais recente primeiro):\n{{ $json.messages_text }}",
    "options": {
      "systemMessage": "Você sintetiza o interesse do cliente para o vendedor humano que vai assumir. Em 1-2 frases (até ~200 caracteres), descreva: categoria/tipo de produto procurado, atributos mencionados (cor, tamanho, ocasião, estilo, faixa de preço). Não invente nada. Se a conversa não revelou interesse claro, devolva exatamente null. Sem markdown, sem aspas, sem prefixar com 'O cliente...' — vá direto ao ponto."
    }
  },
  "id": "i2b3c4d5-e6f7-4890-1234-56789abcdef0",
  "name": "Interest Summarizer",
  "type": "@n8n/n8n-nodes-langchain.agent",
  "typeVersion": 3.1,
  "position": [2320, -1600]
},
{
  "parameters": {
    "model": {
      "__rl": true,
      "value": "gpt-5.4-mini",
      "mode": "list",
      "cachedResultName": "gpt-5.4-mini"
    },
    "builtInTools": {},
    "options": {}
  },
  "id": "i3c4d5e6-f7a8-4901-2345-6789abcdef01",
  "name": "OpenAI Chat Model - Interest",
  "type": "@n8n/n8n-nodes-langchain.lmChatOpenAi",
  "typeVersion": 1.3,
  "position": [2320, -1820],
  "credentials": {
    "openAiApi": {
      "id": "9P4hWIaS93nW5FhK",
      "name": "OpenAi account"
    }
  }
},
{
  "parameters": {
    "jsCode": "const raw = String($input.first().json.output ?? '').trim();\nconst cleaned = raw.replace(/^```(?:json)?\\s*|\\s*```$/g, '').trim();\nconst summary = (!cleaned || cleaned.toLowerCase() === 'null') ? null : cleaned;\nreturn [{ json: {\n  interest_summary: summary,\n  conversation_id: $('Parse Lead').item.json.conversation_id,\n  store_id: $('Parse Lead').item.json.store_id,\n  has_summary: !!summary,\n} }];"
  },
  "id": "i4d5e6f7-a8b9-4012-3456-789abcdef012",
  "name": "Parse Interest",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [2544, -1600]
},
{
  "parameters": {
    "operation": "update",
    "tableId": "leads",
    "filterType": "manual",
    "matchType": "allFilters",
    "filters": {
      "conditions": [
        {
          "keyName": "conversation_id",
          "condition": "eq",
          "keyValue": "={{ $json.conversation_id }}"
        },
        {
          "keyName": "store_id",
          "condition": "eq",
          "keyValue": "={{ $json.store_id }}"
        }
      ]
    },
    "fieldsUi": {
      "fieldValues": [
        {
          "fieldId": "interest_summary",
          "fieldValue": "={{ $json.interest_summary }}"
        }
      ]
    }
  },
  "id": "i5e6f7a8-b9c0-4123-4567-89abcdef0123",
  "name": "Update Lead Interest",
  "type": "n8n-nodes-base.supabase",
  "typeVersion": 1,
  "position": [2768, -1600],
  "credentials": {
    "supabaseApi": {
      "id": "kL2vt2LTVZNYDJZq",
      "name": "LUE FZ"
    }
  }
}
```

- [ ] **Step 2: Adicionar as conexões ao objeto `connections`**

No objeto `connections`, **localizar e MODIFICAR** `Update Lead` para apontar para `Get Recent Messages`:

```json
"Update Lead": {
  "main": [
    [
      {
        "node": "Get Recent Messages",
        "type": "main",
        "index": 0
      }
    ]
  ]
}
```

**Localizar e MODIFICAR** `Create Lead`:

```json
"Create Lead": {
  "main": [
    [
      {
        "node": "Get Recent Messages",
        "type": "main",
        "index": 0
      }
    ]
  ]
}
```

**Adicionar** estas novas entradas em `connections`:

```json
"Get Recent Messages": {
  "main": [
    [
      {
        "node": "Interest Summarizer",
        "type": "main",
        "index": 0
      }
    ]
  ]
},
"OpenAI Chat Model - Interest": {
  "ai_languageModel": [
    [
      {
        "node": "Interest Summarizer",
        "type": "ai_languageModel",
        "index": 0
      }
    ]
  ]
},
"Interest Summarizer": {
  "main": [
    [
      {
        "node": "Parse Interest",
        "type": "main",
        "index": 0
      }
    ]
  ]
},
"Parse Interest": {
  "main": [
    [
      {
        "node": "Update Lead Interest",
        "type": "main",
        "index": 0
      }
    ]
  ]
}
```

Nota: `Update Lead Interest` é nó terminal (sem outbound). Não adicionar entrada para ele.

- [ ] **Step 3: Acrescentar IF para só atualizar quando há resumo**

Para evitar gravar `null` em cima de um resumo prévio se a 2ª interação não tem sinal de interesse, inserir um nó IF entre `Parse Interest` e `Update Lead Interest`. Acrescentar este nó ao array `nodes`:

```json
{
  "parameters": {
    "conditions": {
      "options": {
        "caseSensitive": true,
        "leftValue": "",
        "typeValidation": "loose",
        "version": 2
      },
      "conditions": [
        {
          "id": "interest-c1",
          "leftValue": "={{ $json.has_summary }}",
          "rightValue": "",
          "operator": {
            "type": "boolean",
            "operation": "true",
            "singleValue": true
          }
        }
      ],
      "combinator": "and"
    },
    "options": {}
  },
  "id": "i6f7a8b9-c0d1-4234-5678-9abcdef01234",
  "name": "IF Has Interest",
  "type": "n8n-nodes-base.if",
  "typeVersion": 2.3,
  "position": [2656, -1600]
}
```

Substituir a conexão `Parse Interest` que acabou de criar por:

```json
"Parse Interest": {
  "main": [
    [
      {
        "node": "IF Has Interest",
        "type": "main",
        "index": 0
      }
    ]
  ]
},
"IF Has Interest": {
  "main": [
    [
      {
        "node": "Update Lead Interest",
        "type": "main",
        "index": 0
      }
    ]
  ]
}
```

Reposicionar `Update Lead Interest`: mudar `position` para `[2880, -1600]`.

- [ ] **Step 4: Validar o JSON**

Run via MCP: `mcp__n8n-mcp__validate_workflow` passando o JSON completo.
Expected: zero erros estruturais. Avisos sobre o `Get Catalog`/`Gap Detector` ainda não existirem (próximas tasks) são esperados.

- [ ] **Step 5: Commit**

```bash
git add n8n/workflow-chat-agent.json
git commit -m "feat(n8n): add Interest Summarizer flow to populate leads.interest_summary"
```

---

## Task 5: Workflow — Gap Detector

Adiciona 5 nós: `Gap Detector` (LLM agent), `OpenAI Chat Model - Gap` (LM), `Parse Gap` (Code), `IF Has Gap` (IF), `Insert Gap` (Supabase).

Conectados em paralelo a partir de `Informaçoes da loja1` (mesma origem do `AI Agent2` e `Lead Analyzer`).

**Files:**
- Modify: `n8n/workflow-chat-agent.json`

- [ ] **Step 1: Adicionar os nós ao array `nodes`**

```json
{
  "parameters": {
    "promptType": "define",
    "text": "=Mensagem do cliente: {{ $('Edit Fields').item.json.chatInput }}",
    "options": {
      "systemMessage": "=Você analisa a mensagem do cliente e detecta perguntas que a loja não consegue responder com as instruções abaixo.\n\nInstruções da loja:\n- Categorias: {{ $('Informaçoes da loja1').item.json.categories }}\n- Pagamento: {{ $('Informaçoes da loja1').item.json.payment_methods }}\n- Entrega: {{ $('Informaçoes da loja1').item.json.delivery_methods }}\n- Outras: {{ $('Informaçoes da loja1').item.json.service_instructions }}\n\nRetorne APENAS JSON puro, sem markdown, no formato:\n{\"is_gap\": true|false, \"question\": \"pergunta normalizada em minúsculas\", \"tag\": \"POLÍTICA DE ENTREGA\"|\"PRAZO\"|\"ATACADO\"|\"SKU INEXISTENTE\"|\"PAGAMENTO\"|\"OUTROS\"}\n\nMarque is_gap=true APENAS se:\n- A mensagem contém pergunta concreta (com '?' ou claramente interrogativa).\n- A resposta NÃO está nas instruções acima.\n- A pergunta NÃO é sobre um produto específico do catálogo (isso é trabalho do vendedor).\n\nMarque is_gap=false se: saudação, comentário, declaração de interesse, pergunta sobre produto/cor/tamanho específico, ou pergunta já coberta pelas instruções acima.\n\nSe is_gap=false, devolva question=\"\" e tag=\"OUTROS\"."
    }
  },
  "id": "g1a2b3c4-d5e6-4789-abcd-ef0123456789",
  "name": "Gap Detector",
  "type": "@n8n/n8n-nodes-langchain.agent",
  "typeVersion": 3.1,
  "position": [752, -880]
},
{
  "parameters": {
    "model": {
      "__rl": true,
      "value": "gpt-5.4-mini",
      "mode": "list",
      "cachedResultName": "gpt-5.4-mini"
    },
    "builtInTools": {},
    "options": {}
  },
  "id": "g2b3c4d5-e6f7-4890-bcde-f01234567890",
  "name": "OpenAI Chat Model - Gap",
  "type": "@n8n/n8n-nodes-langchain.lmChatOpenAi",
  "typeVersion": 1.3,
  "position": [752, -660],
  "credentials": {
    "openAiApi": {
      "id": "9P4hWIaS93nW5FhK",
      "name": "OpenAi account"
    }
  }
},
{
  "parameters": {
    "jsCode": "const raw = String($input.first().json.output ?? '');\nlet parsed = { is_gap: false, question: '', tag: 'OUTROS' };\ntry {\n  const cleaned = raw.replace(/^```(?:json)?\\s*|\\s*```$/g, '').trim();\n  const obj = JSON.parse(cleaned);\n  parsed = {\n    is_gap: !!obj?.is_gap,\n    question: String(obj?.question ?? '').toLowerCase().trim(),\n    tag: String(obj?.tag ?? 'OUTROS').toUpperCase().trim(),\n  };\n} catch (e) {}\nconst valid = parsed.is_gap && parsed.question.length > 0;\nreturn [{ json: {\n  is_gap: valid,\n  question: parsed.question,\n  tag: parsed.tag,\n  conversation_id: $('Edit Fields').item.json.sessionId,\n  store_id: $('Edit Fields').item.json.store_id,\n} }];"
  },
  "id": "g3c4d5e6-f7a8-4901-cdef-012345678901",
  "name": "Parse Gap",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [976, -880]
},
{
  "parameters": {
    "conditions": {
      "options": {
        "caseSensitive": true,
        "leftValue": "",
        "typeValidation": "loose",
        "version": 2
      },
      "conditions": [
        {
          "id": "gap-c1",
          "leftValue": "={{ $json.is_gap }}",
          "rightValue": "",
          "operator": {
            "type": "boolean",
            "operation": "true",
            "singleValue": true
          }
        }
      ],
      "combinator": "and"
    },
    "options": {}
  },
  "id": "g4d5e6f7-a8b9-4012-def0-123456789012",
  "name": "IF Has Gap",
  "type": "n8n-nodes-base.if",
  "typeVersion": 2.3,
  "position": [1200, -880]
},
{
  "parameters": {
    "operation": "insert",
    "tableId": "knowledge_gaps",
    "fieldsUi": {
      "fieldValues": [
        {
          "fieldId": "store_id",
          "fieldValue": "={{ $json.store_id }}"
        },
        {
          "fieldId": "conversation_id",
          "fieldValue": "={{ $json.conversation_id }}"
        },
        {
          "fieldId": "question",
          "fieldValue": "={{ $json.question }}"
        },
        {
          "fieldId": "tag",
          "fieldValue": "={{ $json.tag }}"
        }
      ]
    }
  },
  "id": "g5e6f7a8-b9c0-4123-ef01-234567890123",
  "name": "Insert Gap",
  "type": "n8n-nodes-base.supabase",
  "typeVersion": 1,
  "position": [1424, -880],
  "credentials": {
    "supabaseApi": {
      "id": "kL2vt2LTVZNYDJZq",
      "name": "LUE FZ"
    }
  }
}
```

- [ ] **Step 2: Adicionar Gap Detector às saídas do `Informaçoes da loja1`**

Localizar `Informaçoes da loja1` em `connections`. Hoje ele tem dois destinos (`AI Agent2` e `Lead Analyzer`). Adicionar um terceiro:

```json
"Informaçoes da loja1": {
  "main": [
    [
      {
        "node": "AI Agent2",
        "type": "main",
        "index": 0
      },
      {
        "node": "Lead Analyzer",
        "type": "main",
        "index": 0
      },
      {
        "node": "Gap Detector",
        "type": "main",
        "index": 0
      }
    ]
  ]
}
```

Acrescentar estas conexões novas:

```json
"OpenAI Chat Model - Gap": {
  "ai_languageModel": [
    [
      {
        "node": "Gap Detector",
        "type": "ai_languageModel",
        "index": 0
      }
    ]
  ]
},
"Gap Detector": {
  "main": [
    [
      {
        "node": "Parse Gap",
        "type": "main",
        "index": 0
      }
    ]
  ]
},
"Parse Gap": {
  "main": [
    [
      {
        "node": "IF Has Gap",
        "type": "main",
        "index": 0
      }
    ]
  ]
},
"IF Has Gap": {
  "main": [
    [
      {
        "node": "Insert Gap",
        "type": "main",
        "index": 0
      }
    ]
  ]
}
```

- [ ] **Step 3: Validar o JSON**

Run via MCP: `mcp__n8n-mcp__validate_workflow`.
Expected: zero erros estruturais.

- [ ] **Step 4: Commit**

```bash
git add n8n/workflow-chat-agent.json
git commit -m "feat(n8n): add Gap Detector to capture unanswered customer questions"
```

---

## Task 6: Workflow — Mention Extractor

Adiciona 3 nós: `Get Catalog` (Supabase), `Match Mentions` (Code), `Insert Mentions` (Supabase).

Posicionado entre `AI Agent2` e `Respond to Webhook` — não bloqueia a resposta porque o nó Supabase é sequencial mas rápido.

**Files:**
- Modify: `n8n/workflow-chat-agent.json`

- [ ] **Step 1: Adicionar os nós ao array `nodes`**

```json
{
  "parameters": {
    "operation": "getAll",
    "tableId": "products",
    "returnAll": true,
    "filterType": "manual",
    "matchType": "allFilters",
    "filters": {
      "conditions": [
        {
          "keyName": "user_id",
          "condition": "eq",
          "keyValue": "={{ $('Edit Fields').item.json.store_id }}"
        }
      ]
    }
  },
  "id": "m1a2b3c4-d5e6-4789-fedc-ba9876543210",
  "name": "Get Catalog",
  "type": "n8n-nodes-base.supabase",
  "typeVersion": 1,
  "position": [1136, -1180],
  "alwaysOutputData": true,
  "credentials": {
    "supabaseApi": {
      "id": "kL2vt2LTVZNYDJZq",
      "name": "LUE FZ"
    }
  }
},
{
  "parameters": {
    "jsCode": "const items = $input.all().map(i => i.json).filter(p => p && p.id && p.name);\nconst aiOutput = String($('AI Agent2').item.json.output ?? '');\nconst customerMsg = String($('Edit Fields').item.json.chatInput ?? '');\nconst conversation_id = $('Edit Fields').item.json.sessionId;\nconst store_id = $('Edit Fields').item.json.store_id;\n\n// Ordena por tamanho do nome desc para que matches mais específicos ganhem.\nconst products = items.slice().sort((a, b) => b.name.length - a.name.length);\n\nfunction escapeReg(s) { return s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'); }\n\nfunction findMatches(text, source) {\n  // Substitui faixas já consumidas por espaços para evitar dupla contagem em sobreposição.\n  let buffer = text;\n  const results = [];\n  for (const p of products) {\n    const re = new RegExp(`\\\\b${escapeReg(p.name)}\\\\b`, 'i');\n    if (re.test(buffer)) {\n      results.push({ product_id: p.id, source, store_id, conversation_id });\n      buffer = buffer.replace(new RegExp(`\\\\b${escapeReg(p.name)}\\\\b`, 'gi'), (m) => ' '.repeat(m.length));\n    }\n  }\n  return results;\n}\n\nconst rows = [\n  ...findMatches(aiOutput, 'ai_shown'),\n  ...findMatches(customerMsg, 'customer_asked'),\n];\n\nreturn rows.map(r => ({ json: r }));"
  },
  "id": "m2b3c4d5-e6f7-4890-edcb-a98765432109",
  "name": "Match Mentions",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [1360, -1180]
},
{
  "parameters": {
    "operation": "insert",
    "tableId": "product_mentions",
    "fieldsUi": {
      "fieldValues": [
        {
          "fieldId": "store_id",
          "fieldValue": "={{ $json.store_id }}"
        },
        {
          "fieldId": "conversation_id",
          "fieldValue": "={{ $json.conversation_id }}"
        },
        {
          "fieldId": "product_id",
          "fieldValue": "={{ $json.product_id }}"
        },
        {
          "fieldId": "source",
          "fieldValue": "={{ $json.source }}"
        }
      ]
    }
  },
  "id": "m3c4d5e6-f7a8-4901-dcba-987654321098",
  "name": "Insert Mentions",
  "type": "n8n-nodes-base.supabase",
  "typeVersion": 1,
  "position": [1584, -1180],
  "credentials": {
    "supabaseApi": {
      "id": "kL2vt2LTVZNYDJZq",
      "name": "LUE FZ"
    }
  }
}
```

- [ ] **Step 2: Redirecionar a saída do `AI Agent2`**

Localizar `AI Agent2` em `connections`. Hoje aponta direto para `Respond to Webhook`. Modificar para apontar para `Get Catalog`, e adicionar a cadeia até `Respond to Webhook`:

```json
"AI Agent2": {
  "main": [
    [
      {
        "node": "Get Catalog",
        "type": "main",
        "index": 0
      },
      {
        "node": "Respond to Webhook",
        "type": "main",
        "index": 0
      }
    ]
  ]
}
```

Nota importante: usamos **fan-out** — o output do AI Agent2 vai pra `Get Catalog` E pra `Respond to Webhook` simultaneamente, garantindo que a resposta ao cliente NÃO espera o Mention Extractor terminar (zero impacto na latência percebida).

Acrescentar estas conexões:

```json
"Get Catalog": {
  "main": [
    [
      {
        "node": "Match Mentions",
        "type": "main",
        "index": 0
      }
    ]
  ]
},
"Match Mentions": {
  "main": [
    [
      {
        "node": "Insert Mentions",
        "type": "main",
        "index": 0
      }
    ]
  ]
}
```

- [ ] **Step 3: Validar o JSON**

Run via MCP: `mcp__n8n-mcp__validate_workflow`.
Expected: zero erros estruturais.

- [ ] **Step 4: Importar no n8n e fazer smoke test**

Importar o JSON atualizado na instância n8n (`https://nutramim-n8n.ev7c2h.easypanel.host`). Disparar uma execução de teste via UI ou via webhook com payload:

```json
{
  "mensagem": "tem algum top floral?",
  "id_mensagem": "test-1",
  "id_conversa": "92ee6d49-7dad-47f1-99ad-5f2ff13fc818",
  "nome_loja": "Teste",
  "id_loja": "c96ad899-bdaf-4ed4-919d-6f596e0f7db8",
  "tipo_de_mensagem": "text"
}
```

Expected: todos os fluxos executam sem erro. Conferir no Supabase:
- `product_mentions` ganhou linhas com `source='ai_shown'` para os produtos citados na resposta.
- Nada em `knowledge_gaps` (não foi pergunta de política).

- [ ] **Step 5: Commit**

```bash
git add n8n/workflow-chat-agent.json
git commit -m "feat(n8n): add Mention Extractor to record products cited in chat"
```

---

## Task 7: Server action `getKnowledgeGaps`

**Files:**
- Modify: `src/actions/painel.ts`

- [ ] **Step 1: Adicionar o tipo e a função ao final de `src/actions/painel.ts`**

```ts
export interface KnowledgeGap {
  count: number
  question: string
  tag: string
}

// Top 5 perguntas sem resposta agregadas por pergunta (lowercase trim),
// considerando apenas as não resolvidas (resolved_at IS NULL). Usado pelo
// painel `GapsConhecimento.tsx`.
export async function getKnowledgeGaps(): Promise<{
  items: KnowledgeGap[]
  totalPending: number
}> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { items: [], totalPending: 0 }

  const { data, error } = await supabase
    .from('knowledge_gaps')
    .select('question, tag')
    .eq('store_id', user.id)
    .is('resolved_at', null)
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) {
    console.error('getKnowledgeGaps error', error)
    return { items: [], totalPending: 0 }
  }

  const rows = data ?? []
  const buckets = new Map<string, { count: number; question: string; tag: string }>()
  for (const r of rows) {
    const key = r.question.toLowerCase().trim()
    const existing = buckets.get(key)
    if (existing) {
      existing.count += 1
    } else {
      buckets.set(key, { count: 1, question: r.question, tag: r.tag })
    }
  }

  const items = [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return { items, totalPending: rows.length }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos. O erro pré-existente em `src/app/api/inventory/import/route.ts` (`user_id` faltando) é aceitável.

- [ ] **Step 3: Commit**

```bash
git add src/actions/painel.ts
git commit -m "feat(painel): add getKnowledgeGaps server action"
```

---

## Task 8: Server action `getProductIntent`

**Files:**
- Modify: `src/actions/painel.ts`

- [ ] **Step 1: Adicionar o tipo e a função ao final de `src/actions/painel.ts`**

```ts
export interface ProductIntent {
  productId: string
  name: string
  mentions: number
  leads: number
  hasDesc: boolean
  hasPhoto: boolean
  status: 'OK' | 'DESC VAZIA' | 'SEM FOTO' | 'STOCK OUT'
}

// Agrega `product_mentions` por produto no range pedido. `leads` conta
// conversation_ids distintos com menção do produto E lead capturado naquela
// conversa. Usado pelo painel `IntentCatalogo.tsx`.
export async function getProductIntent(
  range: FunnelRange = 'month',
): Promise<{ items: ProductIntent[]; totalProducts: number; withIssues: number }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { items: [], totalProducts: 0, withIssues: 0 }

  const store = user.id
  const start = rangeStart(new Date(), range).toISOString()

  const [mentionsRes, leadsConvsRes, productsRes] = await Promise.all([
    supabase
      .from('product_mentions')
      .select('product_id, conversation_id')
      .eq('store_id', store)
      .gte('created_at', start),
    supabase
      .from('leads')
      .select('conversation_id')
      .eq('store_id', store)
      .not('conversation_id', 'is', null),
    supabase
      .from('products')
      .select('id, name, description, image_urls, stock_quantity')
      .eq('user_id', store),
  ])

  if (mentionsRes.error) console.error('getProductIntent mentions error', mentionsRes.error)
  if (leadsConvsRes.error) console.error('getProductIntent leads error', leadsConvsRes.error)
  if (productsRes.error) console.error('getProductIntent products error', productsRes.error)

  const mentions = mentionsRes.data ?? []
  const leadConvIds = new Set(
    (leadsConvsRes.data ?? []).map((l) => l.conversation_id),
  )
  const products = productsRes.data ?? []

  // Agrega por produto.
  const perProduct = new Map<
    string,
    { mentions: number; leadConvs: Set<string> }
  >()
  for (const m of mentions) {
    let bucket = perProduct.get(m.product_id)
    if (!bucket) {
      bucket = { mentions: 0, leadConvs: new Set<string>() }
      perProduct.set(m.product_id, bucket)
    }
    bucket.mentions += 1
    if (m.conversation_id && leadConvIds.has(m.conversation_id)) {
      bucket.leadConvs.add(m.conversation_id)
    }
  }

  const items: ProductIntent[] = products
    .filter((p) => perProduct.has(p.id))
    .map((p) => {
      const agg = perProduct.get(p.id)!
      const hasDesc = !!p.description && p.description.trim().length > 0
      const hasPhoto = Array.isArray(p.image_urls) && p.image_urls.length > 0
      const stockOut = (p.stock_quantity ?? 0) <= 0
      const status: ProductIntent['status'] = stockOut
        ? 'STOCK OUT'
        : !hasDesc
          ? 'DESC VAZIA'
          : !hasPhoto
            ? 'SEM FOTO'
            : 'OK'
      return {
        productId: p.id,
        name: p.name,
        mentions: agg.mentions,
        leads: agg.leadConvs.size,
        hasDesc,
        hasPhoto,
        status,
      }
    })
    .sort((a, b) => b.mentions - a.mentions)
    .slice(0, 5)

  const withIssues = products.filter((p) => {
    const hasDesc = !!p.description && p.description.trim().length > 0
    const hasPhoto = Array.isArray(p.image_urls) && p.image_urls.length > 0
    const stockOut = (p.stock_quantity ?? 0) <= 0
    return stockOut || !hasDesc || !hasPhoto
  }).length

  return { items, totalProducts: products.length, withIssues }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 3: Commit**

```bash
git add src/actions/painel.ts
git commit -m "feat(painel): add getProductIntent server action"
```

---

## Task 9: Religar `GapsConhecimento.tsx` aos dados reais

**Files:**
- Modify (rewrite): `src/components/painel/GapsConhecimento.tsx`

- [ ] **Step 1: Substituir TODO o conteúdo do arquivo por**:

```tsx
'use client'

import type { KnowledgeGap } from '@/actions/painel'
import { Icon } from './Icons'

export function GapsConhecimento({
  gaps,
  totalPending,
}: {
  gaps: KnowledgeGap[]
  totalPending: number
}) {
  return (
    <div className="card p-0 h-full flex flex-col">
      <div className="flex items-end justify-between px-6 pt-6 pb-5">
        <div>
          <div className="eyebrow text-ink-500">RAG · GAPS DE CONHECIMENTO</div>
          <h2
            className="font-display font-bold text-ink-900 tracking-tight mt-1"
            style={{ fontSize: '20px' }}
          >
            Perguntas sem resposta
          </h2>
        </div>
        <button className="text-[12.5px] font-semibold text-brand-700 hover:text-brand-800 inline-flex items-center gap-1">
          Abrir todos · {totalPending}{' '}
          <Icon name="arrow" className="w-3.5 h-3.5" />
        </button>
      </div>

      {gaps.length === 0 ? (
        <div className="px-6 py-10 text-center text-[13px] text-ink-500 border-t border-ink-100 flex-1">
          Nenhuma pergunta sem resposta na última semana.
        </div>
      ) : (
        <ul className="divide-y divide-ink-100 border-t border-ink-100 flex-1">
          {gaps.map((g) => (
            <li
              key={g.question}
              className="px-6 py-3 flex items-center gap-3"
            >
              <span className="font-mono tabular text-[12px] font-semibold text-brand-700 bg-brand-50 ring-1 ring-brand-100 px-1.5 py-0.5 rounded-md min-w-[42px] text-center">
                {g.count}×
              </span>
              <span className="text-[13.5px] text-ink-800 flex-1 truncate">
                &ldquo;{g.question}&rdquo;
              </span>
              <span className="eyebrow text-ink-400 shrink-0">{g.tag}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="px-6 py-4 border-t border-ink-100 bg-ink-50/40">
        <button className="w-full inline-flex items-center justify-center gap-2 text-[13px] font-semibold text-ink-900 bg-white ring-1 ring-ink-200 hover:ring-brand-300 hover:text-brand-700 px-4 py-2.5 rounded-xl">
          <Icon name="sparkle" className="w-4 h-4" />
          Completar respostas no catálogo
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: ESPERADO 1 erro novo em `src/components/painel/PainelDashboard.tsx` — `<GapsConhecimento />` é renderizado sem as novas props. Esse erro é resolvido na Task 11.

- [ ] **Step 3: Commit**

```bash
git add src/components/painel/GapsConhecimento.tsx
git commit -m "feat(painel): wire GapsConhecimento to real knowledge_gaps data"
```

---

## Task 10: Religar `IntentCatalogo.tsx` aos dados reais

**Files:**
- Modify (rewrite): `src/components/painel/IntentCatalogo.tsx`

- [ ] **Step 1: Substituir TODO o conteúdo do arquivo por**:

```tsx
'use client'

import type { ProductIntent } from '@/actions/painel'
import { Icon } from './Icons'

const STATUS_CLS: Record<ProductIntent['status'], string> = {
  OK: 'text-success-700 bg-success-50 ring-success-100',
  'DESC VAZIA': 'text-warn-700 bg-warn-50 ring-warn-100',
  'SEM FOTO': 'text-warn-700 bg-warn-50 ring-warn-100',
  'STOCK OUT': 'text-danger-700 bg-danger-50 ring-danger-100',
}

function CheckCell({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="font-mono text-success-700">✓</span>
  ) : (
    <span className="font-mono text-ink-300">—</span>
  )
}

export function IntentCatalogo({
  items,
  totalProducts,
  withIssues,
}: {
  items: ProductIntent[]
  totalProducts: number
  withIssues: number
}) {
  return (
    <div className="card p-0">
      <div className="flex items-end justify-between px-6 pt-6 pb-5">
        <div>
          <div className="eyebrow text-ink-500">INTENT · MAIO</div>
          <h2
            className="font-display font-bold text-ink-900 tracking-tight mt-1"
            style={{ fontSize: '20px' }}
          >
            Produtos × menções no chat × leads
          </h2>
        </div>
        <button className="text-[12.5px] font-semibold text-ink-600 hover:text-ink-900 inline-flex items-center gap-1">
          Ordenar: menções <Icon name="chev" className="w-3.5 h-3.5" />
        </button>
      </div>

      {items.length === 0 ? (
        <div className="px-6 py-10 text-center text-[13px] text-ink-500 border-y border-ink-100">
          Sem menções de produtos nas conversas ainda.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-ink-50/60 border-y border-ink-100">
                <th className="eyebrow text-ink-400 text-left  px-6 py-2 font-normal">PRODUTO</th>
                <th className="eyebrow text-ink-400 text-right px-3 py-2 font-normal">MENÇÕES</th>
                <th className="eyebrow text-ink-400 text-right px-3 py-2 font-normal">LEADS</th>
                <th className="eyebrow text-ink-400 text-center px-3 py-2 font-normal">DESC.</th>
                <th className="eyebrow text-ink-400 text-center px-3 py-2 font-normal">FOTO</th>
                <th className="eyebrow text-ink-400 text-left  px-3 py-2 pr-6 font-normal">STATUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {items.map((p) => (
                <tr key={p.productId} className="text-[13px]">
                  <td className="px-6 py-3 text-ink-900 font-semibold">{p.name}</td>
                  <td className="px-3 py-3 text-right font-mono tabular text-ink-700">{p.mentions}</td>
                  <td className="px-3 py-3 text-right font-mono tabular font-semibold text-ink-900">{p.leads}</td>
                  <td className="px-3 py-3 text-center"><CheckCell ok={p.hasDesc} /></td>
                  <td className="px-3 py-3 text-center"><CheckCell ok={p.hasPhoto} /></td>
                  <td className="px-3 py-3 pr-6">
                    <span className={`eyebrow text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md ring-1 ${STATUS_CLS[p.status]}`}>
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-6 py-4 border-t border-ink-100 bg-ink-50/40 flex items-center justify-between">
        <span className="eyebrow text-ink-500">
          {totalProducts} produtos no catálogo · {withIssues} com algum problema
        </span>
        <button className="text-[12.5px] font-semibold text-brand-700 hover:text-brand-800 inline-flex items-center gap-1">
          Ver todos <Icon name="arrow" className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: ESPERADO 1 erro novo em `src/components/painel/PainelDashboard.tsx` — `<IntentCatalogo />` é renderizado sem as novas props. Resolvido na Task 11.

- [ ] **Step 3: Commit**

```bash
git add src/components/painel/IntentCatalogo.tsx
git commit -m "feat(painel): wire IntentCatalogo to real product_mentions data (remove VIEWS column)"
```

---

## Task 11: Religar `PainelDashboard.tsx` e `page.tsx`

**Files:**
- Modify: `src/components/painel/PainelDashboard.tsx`
- Modify: `src/app/painel/page.tsx`

- [ ] **Step 1: Substituir TODO o conteúdo de `src/components/painel/PainelDashboard.tsx` por**:

```tsx
'use client'

import { useEffect, useState } from 'react'
import type {
  PainelPulse,
  FunnelData,
  ActivityEvent,
  KnowledgeGap,
  ProductIntent,
} from '@/actions/painel'
import { getFunnel } from '@/actions/painel'
import type { FunnelRange } from './formatters'
import { formatPainelClock } from './formatters'
import {
  useVisitorsPresence,
  usePainelPulse,
  usePainelActivity,
} from '@/lib/realtime-painel'
import { Topbar } from './Topbar'
import { Hero } from './Hero'
import { PulseStripe } from './PulseStripe'
import { FunilCaptura } from './FunilCaptura'
import { GapsConhecimento } from './GapsConhecimento'
import { IntentCatalogo } from './IntentCatalogo'
import { LivePulse } from './LivePulse'

export function PainelDashboard({
  storeId,
  initialPulse,
  initialFunnel,
  initialActivity,
  initialGaps,
  initialGapsTotal,
  initialIntent,
  initialIntentTotalProducts,
  initialIntentWithIssues,
  ownerName,
  dateLabel,
  greeting,
  initialClock,
}: {
  storeId: string
  initialPulse: PainelPulse
  initialFunnel: FunnelData
  initialActivity: ActivityEvent[]
  initialGaps: KnowledgeGap[]
  initialGapsTotal: number
  initialIntent: ProductIntent[]
  initialIntentTotalProducts: number
  initialIntentWithIssues: number
  ownerName: string
  dateLabel: string
  greeting: string
  initialClock: string
}) {
  const pulse = usePainelPulse(storeId, initialPulse)
  const visitors = useVisitorsPresence(storeId)
  const activity = usePainelActivity(storeId, initialActivity)

  const [range, setRange] = useState<FunnelRange>('month')
  const [funnel, setFunnel] = useState(initialFunnel)
  const [clock, setClock] = useState(initialClock)

  useEffect(() => {
    const id = setInterval(() => {
      setClock(formatPainelClock(new Date()))
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  const handleRangeChange = (r: FunnelRange) => {
    setRange(r)
    getFunnel(r)
      .then(setFunnel)
      .catch((err) => console.error('getFunnel failed', err))
  }

  return (
    <div className="max-w-[1280px] mx-auto px-8 py-7">
      <Topbar dateLabel={dateLabel} />
      <Hero
        pulse={pulse}
        greeting={greeting}
        clock={clock}
        activity={activity}
        ownerName={ownerName}
      />
      <PulseStripe pulse={pulse} visitors={visitors} />

      <section className="mt-10">
        <FunilCaptura
          funnel={funnel}
          range={range}
          onRangeChange={handleRangeChange}
        />
      </section>

      <section className="mt-6">
        <GapsConhecimento
          gaps={initialGaps}
          totalPending={initialGapsTotal}
        />
      </section>

      <section className="mt-6">
        <IntentCatalogo
          items={initialIntent}
          totalProducts={initialIntentTotalProducts}
          withIssues={initialIntentWithIssues}
        />
      </section>

      <LivePulse pulse={pulse} visitors={visitors} />
    </div>
  )
}
```

- [ ] **Step 2: Substituir TODO o conteúdo de `src/app/painel/page.tsx` por**:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getPainelPulse,
  getFunnel,
  getActivityFeed,
  getKnowledgeGaps,
  getProductIntent,
} from '@/actions/painel'
import {
  formatPainelDate,
  formatPainelClock,
  painelGreeting,
} from '@/components/painel/formatters'
import { PainelDashboard } from '@/components/painel/PainelDashboard'

export const dynamic = 'force-dynamic'

export default async function PainelPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [
    initialPulse,
    initialFunnel,
    initialActivity,
    gapsRes,
    intentRes,
    storeRes,
  ] = await Promise.all([
    getPainelPulse(),
    getFunnel('month'),
    getActivityFeed(),
    getKnowledgeGaps(),
    getProductIntent('month'),
    supabase
      .from('store_settings')
      .select('store_name')
      .eq('id', user.id)
      .maybeSingle(),
  ])
  const ownerName = storeRes.data?.store_name ?? ''
  const now = new Date()

  return (
    <PainelDashboard
      storeId={user.id}
      initialPulse={initialPulse}
      initialFunnel={initialFunnel}
      initialActivity={initialActivity}
      initialGaps={gapsRes.items}
      initialGapsTotal={gapsRes.totalPending}
      initialIntent={intentRes.items}
      initialIntentTotalProducts={intentRes.totalProducts}
      initialIntentWithIssues={intentRes.withIssues}
      ownerName={ownerName}
      dateLabel={formatPainelDate(now)}
      greeting={painelGreeting(now)}
      initialClock={formatPainelClock(now)}
    />
  )
}
```

- [ ] **Step 3: Build completo**

Run: `npm run build`
Expected: compila e faz typecheck. Único erro aceitável: o pré-existente em `src/app/api/inventory/import/route.ts` (`user_id` faltando). Qualquer outro erro é falha real.

- [ ] **Step 4: Commit**

```bash
git add src/components/painel/PainelDashboard.tsx src/app/painel/page.tsx
git commit -m "feat(painel): wire knowledge gaps and product intent into dashboard"
```

---

## Task 12: Verificação manual ponta a ponta

**Files:** nenhum — só validação.

- [ ] **Step 1: Subir o app local**

Run: `npm run dev`

- [ ] **Step 2: Logar e abrir `/painel`**

Confirmar:
- `GapsConhecimento` mostra "Nenhuma pergunta sem resposta na última semana" (se tabela vazia) ou linhas reais com contagem.
- `IntentCatalogo` mostra "Sem menções de produtos nas conversas ainda" (se vazio) ou linhas reais SEM a coluna VIEWS.

- [ ] **Step 3: Smoke test do workflow**

Abrir o chat público `/chat/<slug>` em outra aba. Mandar:

1. `"oi"` → resposta normal, nada criado em `knowledge_gaps`, `product_mentions`, ou `leads`.
2. `"quero um top floral"` → resposta com até 3 produtos. No Supabase, `product_mentions` ganha linhas com `source='ai_shown'` para os IDs dos produtos citados na resposta.
3. `"tem outros tops?"` → resposta com produtos DIFERENTES dos mostrados em #2. Verificar manualmente: nomes não se repetem.
4. `"meu nome é Mariana, whatsapp 11999998888"` → cria lead. Aguardar ~5s. No Supabase, `leads.interest_summary` tem texto coerente (algo como "Procura tops femininos florais").
5. `"vocês entregam em Niterói?"` (assumindo loja não cobre) → `knowledge_gaps` ganha linha com `tag='POLÍTICA DE ENTREGA'`.

- [ ] **Step 4: Recarregar `/painel`**

Confirmar:
- `GapsConhecimento` mostra a pergunta de Niterói com `1×` e tag `POLÍTICA DE ENTREGA`.
- `IntentCatalogo` mostra os produtos que apareceram nos passos 2-3, com `LEADS = 1` no produto vinculado à conversa onde Mariana virou lead.

- [ ] **Step 5: Validar workflow no n8n MCP**

Run via MCP: `mcp__n8n-mcp__validate_workflow` no arquivo final.
Expected: zero erros.

- [ ] **Step 6 (se algo falhar): Diagnosticar e corrigir**

Se algum dos pontos acima falhar:
- Workflow não escreve em alguma tabela → checar credenciais Supabase no nó + RLS policies.
- LLM devolve formato errado → checar prompt + parser (Code node) — devem aceitar markdown fences.
- Produto se repete no chat → revisar instruções anti-repetição no `systemMessage` do `AI Agent2` (Task 3).
- Painel mostra erro → checar `npm run build`; os erros pré-existentes do route inventory/import são aceitáveis.

- [ ] **Step 7: Commit final (se houver ajuste)**

```bash
git add <arquivos ajustados>
git commit -m "fix: <descrição do ajuste>"
```

---

## Fora do escopo desta entrega

- Re-cálculo de `interest_summary` quando o lead recebe mais mensagens após a criação inicial.
- Tela de marcação manual de gap como resolvido (`resolved_at`).
- Drilldown "Abrir todos" do GapsConhecimento e "Ver todos" do IntentCatalogo.
- Ordenação configurável da tabela IntentCatalogo (hoje só por menções desc).
- RPC dedicada de agregação no Postgres — agregação em JS é suficiente nos volumes esperados.
- Coluna VIEWS no IntentCatalogo — não há fonte de dados hoje.
