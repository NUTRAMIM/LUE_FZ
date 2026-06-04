# Envio de categoria completa — Design

**Data:** 2026-06-03
**Status:** Aprovado para planejamento

## Objetivo

Quando o lead pede uma categoria inteira **sem nenhum filtro** (ex.: "me mostra os
conjuntos", "quais tops vocês têm"), o serviço deve enviar **todas as peças em estoque**
daquela categoria de uma vez, com os cards `[produto]` montados por **código** (não
redigidos pelo LLM), economizando token e ignorando o limite de 3 itens do fluxo normal.

## Decisões (confirmadas com o usuário)

1. **Volume:** envia todas as peças, filtrando só as disponíveis em estoque
   (`is_available = true`). Sem teto.
2. **Detecção:** nova tool de LLM `LISTAR_CATEGORIA(categoria)`. O modelo decide quando
   usar (categoria sem filtro) vs. `BUSCAR_PRODUTOS` (pedido com filtro).
3. **Renderização:** código monta os blocos `[produto]` e o **pipeline** insere as
   mensagens; o LLM nunca vê o payload dos produtos.
4. **Ordem dentro do card:** nome → imagem → preço → tamanhos → cores.
5. **Pacing (frontend):** mais de 8 cards → 1,5s entre eles; até 8 → mantém 4s.

## Arquitetura

Tool de LLM nova ao lado de `BUSCAR_PRODUTOS`. A função `listar_categoria` é pura
(lê do banco, não escreve): retorna `(segmento_texto, ids, resumo)`. O runner acumula
`segmento`/`ids` e devolve ao LLM apenas o `resumo` curto. `run_agent` passa a retornar
um `AgentResult`. O pipeline insere os cards, registra `ai_shown` por id e insere a frase
de fecho do LLM. O frontend ajusta o ritmo de exibição conforme a quantidade de cards.

Ordem final no chat: **cards primeiro, depois a frase de fecho do LLM.**

## Componentes e arquivos

### Backend (Python — chat-service)

**`app/db.py` — novo método**

```python
async def get_products_by_category(self, store_id, category):
    SELECT id::text, name, price, brand, tamanhos, cores, image_urls
    FROM products
    WHERE user_id = $1
      AND lower(category) = lower($2)
      AND is_available = true
    ORDER BY name
```

**`app/agent/tools.py` — nova função pura**

`listar_categoria(db, store_id, categoria) -> (segmento: str, ids: list[str], resumo: str)`

- Busca via `get_products_by_category`.
- Categoria vazia/sem peça em estoque → `("", [], "Nenhuma peça disponível em <cat>")`.
- Caso contrário monta **uma** string com todos os blocos:

```
[produto]
Nome da peça
https://primeira-image_url
R$ 89,90
Tamanhos: P, M, G
Cores: preto, branco (+3 de 5)
[/produto]
```

- Usa a 1ª URL de `image_urls`; reaproveita `summarize_cores`; preço `R$ 89,90`
  (vírgula decimal, 2 casas). Linhas opcionais (sem imagem, sem tamanhos, sem cores)
  são omitidas.
- `resumo` curto pro LLM, ex.: `"Mostrei 12 peças de Conjuntos. Escreva só uma frase
  curta de fecho perguntando se quer ver tamanho/cor de alguma."`

**`app/agent/runner.py`**

- Adiciona `TOOL_SCHEMA_LISTAR` (`LISTAR_CATEGORIA`, param `categoria`); oferece as duas
  tools.
- Descrição: usar para categoria INTEIRA sem filtro; para pedido COM filtro (cor,
  tamanho, ocasião, preço) usar `BUSCAR_PRODUTOS`; `categoria` deve ser a categoria
  EXATA da loja.
- Quando o LLM chama `LISTAR_CATEGORIA`: chama `listar_categoria`, faz
  `if segmento: product_segments.append(segmento); shown_ids += ids`, e anexa a mensagem
  `tool` com **apenas o `resumo`**.
- Retorno: `AgentResult(text, product_segments, shown_product_ids)` (dataclass em
  `app/models.py`). Caminho normal → listas vazias.

**`app/models.py`**

```python
@dataclass
class AgentResult:
    text: str
    product_segments: list[str] = field(default_factory=list)
    shown_product_ids: list[str] = field(default_factory=list)
```

**`app/pipeline.py`**

- `result = await run_agent(...)`.
- Para cada `seg` em `result.product_segments`: `insert_message(conv, "assistant", seg)`.
- Para cada `pid` em `result.shown_product_ids`:
  `insert_product_mention(store.id, conv, pid, "ai_shown")`.
- Depois insere `result.text` (se não vazio).
- `Context` para as branches continua usando `result.text`.

### Frontend (Next.js)

**`src/app/chat/[slug]/components/ai-split.ts`**

```ts
export const FAST_PRODUCT_DELAY_MS = 1_500
export const PRODUCT_BURST_THRESHOLD = 8

export function delayForSegment(seg: AISegment, productCount = 0): number {
  if (seg.kind === 'product')
    return productCount > PRODUCT_BURST_THRESHOLD ? FAST_PRODUCT_DELAY_MS : PRODUCT_DELAY_MS
  return seg.content.length * TEXT_DELAY_MS_PER_CHAR
}
```

**`src/app/chat/[slug]/ChatClient.tsx`**

- Em `enqueueAI`: `const productCount = segments.filter(s => s.kind === 'product').length`.
- Passa `productCount` nas duas chamadas de `delayForSegment` (linhas ~151 e ~192).

## Fluxo

1. Lead: "me mostra os conjuntos".
2. LLM chama `LISTAR_CATEGORIA(categoria="Conjuntos")`.
3. `listar_categoria` busca peças em estoque, monta os blocos, retorna `(segmento, ids,
   resumo)`.
4. Runner guarda `segmento`/`ids`, devolve só `resumo` ao LLM.
5. LLM escreve a frase de fecho (`result.text`).
6. Pipeline insere o segmento de cards, registra `ai_shown` por id, insere a frase.
7. Frontend exibe os cards (1,5s se >8, senão 4s) e depois a frase.

## Casos de borda

- **Categoria sem peça em estoque ou inexistente:** nenhum card; LLM avisa o cliente e
  pode usar `BUSCAR_PRODUTOS`.
- **Categoria que o LLM passa não bate exatamente:** match é case-insensitive; sem
  correspondência → trata como "sem peça" (resumo vazio de cards).
- **Dedup:** como os ids viram `ai_shown`, o `shown_list` do prompt evita repetir as
  mesmas peças depois.
- **Volume alto:** sem teto (decisão do usuário); pacing rápido (1,5s) acima de 8 cards
  atenua o tempo total de envio.

## Testes (TDD)

**Python**
- `get_products_by_category`: filtra categoria (case-insensitive) e só `is_available`.
- `listar_categoria`: ordem nome→imagem→resto; 1ª `image_urls`; preço formatado; ids
  corretos; resumo vazio de cards quando categoria vazia/sem estoque.
- `run_agent`: retorna `AgentResult` com `product_segments`/`shown_product_ids` quando
  a tool é chamada; caminho normal só com texto.
- `process_message`: insere cards + registra `ai_shown` por id + insere fecho na ordem
  certa.

**Frontend**
- `delayForSegment(productSeg, 9)` → `1500`; `delayForSegment(productSeg, 8)` → `4000`;
  texto inalterado.

## Fora de escopo

- Teto máximo de peças por categoria.
- Detecção determinística por palavra-chave (optou-se por tool de LLM).
- Filtros combinados (cor + categoria) — continuam no `BUSCAR_PRODUTOS`.
