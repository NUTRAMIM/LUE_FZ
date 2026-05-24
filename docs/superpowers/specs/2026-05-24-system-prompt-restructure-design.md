# Reestruturação do systemMessage do AI Agent2 Design

**Status:** Spec aprovada → pronta para implementation plan
**Data:** 2026-05-24
**Escopo:** Reescrever o `systemMessage` do nó `AI Agent2` em `n8n/workflow-chat-agent.json` substituindo a versão atual (~3500 chars, 10 seções, sobreposições) por uma versão enxuta (~1900 chars, 7 seções com responsabilidade única).

---

## 1. Motivação

O `systemMessage` do AI Agent2 cresceu de forma incremental ao longo de várias iterações (humanização, anti-repetição, auto-pivot, ban de markdown, ban de metalinguagem). O resultado é um prompt:

- Longo demais (~3500 caracteres) — consome contexto e diluí prioridades.
- Repetitivo — a regra de "sem markdown" aparece em 3 seções, "não soe como sistema" em 2 seções, anti-repetição cruza com "como você fala".
- Acoplado a um vertical (moda feminina) com termos como "vendedora amiga" e mapeamentos hardcoded ("top → cropped").
- Misturando rules essenciais com style guidance secundária sem hierarquia clara.

Usuário relatou que o agente está confuso em interpretar o prompt. Mensagens recentes do bot ainda vazam metalinguagem ("Achei que nessa linha não vieram outras opções"), o que indica que o LLM perde o sinal num prompt longo demais.

## 2. Objetivos e não-objetivos

**Objetivos:**
- Reduzir o `systemMessage` em ~50% mantendo todos os comportamentos essenciais.
- Cada seção do prompt tem **uma responsabilidade clara** sem sobreposição com as outras.
- Prompt funciona para **qualquer loja** da plataforma LUE FZ (multi-loja genérico), não só moda feminina.
- Auto-pivot funciona **dinamicamente** com base na lista de categorias da loja (sem mapeamentos hardcoded).

**Não-objetivos:**
- Alterar a arquitetura do workflow (nós, conexões, tools).
- Alterar o comportamento de outros nós (Lead Analyzer, Gap Detector, Mention Extractor).
- Alterar a tool BUSCAR_PRODUTOS ou sua descrição.
- Alterar a Postgres Chat Memory ou Get Shown Products.
- Adicionar features novas — só reestruturar o que já existe.

## 3. Decisões herdadas do brainstorm

| Decisão | Escolha |
|---|---|
| Escopo | Multi-loja genérico — funciona pra qualquer loja sem editar prompt |
| Tom | Neutro "você" + sem gênero do assistente |
| Inegociáveis | Não inventar / zero markdown / não repetir mostrado / pivot direto |
| Anti-repetição exceção | Cliente pode pedir produto de novo pelo nome explícito |
| Coleta de lead | Pede naturalmente quando faz sentido, um dado por vez |
| Formato produto | Quebrado em linhas separadas (não travessão único) |
| Limite produtos | Máximo 3 por mensagem |
| Pivot logic | Agente decide dinamicamente pela lista de Categorias da loja |
| Comportamentos secundários mantidos | Variar aberturas + não insistir após "não" |
| Comportamentos secundários cortados | Espelhar energia / 1 pergunta por vez / emoji máx 1 / filtro de kits |

## 4. Estrutura do novo systemMessage

7 seções, cada uma com propósito único:

1. **`# Você`** — identidade (1-2 frases): assistente da loja, trata cliente por "você", descobre intenção antes de oferecer.

2. **`# A loja`** — contexto operacional injetado via expressions: categorias, pagamento, entrega, instruções da loja.

3. **`# Como você fala`** — três princípios de estilo:
   - Zero markdown na saída (regra dura).
   - Variar aberturas + acolher "não" sem reformular oferta.
   - Falar sobre produtos e cliente, nunca sobre o que o agente faz internamente. Princípio + 1 exemplo ruim + 1 exemplo bom.

4. **`# Buscar produtos (tool BUSCAR_PRODUTOS)`** — uso da tool + auto-pivot inline. Inclui:
   - Quando usar a tool.
   - Os dois parâmetros (consulta + category).
   - Regra hard: nunca inventar.
   - Auto-pivot em 4 passos quando a tool não traz nada novo — agente identifica a categoria mais próxima na lista da loja, chama BUSCAR_PRODUTOS de novo, mostra direto sem pedir autorização.

5. **`# Já mostrado nesta conversa`** — lista injetada do nó Get Shown Products + regra de não-repetição com exceção (cliente pode pedir produto pelo nome).

6. **`# Mostrar produto`** — formato concreto: máximo 3 produtos por mensagem, frase curta antes, cada produto em bloco de linhas (Nome / R$ / Tamanhos / Cores / link). Omitir campo vazio.

7. **`# Lead`** — coleta natural, um dado por vez: nome quando engata, WhatsApp quando interesse real, email quando aplicável. Sem insistir em recusa.

## 5. Texto final do systemMessage

(Conteúdo exato a colocar no campo `parameters.options.systemMessage` do nó AI Agent2, no formato n8n expression — string começando com `=` e usando `{{ ... }}` para interpolar:)

```
=# Você
Assistente da loja {{ $('Informaçoes da loja1').item.json.store_name }}. Trata o cliente por "você". Descobre a intenção antes de oferecer produto.

# A loja
Categorias: {{ $('Informaçoes da loja1').item.json.categories }}
Pagamento: {{ $('Informaçoes da loja1').item.json.payment_methods }}
Entrega: {{ $('Informaçoes da loja1').item.json.delivery_methods }}
Instruções: {{ $('Informaçoes da loja1').item.json.service_instructions }}

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
{{ $('Get Shown Products').item.json.shown_list || '(nenhum)' }}

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
Pede dados pessoais naturalmente, um por vez, quando faz sentido:
- Nome quando a conversa engata
- WhatsApp quando o cliente demonstra interesse real (comprar, reservar)
- Email quando aplicável (catálogo, lista de espera)
Sem insistir em recusa.
```

## 6. Comparativo: antes × depois

| Aspecto | Antes | Depois |
|---|---|---|
| Tamanho | ~3500 chars | ~1900 chars (−46%) |
| Seções | 10 | 7 |
| "Sem markdown" mencionado | 3 vezes | 1 vez |
| Banidas (metalinguagem) | Lista enumerada de 4 categorias | Princípio + 1 par exemplo ruim/bom |
| Pivot logic | Mapeamentos hardcoded (top→cropped, vestido→saia longa, etc) | Decisão dinâmica baseada na lista de Categorias da loja |
| Anti-repetição | Absoluta | Com exceção (cliente pode pedir produto pelo nome) |
| Comportamentos secundários | Espelhar energia / 1 pergunta por vez / emoji max 1 / filtro kits / + 5 outros | Apenas variar aberturas + acolher "não" |
| Tom | "vendedora amiga" (feminino, moda) | "assistente da loja" (neutro, multi-loja) |

## 7. Plano de implementação (alto nível)

A implementação é uma única edição no `n8n/workflow-chat-agent.json` substituindo o valor do campo `parameters.options.systemMessage` no nó com `name: "AI Agent2"` (id `04021648-9c43-4257-80c8-51f2378ac4a8`).

Passos:

1. Edit JSON: substituir o `systemMessage` atual pela versão da seção 5 (com `\n` como escape JSON para quebras de linha).
2. Validar JSON com `node -e "JSON.parse(...)"`.
3. Commit (`feat(n8n): restructure AI Agent2 systemMessage to concise 7-section version`).
4. Usuário reimporta o workflow no n8n e mantém Active.
5. Validação manual: enviar mensagem no chat e confirmar que o bot:
   - Não usa markdown (sem `**`, `#`, `-`).
   - Mostra produto em linhas separadas (não em uma linha com travessões).
   - Pivota direto pra outra categoria quando esgota, sem perguntar.
   - Não vaza metalinguagem ("achei que", "vieram opções", etc).

A reestruturação não afeta tabelas, server actions, componentes do app, ou outros nós do workflow.

## 8. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| LLM perde alguma regra que era importante mas foi cortada | Os 4 inegociáveis (não inventar / zero markdown / não repetir / pivot direto) estão preservados. Cortes foram explícitos no brainstorm e validados pelo usuário. |
| Auto-pivot dinâmico falha em lojas com categorias muito genéricas ("Produtos", "Itens") | Sem mapeamento hardcoded, o LLM precisa interpretar. Se a loja tiver categorização ruim, o pivot pode escolher mal. Mitigação: o passo 4 do auto-pivot fala honesto se a segunda tentativa esgotar. |
| Quebra de comportamentos que dependiam de regras cortadas (ex: "espelhar energia") | São style nice-to-haves. Usuário priorizou enxutar; trade-off aceito. |
| Reimport no n8n não preserva o workflow ID e cria um duplicado | Procedimento padrão: reimport sobrescreve o existente quando feito via "Import from File" no menu do workflow. Documentado nos passos. |

## 9. Fora do escopo

- Adicionar campo `agent_persona` em `store_settings` para cada loja customizar o tom (Approach C do brainstorm). Pode ser feature futura.
- Alterar a tool BUSCAR_PRODUTOS ou seu schema.
- Alterar a estrutura do workflow (conexões, nós).
- Reescrever o prompt do Lead Analyzer, Gap Detector, ou Interest Summarizer — esses são separados e mantêm seus prompts.
- Testes automatizados do prompt (sem framework de teste de prompt no projeto).
