# Chat Buffer, Splitter, Coleta de Lead Unificada Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coordenar 4 alterações no chat: agente pede dados pessoais de uma vez na intenção de compra, oferece contatos da loja após receber nome+WhatsApp, processa rajadas de mensagens via debounce de 7s no n8n, e quebra resposta longa em vários pedaços enviados com efeito de "digitando" no chat.

**Architecture:** Duas mudanças via systemMessage (obj 1+2) sem tocar fluxo. Buffer Gate de 4 nós no topo do workflow (Wait + Postgres + Code + IF). Splitter de 3 nós entre AI Agent2 e Respond to Webhook (LLM Chain + Output Parser + LM). App troca handler do response de single-string pra array com delays calculados.

**Tech Stack:** n8n workflow JSON (v2.21+), Next.js Server Actions, Supabase (Postgres + Realtime), Node.js para validação JSON.

**Spec de referência:** `docs/superpowers/specs/2026-05-26-chat-buffer-splitter-lead-flow-design.md`

**Arquivos afetados:**

| Arquivo | Responsabilidade | Tasks |
|---|---|---|
| `n8n/workflow-chat-agent.json` | Workflow do chat agent — todos os nós e conexões | Tasks 1, 2, 3 |
| `src/actions/chat.ts` | Server Action que despacha pra n8n e processa o response | Task 4 |

---

## Task 1: systemMessage — coleta de lead unificada (obj 1 + 2)

**Files:**
- Modify: `n8n/workflow-chat-agent.json` — campo `parameters.options.systemMessage` do nó com `name: "AI Agent2"` e `id: "04021648-9c43-4257-80c8-51f2378ac4a8"`

Trecho atual da seção `# A loja` no systemMessage (no JSON, vem como uma única linha com `\n` literais):

```
# A loja
Categorias: {{ $('Informaçoes da loja1').item.json.categories }}
Pagamento: {{ $('Informaçoes da loja1').item.json.payment_methods }}
Entrega: {{ $('Informaçoes da loja1').item.json.delivery_methods }}
Instruções: {{ $('Informaçoes da loja1').item.json.service_instructions }}
```

Trecho atual da seção `# Lead`:

```
# Lead
Pede dados pessoais naturalmente, um por vez, quando faz sentido:
- Nome quando a conversa engata
- WhatsApp quando o cliente demonstra interesse real (comprar, reservar)
- Email quando aplicável (catálogo, lista de espera)
Sem insistir em recusa.
```

- [ ] **Step 1: Read o campo atual pra capturar o conteúdo exato**

Use Read tool em `C:\LUE FZ\n8n\workflow-chat-agent.json`. Encontrar a linha do `"systemMessage":` (provavelmente em torno da linha 110). Anotar o início e fim do conteúdo pra ter referência exata.

- [ ] **Step 2: Edit — adicionar contato e instagram na seção "# A loja"**

Use Edit com:

`old_string`:
```
# A loja\nCategorias: {{ $('Informaçoes da loja1').item.json.categories }}\nPagamento: {{ $('Informaçoes da loja1').item.json.payment_methods }}\nEntrega: {{ $('Informaçoes da loja1').item.json.delivery_methods }}\nInstruções: {{ $('Informaçoes da loja1').item.json.service_instructions }}
```

`new_string`:
```
# A loja\nCategorias: {{ $('Informaçoes da loja1').item.json.categories }}\nPagamento: {{ $('Informaçoes da loja1').item.json.payment_methods }}\nEntrega: {{ $('Informaçoes da loja1').item.json.delivery_methods }}\nInstruções: {{ $('Informaçoes da loja1').item.json.service_instructions }}\nContato do vendedor: {{ $('Informaçoes da loja1').item.json.seller_phone }}\nInstagram da loja: @{{ $('Informaçoes da loja1').item.json.instagram_handle }}
```

(Note: as quebras de linha estão como `\n` literal dentro do JSON, pois o systemMessage é uma string única.)

- [ ] **Step 3: Edit — substituir a seção "# Lead" inteira**

Use Edit com:

`old_string`:
```
# Lead\nPede dados pessoais naturalmente, um por vez, quando faz sentido:\n- Nome quando a conversa engata\n- WhatsApp quando o cliente demonstra interesse real (comprar, reservar)\n- Email quando aplicável (catálogo, lista de espera)\nSem insistir em recusa.
```

`new_string`:
```
# Lead\nQuando o cliente demonstrar intenção de compra/reserva (\"quero comprar\", \"vou levar\", \"reserva pra mim\", \"como faço pra fechar\"), peça os três dados de uma vez, em uma frase corrida natural.\n\nExemplo: \"Show, vou anotar. Pra te conectar com a gente, manda seu nome, WhatsApp e email?\"\n\nQuando o cliente compartilhar nome E WhatsApp (mesmo que falte o email), na mesma mensagem em que confirmar os dados avise que um vendedor vai entrar em contato e ofereça os contatos da loja como alternativa para ele falar direto.\n\nExemplo: \"Anotei, {nome}. Um vendedor vai entrar em contato em breve. Se preferir falar direto, é WhatsApp {seller_phone} ou Instagram @{instagram_handle}.\"\n\nNÃO peça os dados antes da intenção de compra. NÃO peça um por vez. NÃO repita os contatos da loja em todas as mensagens — só na que o cliente acabou de compartilhar nome e número.
```

- [ ] **Step 4: Validar JSON parseable**

Run no PowerShell:
```
node -e "JSON.parse(require('fs').readFileSync('n8n/workflow-chat-agent.json','utf8')); console.log('VALID')"
```
Expected: `VALID`.

- [ ] **Step 5: Verificar que as duas seções estão presentes**

Run no PowerShell:
```
node -e "const w=JSON.parse(require('fs').readFileSync('n8n/workflow-chat-agent.json','utf8')); const s=w.nodes.find(n=>n.name==='AI Agent2').parameters.options.systemMessage; console.log('contato presente:', s.includes('Contato do vendedor')); console.log('instagram presente:', s.includes('Instagram da loja')); console.log('intenção de compra presente:', s.includes('intenção de compra/reserva')); console.log('contatos no lead presente:', s.includes('vendedor vai entrar em contato'));"
```
Expected: as 4 linhas com `true`.

- [ ] **Step 6: Commit**

```bash
git add n8n/workflow-chat-agent.json
git commit -m "feat(n8n): unified lead capture in systemMessage — ask all 3 at once, offer shop contacts after name+phone"
```

---

## Task 2: Buffer Gate (obj 3) — debounce 7s no topo do workflow

**Files:**
- Modify: `n8n/workflow-chat-agent.json` — adicionar 4 nós novos, atualizar `Edit Fields` para incluir `id_mensagem`, atualizar 4 nós downstream pra usar nova fonte de `chatInput`, religar conexões.

- [ ] **Step 1: Adicionar `id_mensagem` no nó Edit Fields**

Localize o nó com `name: "Edit Fields"` (id `f24d2c16-5bf4-4789-93bd-58da4e02689d`). Dentro de `parameters.assignments.assignments`, hoje existem 3 entradas: `sessionId`, `chatInput`, `store_id`. Adicionar um 4º item:

Use Edit com:

`old_string`:
```
            {
              "id": "a8e4f3b1-1234-4567-8901-abcdef012345",
              "name": "store_id",
              "value": "={{ $json.body.id_loja }}",
              "type": "string"
            }
          ]
        },
        "options": {}
      },
      "id": "f24d2c16-5bf4-4789-93bd-58da4e02689d",
      "name": "Edit Fields",
```

`new_string`:
```
            {
              "id": "a8e4f3b1-1234-4567-8901-abcdef012345",
              "name": "store_id",
              "value": "={{ $json.body.id_loja }}",
              "type": "string"
            },
            {
              "id": "b9f5a4c2-2345-5678-9012-bcdef0123456",
              "name": "id_mensagem",
              "value": "={{ $json.body.id_mensagem }}",
              "type": "string"
            }
          ]
        },
        "options": {}
      },
      "id": "f24d2c16-5bf4-4789-93bd-58da4e02689d",
      "name": "Edit Fields",
```

- [ ] **Step 2: Adicionar os 4 nós do Buffer Gate ao array `nodes`**

Encontre o fim do array `nodes` (a chave `]` que fecha o array antes de `"connections":`). Antes desse `]`, INSIRA estes 4 objetos (com vírgula correta entre o último nó existente e o primeiro novo):

```json
{
  "parameters": {
    "amount": 7
  },
  "id": "b1a2c3d4-e5f6-4789-0123-abcdef111111",
  "name": "Wait Buffer",
  "type": "n8n-nodes-base.wait",
  "typeVersion": 1.1,
  "position": [160, -1344],
  "webhookId": "3f2f3ccc-a4fe-4d64-90f4-bde11b9b1111"
},
{
  "parameters": {
    "operation": "executeQuery",
    "query": "SELECT id, content, created_at FROM messages WHERE conversation_id = '{{ $('Edit Fields').item.json.sessionId }}' AND role = 'user' AND created_at >= now() - interval '8 seconds' ORDER BY created_at ASC",
    "options": {}
  },
  "id": "b2a3c4d5-e6f7-4890-1234-bcdef0222222",
  "name": "Get User Messages in Window",
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.4,
  "position": [288, -1344],
  "credentials": {
    "postgres": {
      "id": "5LgfkDaHLkpMWYfd",
      "name": "Postgres account 3"
    }
  }
},
{
  "parameters": {
    "jsCode": "const items = $input.all().map(i => i.json).filter(m => m && m.id);\nconst myMessageId = $('Edit Fields').item.json.id_mensagem;\nconst originalInput = $('Edit Fields').item.json.chatInput;\n\nif (items.length === 0) {\n  return [{ json: { should_process: true, chatInput: originalInput } }];\n}\n\nconst latest = items[items.length - 1];\nif (latest.id !== myMessageId) {\n  return [{ json: { should_process: false } }];\n}\n\nconst joined = items.map(m => m.content).join('\\n');\nreturn [{ json: { should_process: true, chatInput: joined } }];"
  },
  "id": "b3a4c5d6-e7f8-4901-2345-cdef01333333",
  "name": "Buffer Check",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [416, -1344]
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
          "id": "buffer-should-process",
          "leftValue": "={{ $json.should_process }}",
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
  "id": "b4a5c6d7-e8f9-4012-3456-def012444444",
  "name": "IF Should Process",
  "type": "n8n-nodes-base.if",
  "typeVersion": 2.3,
  "position": [544, -1344]
}
```

- [ ] **Step 3: Religar as conexões do topo do workflow**

Localizar no objeto `connections` a entrada `"Edit Fields"`. Atualmente ela é:

```json
"Edit Fields": {
  "main": [
    [
      {
        "node": "Informaçoes da loja1",
        "type": "main",
        "index": 0
      }
    ]
  ]
}
```

Substituir por:

```json
"Edit Fields": {
  "main": [
    [
      {
        "node": "Wait Buffer",
        "type": "main",
        "index": 0
      }
    ]
  ]
},
"Wait Buffer": {
  "main": [
    [
      {
        "node": "Get User Messages in Window",
        "type": "main",
        "index": 0
      }
    ]
  ]
},
"Get User Messages in Window": {
  "main": [
    [
      {
        "node": "Buffer Check",
        "type": "main",
        "index": 0
      }
    ]
  ]
},
"Buffer Check": {
  "main": [
    [
      {
        "node": "IF Should Process",
        "type": "main",
        "index": 0
      }
    ]
  ]
},
"IF Should Process": {
  "main": [
    [
      {
        "node": "Informaçoes da loja1",
        "type": "main",
        "index": 0
      }
    ]
  ]
}
```

(O branch `false` do `IF Should Process` é intencionalmente vazio — execução para silenciosamente quando não é a mais recente.)

- [ ] **Step 4: Atualizar referências de `chatInput` em 4 nós downstream**

Hoje 4 nós usam `$('Edit Fields').item.json.chatInput`. Eles precisam usar `$('Buffer Check').item.json.chatInput` (que contém o batch consolidado).

**4a. AI Agent2:**

Edit:

`old_string`: `"text": "={{ $('Edit Fields').item.json.chatInput }}"`

`new_string`: `"text": "={{ $('Buffer Check').item.json.chatInput }}"`

(Esta expression é única na ocorrência do AI Agent2; se houver duplicatas em outros nós, validar antes de aplicar.)

**4b. Lead Analyzer:**

A expression é a mesma. Use `replace_all: false` no Edit anterior e depois rode outro Edit para a próxima ocorrência. Ou use `replace_all: true` se nenhum outro nó usar essa string EXATA (vide checagem abaixo).

Verificar primeiro com Grep:
```
Grep pattern "\\$\\('Edit Fields'\\)\\.item\\.json\\.chatInput" no arquivo n8n/workflow-chat-agent.json output_mode "content" -n true
```

Listará todas as ocorrências. Esperado: 4 linhas (AI Agent2, Lead Analyzer, Gap Detector, Match Mentions).

**4c. Aplicar replace_all=true (uma vez resolve tudo):**

Edit:

`old_string`: `$('Edit Fields').item.json.chatInput`

`new_string`: `$('Buffer Check').item.json.chatInput`

`replace_all`: `true`

- [ ] **Step 5: Validar JSON**

Run no PowerShell:
```
node -e "JSON.parse(require('fs').readFileSync('n8n/workflow-chat-agent.json','utf8')); console.log('VALID')"
```
Expected: `VALID`.

- [ ] **Step 6: Verificar contagem de nós e conexões novos**

Run no PowerShell:
```
node -e "const w=JSON.parse(require('fs').readFileSync('n8n/workflow-chat-agent.json','utf8')); const names=w.nodes.map(n=>n.name); console.log('Wait Buffer:', names.includes('Wait Buffer')); console.log('Get User Messages in Window:', names.includes('Get User Messages in Window')); console.log('Buffer Check:', names.includes('Buffer Check')); console.log('IF Should Process:', names.includes('IF Should Process')); console.log('Edit Fields → Wait Buffer:', JSON.stringify(w.connections['Edit Fields'].main[0][0].node));"
```
Expected: 4 linhas `true` e a última imprimindo `"Wait Buffer"`.

- [ ] **Step 7: Confirmar que nenhuma expression antiga ficou para trás**

Run:
```
Grep pattern "\\$\\('Edit Fields'\\)\\.item\\.json\\.chatInput" no arquivo n8n/workflow-chat-agent.json output_mode "files_with_matches"
```
Expected: NO MATCHES. Se aparecer alguma, a substituição não foi completa.

- [ ] **Step 8: Commit**

```bash
git add n8n/workflow-chat-agent.json
git commit -m "feat(n8n): Buffer Gate — 7s debounce at top of workflow

Adds Wait Buffer + Get User Messages in Window + Buffer Check + IF Should Process between Edit Fields and Informaçoes da loja1. Older webhook executions exit silently when newer user message arrived. Latest execution joins all user messages from the 7s window as combined chatInput.

Downstream nodes (AI Agent2, Lead Analyzer, Gap Detector, Match Mentions) updated to reference Buffer Check.item.json.chatInput in place of Edit Fields.item.json.chatInput."
```

---

## Task 3: Splitter chain (obj 4) — quebra resposta em pedaços

**Files:**
- Modify: `n8n/workflow-chat-agent.json` — adicionar 3 nós (Basic LLM Chain + Output Parser + LM), modificar `Respond to Webhook` para usar output do splitter, religar conexão de `AI Agent2` mantendo o fan-out pro Mention Extractor.

- [ ] **Step 1: Adicionar os 3 novos nós ao array `nodes`**

Inserir antes do `]` que fecha o array `nodes` (com vírgula correta entre o último nó existente e o primeiro novo):

```json
{
  "parameters": {
    "promptType": "define",
    "text": "=Mensagem do agente para dividir:\n{{ $('AI Agent2').item.json.output }}",
    "hasOutputParser": true,
    "messages": {
      "messageValues": [
        {
          "message": "Divida a mensagem do agente em uma lista JSON no formato {\"messages\": [\"...\", \"...\"]}. Cada parte deve ter entre 100 e 500 caracteres, quebrada em pontos naturais de conversa (fim de frase ou parágrafo). NUNCA corte palavras. NUNCA produza partes vazias. NÃO invente, NÃO resuma, NÃO traduza, NÃO adicione ou tire formatação. Se a mensagem original já é curta (menos de 200 chars), retorne {\"messages\": [<a mensagem original inteira como uma única parte>]}."
        }
      ]
    },
    "batching": {}
  },
  "id": "sp1a2b3c-4d5e-4f67-8901-splitter11111",
  "name": "Basic LLM Chain Splitter",
  "type": "@n8n/n8n-nodes-langchain.chainLlm",
  "typeVersion": 1.7,
  "position": [976, -1344]
},
{
  "parameters": {
    "model": {
      "__rl": true,
      "value": "gpt-5.4-mini",
      "mode": "list",
      "cachedResultName": "gpt-5.4-mini"
    },
    "options": {}
  },
  "id": "sp2b3c4d-5e6f-4789-9012-splitter22222",
  "name": "OpenAI Chat Model - Splitter",
  "type": "@n8n/n8n-nodes-langchain.lmChatOpenAi",
  "typeVersion": 1.3,
  "position": [976, -1180],
  "credentials": {
    "openAiApi": {
      "id": "9P4hWIaS93nW5FhK",
      "name": "OpenAi account"
    }
  }
},
{
  "parameters": {},
  "id": "sp3c4d5e-6f7a-4890-0123-splitter33333",
  "name": "Splitter Output Parser",
  "type": "@n8n/n8n-nodes-langchain.outputParserStructured",
  "typeVersion": 1.3,
  "position": [1136, -1180]
}
```

- [ ] **Step 2: Modificar `Respond to Webhook` para usar output do splitter**

Localizar no JSON o nó com `name: "Respond to Webhook"` e `id: "144c2506-459d-4c3c-be7f-0b076139654b"`. O campo `responseBody` atual é:

```
"={{ JSON.stringify({ output: $('AI Agent2')?.item?.json?.output ?? '' }) }}"
```

Use Edit com:

`old_string`: `"responseBody": "={{ JSON.stringify({ output: $('AI Agent2')?.item?.json?.output ?? '' }) }}"`

`new_string`: `"responseBody": "={{ JSON.stringify({ messages: ($('Basic LLM Chain Splitter')?.item?.json?.output?.messages) ?? [$('AI Agent2')?.item?.json?.output ?? ''] }) }}"`

(O fallback `[$('AI Agent2')?.item?.json?.output ?? '']` garante que se o splitter falhar, ainda volta com 1 mensagem.)

- [ ] **Step 3: Religar conexões de `AI Agent2` mantendo o fan-out**

Hoje a entrada `"AI Agent2"` em `connections` é:

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

Substituir por:

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
        "node": "Basic LLM Chain Splitter",
        "type": "main",
        "index": 0
      }
    ]
  ]
},
"Basic LLM Chain Splitter": {
  "main": [
    [
      {
        "node": "Respond to Webhook",
        "type": "main",
        "index": 0
      }
    ]
  ]
},
"OpenAI Chat Model - Splitter": {
  "ai_languageModel": [
    [
      {
        "node": "Basic LLM Chain Splitter",
        "type": "ai_languageModel",
        "index": 0
      }
    ]
  ]
},
"Splitter Output Parser": {
  "ai_outputParser": [
    [
      {
        "node": "Basic LLM Chain Splitter",
        "type": "ai_outputParser",
        "index": 0
      }
    ]
  ]
}
```

(Get Catalog continua paralelo. Respond to Webhook deixa de receber direto do AI Agent2, agora recebe do Splitter.)

- [ ] **Step 4: Validar JSON**

Run no PowerShell:
```
node -e "JSON.parse(require('fs').readFileSync('n8n/workflow-chat-agent.json','utf8')); console.log('VALID')"
```
Expected: `VALID`.

- [ ] **Step 5: Verificar os 3 nós e a nova conexão**

Run no PowerShell:
```
node -e "const w=JSON.parse(require('fs').readFileSync('n8n/workflow-chat-agent.json','utf8')); const names=w.nodes.map(n=>n.name); console.log('Splitter LLM Chain:', names.includes('Basic LLM Chain Splitter')); console.log('Splitter LM:', names.includes('OpenAI Chat Model - Splitter')); console.log('Splitter Parser:', names.includes('Splitter Output Parser')); const cn=w.connections['AI Agent2'].main[0].map(c=>c.node); console.log('AI Agent2 fans out to:', cn);"
```
Expected: as 3 linhas `true` e a última imprimindo `[ 'Get Catalog', 'Basic LLM Chain Splitter' ]`.

- [ ] **Step 6: Commit**

```bash
git add n8n/workflow-chat-agent.json
git commit -m "feat(n8n): Splitter chain — break agent response into multiple messages

Adds Basic LLM Chain Splitter (chainLlm v1.7) between AI Agent2 and Respond to Webhook, with Structured Output Parser and dedicated OpenAI Chat Model sub-nodes. Splitter divides into JSON array of 100-500 char chunks; short messages (<200) return as single-element array.

Respond to Webhook now returns {messages: [...]}; falls back to [output] if splitter output is unavailable. Mention Extractor branch (AI Agent2 → Get Catalog) preserved via fan-out."
```

---

## Task 4: App handler — loop sobre `messages` com delay (obj 4 — parte app)

**Files:**
- Modify: `src/actions/chat.ts` — substituir o bloco que processa `data.output` por loop sobre `data.messages` com delay calculado por tamanho.

Trecho atual (em torno da linha 189 do arquivo, dentro de `sendMessage`):

```ts
if (res && res.ok) {
  const data = (await res
    .json()
    .catch(() => null)) as { output?: string } | null
  const output = data?.output?.trim()
  if (output) {
    await admin.from('messages').insert({
      conversation_id: conv.id,
      role: 'assistant',
      content: output,
      message_type: 'text',
    })
  }
}
```

- [ ] **Step 1: Edit o bloco substituindo pelo novo handler**

Use Edit com:

`old_string`:
```
    if (res && res.ok) {
      const data = (await res
        .json()
        .catch(() => null)) as { output?: string } | null
      const output = data?.output?.trim()
      if (output) {
        await admin.from('messages').insert({
          conversation_id: conv.id,
          role: 'assistant',
          content: output,
          message_type: 'text',
        })
      }
    }
```

`new_string`:
```
    if (res && res.ok) {
      const data = (await res.json().catch(() => null)) as
        | { messages?: string[]; output?: string }
        | null
      const parts =
        Array.isArray(data?.messages) && data.messages.length > 0
          ? data.messages
          : data?.output
            ? [data.output]
            : []
      for (let i = 0; i < parts.length; i++) {
        const content = (parts[i] ?? '').trim()
        if (!content) continue
        if (i > 0) {
          const waitMs = Math.min(Math.max(content.length * 30, 800), 8000)
          await new Promise((r) => setTimeout(r, waitMs))
        }
        await admin.from('messages').insert({
          conversation_id: conv.id,
          role: 'assistant',
          content,
          message_type: 'text',
        })
      }
    }
```

- [ ] **Step 2: Verificar tipos**

Run:
```
npx tsc --noEmit
```
Expected: sem erros novos. (Erro pré-existente em `src/app/api/inventory/import/route.ts` é aceitável.)

- [ ] **Step 3: Verificar que o trecho compila e exporta o mesmo shape**

A função `sendMessage` continua retornando `SendMessageResult` (interface inalterada). Apenas o interior do `try` mudou. O contrato com o caller (`ChatInput` no UI) está preservado.

Run:
```
node -e "const fs = require('fs'); const s = fs.readFileSync('src/actions/chat.ts','utf8'); console.log('has new handler:', s.includes('Array.isArray(data?.messages)')); console.log('has wait formula:', s.includes('content.length * 30')); console.log('no old handler:', !s.includes('const output = data?.output?.trim()'));"
```
Expected: as 3 linhas `true`.

- [ ] **Step 4: Commit**

```bash
git add src/actions/chat.ts
git commit -m "feat(chat): loop over webhook messages array with length-based delay

When n8n's response contains {messages: [...]}, iterate and insert each with delay between inserts (clamp(length × 30ms, 800ms, 8000ms)). Falls back to single output for backward compatibility while n8n splitter rollout is in progress.

Realtime delivers each insert to ChatClient, producing typing-indicator-like effect."
```

---

## Task 5: Verificação manual ponta a ponta

**Files:** nenhum — validação humana após reimport no n8n.

- [ ] **Step 1: Reimport do workflow no n8n**

Procedimento:
1. Abrir `https://nutramim-n8n.ev7c2h.easypanel.host`
2. Workflow "LUE FZ - Chat Agent" → menu (3 pontos) → "Import from File"
3. Selecionar `C:\LUE FZ\n8n\workflow-chat-agent.json`
4. Confirmar sobrescrita
5. Verificar que toggle "Active" está verde (religar se voltou cinza)
6. Salvar

Expected: import sem warnings de validação. Workflow active.

- [ ] **Step 2: Reiniciar o `npm run dev` do app (pra pegar o novo handler)**

Procedimento:
1. No terminal onde está rodando o `npm run dev`, Ctrl+C
2. `cd "C:\LUE FZ"; $env:NODE_OPTIONS='--use-system-ca'; npm run dev`

Expected: dev server sobe com a flag anti-Norton aplicada.

- [ ] **Step 3: Smoke test cenário 1 — buffer**

Abrir chat público em browser anônimo. Mandar 3 mensagens em rajada (rápido, < 7s):
1. `oi`
2. `tem`
3. `tops?`

Expected (após ~7s da última):
- O bot responde 1 vez.
- A resposta considera as 3 mensagens juntas (cumprimenta + responde sobre tops).
- Aba Executions do n8n mostra 3 execuções: 2 com path curto (param em IF Should Process false), 1 completa.

- [ ] **Step 4: Smoke test cenário 2 — splitter**

Mandar uma mensagem que provoque resposta longa: `me mostra todos os tops, blusas e croppeds da loja com cor, tamanho e preço de cada um`

Expected:
- A resposta vem em 2-4 mensagens separadas no chat, com pausas perceptíveis entre elas.
- O conteúdo completo está preservado (nada cortado pelo meio).

- [ ] **Step 5: Smoke test cenário 3 — coleta unificada**

Em outra conversa nova, mandar:
- `oi`
- `gostei desse top, quero comprar`

Expected:
- Resposta do bot pede nome, WhatsApp E email na MESMA frase corrida, sem listar um por um.

- [ ] **Step 6: Smoke test cenário 4 — contatos da loja**

Em sequência ao cenário 3, mandar:
- `meu nome é Mariana, whatsapp 11999998888`

Expected:
- Resposta do bot confirma os dados ("anotei, Mariana") E menciona, na mesma mensagem, que um vendedor vai entrar em contato + apresenta o telefone do vendedor + Instagram da loja.

- [ ] **Step 7: Smoke test cenário 5 — sem repetição de contatos**

Após cenário 4, mandar mais 1 mensagem genérica:
- `legal, vou esperar`

Expected:
- Resposta do bot NÃO repete o telefone/Instagram. Apenas se despede ou pergunta algo relevante.

- [ ] **Step 8: Se algum cenário falhar, diagnosticar**

- Cenário 1 falha (todas as 3 mensagens processam) → checar se Edit Fields está mapeando `id_mensagem` E se downstream usa `Buffer Check`. Conferir Executions no n8n pra ver se o IF Should Process está rejeitando as não-mais-recentes.
- Cenário 2 falha (resposta vem em 1 mensagem só) → checar Respond to Webhook responseBody (deve referenciar `Basic LLM Chain Splitter`). Conferir o response no devtools do navegador.
- Cenário 3 falha (bot pede só nome) → re-verificar systemMessage seção Lead.
- Cenário 4 falha (bot não menciona contatos da loja) → verificar que `seller_phone` e `instagram_handle` estão preenchidos no `store_settings` da loja de teste.

---

## Fora do escopo

- Indicador visual de "digitando..." na UI (vem natural pelo Realtime).
- Buffer Gate baseado em Redis ou cache externo.
- Migration nova.
- Reescrita do Mention Extractor / Lead Analyzer / Gap Detector / Interest Summarizer.
- Adaptação do Mention Extractor pra ver as mensagens divididas (continua olhando o `$('AI Agent2').item.json.output` original que é o texto completo — correto).
