# Chat Agent — Buffer, Splitter, Coleta de Lead Unificada Design

**Status:** Spec aprovada → pronta para implementation plan
**Data:** 2026-05-26
**Escopo:** Quatro alterações coordenadas no fluxo de chat (n8n workflow `LUE FZ - Chat Agent` + app Next.js):
1. Agente pede nome + WhatsApp + email **de uma vez** ao detectar intenção de compra.
2. Agente envia contatos da loja (vendedor + Instagram) **na mesma mensagem** em que confirma os dados, sem precisar de novo nó.
3. Buffer de mensagens (debounce de 7s) — usuário pode enviar várias mensagens em rajada e o bot processa como uma só.
4. Splitter de mensagens — toda resposta do bot é quebrada em vários trechos enviados aos poucos com efeito de "digitando".

---

## 1. Contexto

O chat atual funciona assim:

1. Cliente envia mensagem → `sendMessage` (Server Action) insere user message em `messages` → chama webhook do n8n com `{mensagem, id_conversa, id_loja, ...}`.
2. n8n processa: AI Agent2 gera resposta com BUSCAR_PRODUTOS, ramificações paralelas rodam Lead Analyzer / Gap Detector / Mention Extractor.
3. n8n responde JSON `{output: "..."}`.
4. App insere a resposta em `messages` com role=assistant.
5. ChatClient (Realtime) entrega ao usuário.

Problemas atuais:
- Se o cliente envia "oi", "tem", "tops?" em rajada, o agente roda 3 vezes (3 webhooks paralelos) e responde 3 vezes desorientadamente.
- A resposta do bot vem como UMA mensagem só, sem efeito de digitação — sente robótico.
- O agente pede dados pessoais "um por vez" (instrução atual no prompt), o que arrasta a coleta.
- Quando o cliente passa nome e telefone, não há sinalização de próximo passo nem oferta de canal alternativo (WhatsApp da loja, Instagram).

## 2. Objetivos e não-objetivos

**Objetivos:**
- O bot pede nome + WhatsApp + email em uma frase única, **só** quando o cliente demonstra intenção de compra/reserva.
- Após o cliente passar nome + WhatsApp, o bot confirma os dados e oferece os contatos da loja como alternativa, na mesma mensagem.
- Mensagens em rajada (dentro de 7s) são consolidadas em um único processamento.
- Toda resposta do bot é quebrada em trechos de 100-500 chars enviados com intervalo proporcional ao tamanho (30ms/char, clamp 800-8000ms).

**Não-objetivos:**
- Não alterar como o lead é extraído (Lead Analyzer continua igual).
- Não criar novas tabelas/migrations.
- Não tocar Painel, Conversas, Estoque, ou outras telas do app.
- Não alterar o Mention Extractor, Gap Detector, Interest Summarizer — todos continuam ligados como hoje.
- Não criar buffer baseado em Redis ou state externo — usamos a tabela `messages` como fonte da verdade pro buffer.

## 3. Decisões herdadas do brainstorm

| Decisão | Escolha |
|---|---|
| Trigger coleta de dados | Quando cliente demonstra intenção de compra/reserva |
| Forma de pedir | Frase corrida natural (única mensagem com os 3 dados) |
| Entrega dos contatos da loja | Junto na confirmação dos dados (mesma mensagem do agente, não nova mensagem) |
| Trigger contatos | Cliente passou nome E WhatsApp (email opcional) |
| Buffer | Debounce no n8n (Wait + check) |
| Janela buffer | 7 segundos |
| Splitter trigger | Sempre, mesmo em respostas curtas |
| Splitter delivery | `Respond to Webhook` devolve array; app loopa inserindo cada peça com delay |
| Fórmula wait splitter | `clamp(length × 30ms, 800ms, 8000ms)` por peça |

## 4. Arquitetura do novo fluxo (visão geral)

```
[Webhook]
   │
[Edit Fields] — sessionId, chatInput, store_id, id_mensagem
   │
[Buffer Gate]                          ← OBJ 3 (4 nós novos)
   ├ Wait 7s
   ├ Postgres query: msgs user da conversa nos últimos 8s
   ├ Code Check: sou a mais recente? Se sim, junta o batch
   └ IF Should Process → continua / Stop
   │
[Informaçoes da loja1]
   │
   ├──→ [Get Shown Products] → [AI Agent2] → [Basic LLM Chain Splitter] → [Respond to Webhook]   ← OBJ 4 (3 nós novos)
   │                              ↓
   │                          [Get Catalog → Match Mentions → Has Valid Mention → Insert Mentions] (mantido)
   │
   ├──→ [Lead Analyzer → Parse Lead → ... → Update/Create Lead → Get Recent Messages → Interest Summarizer → ... → Update Lead Interest] (mantido)
   │
   └──→ [Gap Detector → Parse Gap → IF Has Gap → Insert Gap] (mantido)
```

Mudanças no app: apenas `src/actions/chat.ts` — handler do response do webhook agora itera sobre `data.messages` em vez de processar `data.output`.

## 5. Objetivo 1 + 2 — coleta de lead unificada (só systemMessage)

Edição em duas seções do `systemMessage` do nó AI Agent2.

**5.1. Adicionar na seção `# A loja`** (após a linha de "Instruções:"):

```
Contato do vendedor: {{ $('Informaçoes da loja1').item.json.seller_phone }}
Instagram da loja: @{{ $('Informaçoes da loja1').item.json.instagram_handle }}
```

**5.2. Substituir a seção `# Lead`** inteira por:

```
# Lead
Quando o cliente demonstrar intenção de compra/reserva ("quero comprar", "vou levar", "reserva pra mim", "como faço pra fechar"), peça os três dados de uma vez, em uma frase corrida natural.

Exemplo: "Show, vou anotar. Pra te conectar com a gente, manda seu nome, WhatsApp e email?"

Quando o cliente compartilhar nome E WhatsApp (mesmo que falte o email), na mesma mensagem em que confirmar os dados avise que um vendedor vai entrar em contato e ofereça os contatos da loja como alternativa para ele falar direto.

Exemplo: "Anotei, {nome}. Um vendedor vai entrar em contato em breve. Se preferir falar direto, é WhatsApp {seller_phone} ou Instagram @{instagram_handle}."

NÃO peça os dados antes da intenção de compra. NÃO peça um por vez. NÃO repita os contatos da loja em todas as mensagens — só na que o cliente acabou de compartilhar nome e número.
```

Nenhuma mudança de nó, conexão ou DB. O `seller_phone` e `instagram_handle` já estão na resposta do `Informaçoes da loja1` (são colunas adicionadas pela migration 018).

## 6. Objetivo 3 — Buffer Gate (debounce 7s)

**6.1. Novos nós** (4) entre `Edit Fields` e `Informaçoes da loja1`:

### 6.1.1. `Wait 7s` (n8n-nodes-base.wait, v1.1)

```json
{
  "parameters": { "amount": 7 },
  "name": "Wait Buffer"
}
```

Pausa a execução por 7 segundos. n8n persiste o estado e retoma depois.

### 6.1.2. `Get User Messages in Window` (n8n-nodes-base.postgres, v2.4)

Executa query:

```sql
SELECT id, content, created_at
FROM messages
WHERE conversation_id = '{{ $('Edit Fields').item.json.sessionId }}'
  AND role = 'user'
  AND created_at >= now() - interval '8 seconds'
ORDER BY created_at ASC
```

Retorna todas as mensagens do usuário na conversa nos últimos 8s (janela ligeiramente maior que o Wait pra cobrir borda).

### 6.1.3. `Buffer Check` (n8n-nodes-base.code, v2)

Decide se esta execução deve seguir (é a mais recente) e prepara o input combinado:

```javascript
const items = $input.all().map(i => i.json).filter(m => m && m.id);
const myMessageId = $('Edit Fields').item.json.id_mensagem;

if (items.length === 0) {
  // sem mensagens no banco ainda — segue só com a do webhook
  return [{ json: { should_process: true, chatInput: $('Edit Fields').item.json.chatInput } }];
}

// itens vêm em ASC por created_at; a última é a mais recente
const latest = items[items.length - 1];

if (latest.id !== myMessageId) {
  // não sou eu a mais recente; outra execução do n8n vai processar o batch
  return [{ json: { should_process: false } }];
}

// sou a mais recente; junta o conteúdo de todas
const joined = items.map(m => m.content).join('\n');
return [{ json: { should_process: true, chatInput: joined } }];
```

### 6.1.4. `IF Should Process` (n8n-nodes-base.if, v2.3)

Condição: `$json.should_process` é `true`.

**True branch** → `Informaçoes da loja1` (continua o fluxo).
**False branch** → não conectado (execução para silenciosamente).

**6.2. Atualizar `Edit Fields`** para também incluir `id_mensagem` (já vem no webhook body como `body.id_mensagem`, só precisa ser mapeado):

```json
{
  "id": "<existing>",
  "name": "id_mensagem",
  "value": "={{ $json.body.id_mensagem }}",
  "type": "string"
}
```

**6.3. Substituir referências de `chatInput`**: nós downstream (AI Agent2, Lead Analyzer, Gap Detector, Match Mentions, etc) usam hoje `$('Edit Fields').item.json.chatInput`. Com o buffer, queremos que vejam o batch concatenado. Solução: depois do `Buffer Check`, o objeto `$json` já contém `chatInput` consolidado. Os nós downstream existentes referenciam o `Edit Fields`; vamos atualizar suas expressions para referenciar `$('Buffer Check').item.json.chatInput` em vez de `$('Edit Fields').item.json.chatInput`.

Nós afetados:
- `AI Agent2`: `text` = `={{ $('Buffer Check').item.json.chatInput }}`
- `Lead Analyzer`: `text` = `={{ $('Buffer Check').item.json.chatInput }}`
- `Gap Detector`: `text` na expression atual `=Mensagem do cliente: {{ $('Edit Fields').item.json.chatInput }}` → trocar pra `Buffer Check`
- `Match Mentions`: `customerMsg = String($('Edit Fields').item.json.chatInput ?? '')` → trocar pra `Buffer Check`

**6.4. Conexões**

Mudança:
- `Edit Fields → Informaçoes da loja1` (atual)
- Vira: `Edit Fields → Wait Buffer → Get User Messages in Window → Buffer Check → IF Should Process → (true) → Informaçoes da loja1`

## 7. Objetivo 4 — Splitter de mensagens

**7.1. Novos nós** (3) entre `AI Agent2` e `Respond to Webhook`:

### 7.1.1. `Basic LLM Chain Splitter` (@n8n/n8n-nodes-langchain.chainLlm, v1.7)

Recebe a resposta do AI Agent2 e divide em array de mensagens.

```json
{
  "parameters": {
    "promptType": "define",
    "text": "=Mensagem do agente para dividir:\n{{ $('AI Agent2').item.json.output }}",
    "hasOutputParser": true,
    "messages": {
      "messageValues": [
        {
          "message": "Divida a mensagem em uma lista JSON {\"messages\": [\"...\", \"...\"]}. Cada parte deve ter entre 100 e 500 caracteres, quebrada em pontos naturais de conversa (fim de frase, parágrafo). Nunca corte palavras, nunca produza partes vazias. Mantenha o conteúdo intacto — não invente, não resuma, não traduza, não adicione formatação. Se a mensagem original já é curta (< 200 chars), retorne {\"messages\": [<a mensagem original>]}."
        }
      ]
    },
    "batching": {}
  }
}
```

Usa o mesmo modelo OpenAI já configurado (`gpt-5.4-mini` ou `gpt-4.1-mini`). Conecta um `Structured Output Parser` (sub-node) pra forçar o formato JSON.

### 7.1.2. `Structured Output Parser` (@n8n/n8n-nodes-langchain.outputParserStructured, v1.3)

Sub-node do splitter. Configuração padrão. Conecta via `ai_outputParser`.

### 7.1.3. `OpenAI Chat Model — Splitter` (@n8n/n8n-nodes-langchain.lmChatOpenAi, v1.3)

Sub-node LM do splitter. Reusa a credencial `OpenAi account` (id `9P4hWIaS93nW5FhK`). Modelo: `gpt-5.4-mini` (mesmo do AI Agent2 pra consistência).

**7.2. Conexões**

- `AI Agent2 → Basic LLM Chain Splitter` (substitui o link direto pra Respond to Webhook que existia)
- `OpenAI Chat Model — Splitter → Basic LLM Chain Splitter` (ai_languageModel)
- `Structured Output Parser → Basic LLM Chain Splitter` (ai_outputParser)
- `Basic LLM Chain Splitter → Respond to Webhook` (main)

Manter o fan-out de `AI Agent2 → Get Catalog` (Mention Extractor) intacto — só substituímos a perna pro Respond to Webhook.

**7.3. Atualizar `Respond to Webhook`**

Mudar `responseBody` para usar o output do splitter:

```
={{ JSON.stringify({ messages: $('Basic LLM Chain Splitter').item.json.output.messages }) }}
```

Mantém `respondWith: "text"` e header `Content-Type: application/json` da última iteração.

**7.4. Mudança no app — `src/actions/chat.ts`**

Localizar o bloco:

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

Substituir por:

```ts
if (res && res.ok) {
  const data = (await res
    .json()
    .catch(() => null)) as { messages?: string[]; output?: string } | null
  const parts = Array.isArray(data?.messages) && data.messages.length > 0
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

Mantém fallback para `data.output` caso o splitter falhe e n8n responda só com `output`. Wait formula: `clamp(length × 30ms, 800ms, 8000ms)`.

## 8. Validação e testes manuais

Sem framework de teste pra workflow n8n nem pra Server Actions com side-effects. Validação manual em 4 cenários no chat real:

| # | Cenário | Esperado |
|---|---|---|
| 1 | Cliente envia 3 mensagens em rajada (< 7s) | Agente responde 1 vez, considerando as 3 mensagens como contexto único |
| 2 | Resposta longa do bot (~800 chars) | Aparece em 2-3 mensagens separadas no chat, com pausas entre elas |
| 3 | Cliente diz "quero comprar esse aí" | Agente pede nome + WhatsApp + email **na mesma frase** |
| 4 | Cliente passa "meu nome é Maria, whatsapp 11999998888" | Próxima resposta do agente confirma os dados E menciona o vendedor + WhatsApp + Instagram da loja, na mesma mensagem |

## 9. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Wait 7s deixa n8n com muitas execuções pendentes | n8n persiste estado durante Wait; cada execução é leve. Janela de 7s não acumula tanto. |
| LLM Splitter falha ou retorna formato inválido | Structured Output Parser força schema; se mesmo assim falha, fallback no app usa `data.output` direto. |
| Agente ignora regra de "não repetir contatos" | Como o Postgres Chat Memory dá histórico ao agente, ele deve ver que já enviou. Se persistir, voltamos pra solução com flag em leads.metadata. |
| Mudança em `$('Edit Fields').item.json.chatInput` quebra nós que não migrei | Lista exaustiva no item 6.3 (AI Agent2, Lead Analyzer, Gap Detector, Match Mentions). Buscar no JSON com grep antes de commitar pra confirmar. |
| Splitter aplicado em respostas muito curtas (ex: "oi") quebra estranho | O prompt do splitter inclui a regra "se < 200 chars, retorne como 1 só". |
| App processa response numa Server Action que pode timeout antes de todas inserts terminarem | Wait máximo de 8s × 5 inserts = 40s. Server Actions têm timeout padrão de 30-60s. Aceitável. Se passar, dividir em menos pedaços. |

## 10. Fora do escopo

- Migration nova (nada precisa de coluna nova).
- Reescrever Lead Analyzer / Gap Detector / Interest Summarizer.
- Mudar Painel ou outras telas do app.
- Buffer baseado em estado externo (Redis, etc).
- Indicador visual de "digitando..." na UI (já vem natural pelo Realtime entregando mensagens uma a uma).
- Adaptar o Mention Extractor pra ver as mensagens do splitter (continua olhando o `$('AI Agent2').item.json.output` original, que é o texto completo antes da divisão — correto, pois é onde os produtos aparecem).
