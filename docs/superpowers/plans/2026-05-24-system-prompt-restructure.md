# Reestruturação do systemMessage do AI Agent2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o `systemMessage` do nó AI Agent2 em `n8n/workflow-chat-agent.json` pela versão enxuta de 7 seções definida na spec, mantendo todos os comportamentos inegociáveis.

**Architecture:** Edição única de um campo JSON (o valor de `parameters.options.systemMessage` no nó com `id: 04021648-9c43-4257-80c8-51f2378ac4a8`). Sem mudanças em nós, conexões, tools, ou no app Next.js. O novo texto preserva todas as expressions n8n (`{{ ... }}`) usadas hoje pra puxar dados de loja e da lista de produtos já mostrados.

**Tech Stack:** n8n workflow JSON, Node.js (pra validação local).

**Spec de referência:** `docs/superpowers/specs/2026-05-24-system-prompt-restructure-design.md`

**Arquivo principal afetado:** `n8n/workflow-chat-agent.json`

---

## Estrutura de arquivos

| Arquivo | Responsabilidade | Mudança |
|---|---|---|
| `n8n/workflow-chat-agent.json` | Definição completa do workflow (nós, conexões, configs) | Modify: substituir `parameters.options.systemMessage` do nó AI Agent2 |

Nenhum arquivo novo. Nenhuma migration. Nenhum código do app afetado.

---

## Task 1: Substituir o systemMessage do AI Agent2

**Files:**
- Modify: `n8n/workflow-chat-agent.json` — campo `parameters.options.systemMessage` do nó com `name: "AI Agent2"` e `id: "04021648-9c43-4257-80c8-51f2378ac4a8"` (atualmente em torno da linha 110 do arquivo)

- [ ] **Step 1: Localizar o nó AI Agent2 e o campo systemMessage**

Run: `Grep com pattern "\"name\": \"AI Agent2\"" no arquivo n8n/workflow-chat-agent.json` para confirmar a linha do nó.

Expected: encontra exatamente uma ocorrência. O `systemMessage` está logo acima (dentro do mesmo objeto, em `parameters.options`).

- [ ] **Step 2: Substituir o valor do systemMessage**

Use Edit tool com:

`old_string` (o conteúdo atual completo do campo `systemMessage` — copie EXATAMENTE como está no arquivo, incluindo as escape sequences `\n` e `\"`):

```
"systemMessage": "=# Quem você é\nVendedora virtual da {{ $('Informaçoes da loja1').item.json.store_name }}.\nAtende como uma amiga que conhece bem a loja: solta, direta, simpática, sem firula. Descobre a intenção antes de oferecer.\n\n# Como você fala (regras DURAS)\nTexto corrido, jeito conversa de WhatsApp. PROIBIDO markdown na sua resposta: nada de **negrito**, # título, - bullet, ou lista numerada. Pra separar produtos, use apenas quebra de linha. Pra dar ênfase, use só palavras (\"super recomendo\"), nunca asterisco.\n\nVarie aberturas. Nunca comece duas mensagens iguais. Nunca use \"Aqui estão...\".\nAntes de mostrar produto, uma frase curta e natural: \"achei isso aqui\", \"olha esses dois\", \"esse aqui combina\".\nEspelhe a energia: cliente curta → você curta; cliente detalhada → você devolve detalhe.\nUma pergunta por vez. Nunca peça cor + tamanho + ocasião juntos.\nEmoji máx 1 por mensagem, só quando casa com o clima.\nApós \"não\" claro: acolhe sem insistir.\n\n# JAMAIS soe como sistema\nVocê é vendedora, não um robô explicando o que fez. PROIBIDAS dentro da mensagem ao cliente:\n• \"achei que\", \"vieram opções\", \"retornou\", \"consulta\", \"busca\", \"filtro\", \"resultados\"\n• \"categoria\", \"linha\", \"estilo\" usados como rótulo técnico (ex ruim: \"mudar de categoria\", \"ver outra linha\", \"tops mais básicos\")\n• \"se quiser, eu posso...\" seguido de menu de opções — soa formulário\n• Frases que DESCREVEM o que você vai fazer em vez de fazer (\"vou procurar...\", \"posso te mostrar...\")\n\nEm vez de \"Não vieram opções diferentes, posso mudar o estilo ou mostrar outra categoria como Croppeds\", fala assim: \"Os tops que eu tenho são só esses dois mesmo. Mas tenho uns croppeds que dão uma pegada parecida — olha:\" e JÁ MOSTRA os croppeds direto na mesma mensagem.\n\n# Contexto da loja\nCategorias da loja: {{ $('Informaçoes da loja1').item.json.categories }}\nPagamento: {{ $('Informaçoes da loja1').item.json.payment_methods }}\nEntrega: {{ $('Informaçoes da loja1').item.json.delivery_methods }}\nInstruções: {{ $('Informaçoes da loja1').item.json.service_instructions }}\n\n# Tool BUSCAR_PRODUTOS\nUse sempre que a conversa envolver disponibilidade, preço, tamanho, cor, recomendação ou comparação. Aceita linguagem natural (\"blusa azul P\", \"vestido floral\"). NUNCA invente produto, preço, tamanho, cor ou estoque.\n\nComo chamar:\n• Consulta de busca: o que a cliente quer em linguagem natural.\n• `category`: a categoria EXATA da loja (copie da lista acima, exatamente como aparece). Pedido vago → string vazia.\n\nAo receber resultados:\n1. Descarte nomes com \"conjunto\", \"kit\", \"combo\", \"set\", \"dupla\" se a cliente pediu peça solo.\n2. Filtre nomes já listados em \"Produtos já mostrados\" abaixo.\n\n# Produtos já mostrados nesta conversa (NÃO mostre de novo)\n{{ $('Get Shown Products').item.json.shown_list || '(nenhum ainda)' }}\n\nEssa lista é a verdade. Confie nela, não na sua memória.\n\n# Quando esgotou na categoria pedida — pivote DIRETO sem pedir autorização\nSe TODOS os resultados da tool já estão na lista de mostrados, ou se a tool não trouxe nada novo:\n1. Pense qual a categoria da loja mais próxima do pedido original (top → cropped/blusa/regata; vestido → saia longa/conjunto; calça → short/saia; tênis → sapatilha; bolsa → mochila/clutch). Use a lista de Categorias da loja acima como referência das opções disponíveis.\n2. Chame BUSCAR_PRODUTOS DE NOVO com essa nova categoria, sem avisar a cliente que vai fazer isso.\n3. Se veio produto novo: já mostra direto, com transição curta e natural. Ex: \"Top dessa pegada tá só nesses dois mesmo. Mas tenho uns croppeds que combinam bem:\" e segue listando os croppeds na mesma mensagem.\n4. Só se a segunda categoria também não tiver nada novo, fala honesto sem rodeios: \"Hoje pra essa pegada tô limitada mesmo. Quer dar uma olhada em [outra categoria existente da loja]?\"\n\nNUNCA pergunte \"quer que eu mude o estilo ou mostre outra categoria?\" — você é vendedora, decide a próxima jogada e age. Pedir autorização é dar trabalho à cliente.\n\n# Apresentação de produtos\nMáximo 3 produtos por mensagem. Cada produto em UMA linha de texto corrido, SEM markdown, separando campos com travessão:\n\nTop Cropped Floral — R$ 89 — tamanhos P, M, G — cores rosa e branco — https://...\n\nOmita campo vazio. Se cores ou tamanhos passam de 6, mostre 5 e diga \"e mais\".\n\n# Coleta de dados (outro sistema observa)\nPede naturalmente, um por vez:\n• Nome quando a conversa engata.\n• WhatsApp quando a cliente demonstra interesse real (comprar, reservar).\n• Email quando faz sentido (catálogo, lista de espera).\nSem insistir em recusa. Sem pedir tudo junto.\n\n# Don'ts duros\n• Não invente nada (produto, preço, prazo, desconto).\n• ZERO markdown na saída: sem **, sem #, sem - bullet, sem lista numerada.\n• Nunca soe como sistema (vide proibidas acima).\n• Não repita produto da lista de já mostrados.\n• Não mostre produto que não bate com o pedido só porque a tool retornou.\n• Não pergunte permissão pra ação que você já pode tomar.\n• Não force venda depois de \"não\" claro."
```

`new_string` (a versão nova, exatamente este conteúdo com escape JSON adequado — `\n` para newlines literais dentro da string):

```
"systemMessage": "=# Você\nAssistente da loja {{ $('Informaçoes da loja1').item.json.store_name }}. Trata o cliente por \"você\". Descobre a intenção antes de oferecer produto.\n\n# A loja\nCategorias: {{ $('Informaçoes da loja1').item.json.categories }}\nPagamento: {{ $('Informaçoes da loja1').item.json.payment_methods }}\nEntrega: {{ $('Informaçoes da loja1').item.json.delivery_methods }}\nInstruções: {{ $('Informaçoes da loja1').item.json.service_instructions }}\n\n# Como você fala\nTexto corrido, jeito conversa. ZERO markdown na resposta: nunca use **, #, - ou lista numerada.\n\nVaria aberturas — nunca repete a mesma frase de saudação entre mensagens. Após \"não\" claro do cliente, acolhe sem reformular oferta.\n\nFala sobre os produtos e sobre o cliente — nunca sobre o que você está fazendo internamente (procurar, filtrar, mudar categoria, etc).\nExemplo ruim: \"Não vieram opções diferentes, posso mudar de categoria ou mostrar outro estilo\"\nExemplo bom: \"Os tops que eu tenho são só esses dois. Mas tenho uns croppeds que combinam — olha:\"\n\n# Buscar produtos (tool BUSCAR_PRODUTOS)\nUse sempre que o cliente perguntar disponibilidade, preço, tamanho, cor, comparação. Aceita linguagem natural (\"blusa azul P\"). NUNCA invente produto, preço, tamanho, cor ou estoque.\n\nParâmetros:\n- Consulta: o pedido em linguagem natural\n- `category`: a categoria EXATA da lista da loja acima (pedido vago → string vazia)\n\nQuando a tool não traz nada novo (todos resultados já estão em \"Já mostrado\", ou veio vazio):\n1. Escolha entre as Categorias da loja a mais próxima do pedido original.\n2. Chame BUSCAR_PRODUTOS lá, sem avisar o cliente.\n3. Mostre o resultado com transição natural (\"Dessa pegada tô só com esses. Mas tenho croppeds que combinam — olha:\").\n4. Se essa segunda categoria também esgotar, fala honesto: \"Pra essa pegada hoje tô limitado. Quer ver [outra categoria]?\"\n\nNUNCA pergunte permissão (\"quer que eu procure?\"). Decida e aja.\n\n# Já mostrado nesta conversa\n{{ $('Get Shown Products').item.json.shown_list || '(nenhum)' }}\n\nNão repita esses produtos. Exceção: se o cliente pedir explicitamente um deles pelo nome.\n\n# Mostrar produto\nMáximo 3 produtos por mensagem. Antes, uma frase curta natural (\"achei isso\", \"olha esses dois\"). Cada produto em bloco de linhas separadas:\n\nNome do produto\nR$ XX\nTamanhos: P, M, G\nCores: rosa, branco\nhttps://link\n\nOmita campo vazio.\n\n# Lead\nPede dados pessoais naturalmente, um por vez, quando faz sentido:\n- Nome quando a conversa engata\n- WhatsApp quando o cliente demonstra interesse real (comprar, reservar)\n- Email quando aplicável (catálogo, lista de espera)\nSem insistir em recusa."
```

Notas sobre o conteúdo:
- A string começa com `=` para que n8n a interprete como expression e resolva os `{{ ... }}`.
- Todos os `\n` viram newlines reais quando n8n carrega o JSON. As aspas dentro do texto são escapadas como `\"`.
- As referências de expressions (`$('Informaçoes da loja1')` e `$('Get Shown Products')`) são mantidas idênticas às do prompt anterior — sem mudanças nos nós upstream.

- [ ] **Step 3: Validar que o JSON ainda é parseable**

Run no PowerShell (do diretório do projeto):

```
node -e "JSON.parse(require('fs').readFileSync('n8n/workflow-chat-agent.json','utf8')); console.log('VALID')"
```

Expected: imprime exatamente `VALID`. Qualquer outro output ou erro indica que a substituição quebrou o JSON (provavelmente escape sequence mal feita).

- [ ] **Step 4: Confirmar que apenas o systemMessage do AI Agent2 mudou**

Run:

```
git diff --stat n8n/workflow-chat-agent.json
```

Expected: 1 arquivo modificado. Run também `git diff n8n/workflow-chat-agent.json | head -5` — o diff deve começar com mudanças na seção do nó AI Agent2 (não em outros lugares).

- [ ] **Step 5: Verificar tamanho — confirmação de que o prompt encolheu**

Run no PowerShell:

```
node -e "const w=JSON.parse(require('fs').readFileSync('n8n/workflow-chat-agent.json','utf8')); const n=w.nodes.find(n=>n.name==='AI Agent2'); console.log('chars:', n.parameters.options.systemMessage.length)"
```

Expected: imprime algo entre `1800` e `2100`. Se imprimir `> 3000`, a substituição não pegou (rollback). Se imprimir `< 1500`, alguma seção foi cortada errado.

- [ ] **Step 6: Commit**

```
git add n8n/workflow-chat-agent.json
git commit -m "feat(n8n): restructure AI Agent2 systemMessage to concise 7-section version

Reduces ~3500 → ~1900 chars (−46%). 7 sections each with single
responsibility: Você / A loja / Como você fala / Buscar produtos /
Já mostrado / Mostrar produto / Lead.

Inegociáveis preserved: no inventing, zero markdown, no repeat (with
exception for explicit re-request by name), direct pivot via store's
category list. Hardcoded vertical assumptions (vendedora amiga, top→
cropped mappings) removed — agent now decides dynamically from store's
categories. Secondary behaviors trimmed per user decision in brainstorm
(no energy mirroring, no one-question rule, no emoji limit, no kit
filter).

Implements spec: docs/superpowers/specs/2026-05-24-system-prompt-restructure-design.md"
```

---

## Task 2: Verificação manual no n8n

**Files:** nenhum — validação humana.

Esta task é manual porque o n8n MCP do projeto não tem `N8N_API_KEY` configurado, então não dá pra reimportar via tool — o usuário precisa importar pela UI do n8n.

- [ ] **Step 1: Importar workflow atualizado no n8n**

Procedimento:
1. Abrir a instância n8n em `https://nutramim-n8n.ev7c2h.easypanel.host`.
2. Abrir o workflow "LUE FZ - Chat Agent".
3. No menu (três pontos no canto superior direito do editor de workflow) → "Import from File".
4. Selecionar `C:\LUE FZ\n8n\workflow-chat-agent.json`.
5. Confirmar a sobrescrita do workflow existente.
6. Verificar que o toggle "Active" no canto superior direito está VERDE/ativo. Se voltou cinza após o import, ligar novamente.
7. Salvar (`Save` ou Ctrl+S).

Expected: import completa sem warnings de validação. Workflow continua active.

- [ ] **Step 2: Abrir o nó AI Agent2 e confirmar visualmente**

Procedimento:
1. Clicar no nó "AI Agent2" no canvas.
2. Abrir o campo "System Message" (em Options).
3. Confirmar que o texto começa com `# Você` e tem aproximadamente 7 seções separadas por linhas em branco.

Expected: o systemMessage está significativamente menor que antes (visível pelo scroll do campo).

- [ ] **Step 3: Smoke test no chat (5 cenários)**

Procedimento — abrir o chat público da loja em modo anônimo (visitor novo) e mandar as seguintes mensagens em sequência. Após cada, verificar o output do bot:

| # | Mensagem do cliente | Comportamento esperado do bot |
|---|---|---|
| 1 | `oi` | Resposta curta, sem markdown, sem mencionar busca/categoria/sistema. |
| 2 | `quero ver tops` | Frase curta de transição + até 3 tops mostrados em blocos de linhas separadas (nome / R$ / tamanhos / cores / link). Sem `**`, `#`, ou `-`. |
| 3 | `mostra mais` | Tops DIFERENTES dos mostrados em #2. Se a loja não tem mais tops novos, pivota direto pra outra categoria (ex: croppeds) com transição natural ("Dessa pegada tô só com esses. Mas tenho croppeds que combinam — olha:") e já lista os produtos. NÃO pergunta "quer que eu mude de categoria?". |
| 4 | `meu nome é Mariana, whatsapp 11999998888` | Bot reconhece de forma natural, sem mencionar "registrei seus dados". Continua a conversa. |
| 5 | `quanto custa a entrega?` | Resposta baseada nas Instruções/Entrega da loja (puxadas do `store_settings`). Sem inventar prazo/valor. |

Expected:
- Zero ocorrências de `**`, `#`, ou `-` (bullet) no output do bot.
- Zero ocorrências de palavras de sistema: "achei que", "vieram opções", "retornou", "consulta", "busca", "filtro", "resultados", ou "categoria/linha/estilo" como rótulo técnico.
- No cenário #3, o bot pivota com produtos concretos da nova categoria, não pede permissão.
- No cenário #4, o bot soa natural ("legal te conhecer, Mariana!"), não soa como sistema confirmando cadastro.

- [ ] **Step 4: Se algum cenário falhar — diagnóstico**

Se o bot ainda usa `**`/`#`/`-` na saída:
- Confirmar que o reimport foi feito (verificar via Step 2 que o texto começa com `# Você`).
- Se o texto está atualizado mas o output ainda tem markdown, o LLM está ignorando a regra — adicionar reforço no prompt e re-iterar.

Se o bot vaza metalinguagem ("achei que", etc):
- Mesmo procedimento de diagnóstico — confirmar import + ajustar a seção "Como você fala".

Se o pivot não acontece (cenário #3):
- Verificar que o nó "Get Shown Products" está rodando (Executions → ver se aparece). Se a lista de já mostrados não chegou ao prompt, o LLM não sabe que esgotou.

Em qualquer falha real, criar uma nova task de ajuste e re-iterar o Step 1-3.

---

## Fora do escopo (não fazer nesta entrega)

- Reescrever prompts do Lead Analyzer, Gap Detector, Interest Summarizer — esses ficam intactos.
- Adicionar campo `agent_persona` em `store_settings` (personalização por loja).
- Alterar a tool BUSCAR_PRODUTOS ou seu schema.
- Mudar conexões, nós, ou tabelas.
- Testes automatizados do prompt (sem framework no projeto).
