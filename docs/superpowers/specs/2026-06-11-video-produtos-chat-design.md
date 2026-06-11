# Vídeo de produto no chat — Design

**Data:** 2026-06-11
**Status:** Aprovado

## Objetivo

Permitir que a IA envie um vídeo do produto junto com as fotos no chat. O vídeo
aparece sempre como **último slide** do carrossel do produto. A URL do vídeo já
vem no JSON de importação (FacilZap); falta (a) mapear esse campo no import,
(b) permitir cadastrar/subir vídeo no cadastro manual de produto, e (c)
renderizar o vídeo no carrossel do chat — nos dois caminhos do agente
(`LISTAR_CATEGORIA` e `BUSCAR_PRODUTOS`).

## Decisões

- **1 vídeo por produto** (URL única).
- **Origem no JSON FacilZap:** campo `"video"` com uma URL `.mp4`
  (ex.: `https://arquivos.facilzap.app.br/videos_produtos/..._....mp4`).
- **Cadastro manual:** upload de arquivo de vídeo → bucket Supabase → URL pública
  (mesmo padrão das imagens). Formatos aceitos: `mp4`, `webm`, `mov`
  (`video/mp4`, `video/webm`, `video/quicktime`). **Limite: 20 MB.**
- **Renderização no chat:** player inline `<video>` com **autoplay mudo** (estilo
  Reels/story), em loop, tocando **somente quando o slide está selecionado** no
  carrossel. Sempre o último slide. Vídeo não abre lightbox (usa controles
  próprios).
- **`BUSCAR_PRODUTOS` emite cards** com carrossel+vídeo automaticamente para
  todos os resultados casados (até `match_count = 6`), igual ao
  `LISTAR_CATEGORIA`.

## Arquitetura e mudanças

### 1. Banco — tabela `products`

- Migration nova: `ALTER TABLE products ADD COLUMN video_url text;` (nullable).
- `src/types/database.ts`: adicionar `video_url: string | null` em
  `Row`/`Insert`/`Update` de `products`.

### 2. Banco — RAG (`documents`)

A busca semântica (`BUSCAR_PRODUTOS`) lê o `metadata` do documento. A migration
`034` já copia `image_urls` do produto para o metadata via trigger
(`documents_attach_image_urls`, casa por `lower(name)+user_id`).

- Migration nova espelhando a `034`: estender a função/trigger para também
  anexar `video_url` ao `metadata` do documento, **+ backfill** dos documentos
  já indexados. Idempotente (seguro re-rodar).

### 3. Storage — bucket `product-videos`

- Migration espelhando `030_product_images_bucket.sql`:
  - bucket `product-videos`, `public = true`, `file_size_limit = 20971520`
    (20 MB), `allowed_mime_types = ['video/mp4','video/webm','video/quicktime']`.
  - Policies: SELECT público; INSERT/UPDATE/DELETE restritos ao dono via
    `auth.uid()::text = (storage.foldername(name))[1]`.

### 4. Import JSON (`src/lib/inventory/sync.ts`)

- `FacilZapProduct`: adicionar `video: string | null`.
- `mapProduct`: `video_url: p.video ?? null`.

### 5. Cadastro manual (front estoque)

- Novo componente `src/components/estoque/VideoUploader.tsx` (espelha
  `ImageUploader`, mas **1 arquivo único**): preview com `<video>`, botão
  remover, validação client de tipo/tamanho.
- `src/actions/products.ts`:
  - Nova action `uploadProductVideo(formData)`: valida mime
    (`video/mp4|webm|quicktime`) e tamanho ≤ 20 MB, sobe no bucket
    `product-videos` em `${user.id}/${uuid}.${ext}`, retorna `{ success, url }`.
    Restrito a `owner` (mesmo padrão de `uploadProductImage`).
  - `CreateProductInput` e `SaveProductInput`: adicionar `video_url` (string,
    pode ser vazio).
  - `createProduct` e `saveProduct`: sanitizar `video_url` (validação de URL
    http/https, igual `sanitizeUrlList`, mas single) e persistir
    (`video_url: url || null`).
- Plugar o `VideoUploader` em `ProductCreateDrawer.tsx` e `ProductEditDrawer.tsx`
  (carregar `product.video_url` na edição; enviar no submit).

### 6. Chat-service (Python)

- `app/agent/tools.py`:
  - `_build_card`: após anexar as `image_urls`, anexar `video_url` (se houver) —
    garante que a URL do vídeo seja a **última linha de mídia** do card.
    Compartilhado pelos dois tools.
  - `buscar_produtos`: **refatorar** para montar cards via `_build_card` a partir
    do `metadata` de cada match (`name`, `image_urls`, `video_url`, `price`,
    `tamanhos` como lista, `cores` como lista) e retornar `(segmento, ids,
    resumo)` — paralelo a `listar_categoria`. O `resumo` instrui o LLM a dar uma
    frase curta de fecho.
- `app/db.py`:
  - `get_products_by_category`: incluir `video_url` no SELECT (para
    `LISTAR_CATEGORIA`).
  - Resolver `product_id` real dos matches da busca por `name+user_id`
    (`LIMIT 1`) para registrar `product_mentions`/`shown_product_ids` — método
    auxiliar novo ou subconsulta. (O `product_id` do metadata é instável,
    conforme nota da migration 029.)
- `app/agent/runner.py`:
  - Tratar o novo retorno de `BUSCAR_PRODUTOS` igual ao `LISTAR_CATEGORIA`:
    `product_segments.append(segmento)`, `shown_product_ids.extend(ids)`, e
    `content = resumo`.

### 7. Chat front (renderização)

- `src/app/chat/[slug]/components/message-segments.ts`:
  - Novo tipo de segmento `video` (`{ type: 'video'; src: string }`) e item de
    render correspondente.
  - Regex de mídia detecta imagem **e** vídeo (`.mp4|.webm|.mov`), preservando a
    ordem; cada URL vira segmento `image` ou `video`.
  - `groupConsecutiveImages` → `groupConsecutiveMedia`: agrupa segmentos de mídia
    consecutivos (imagens + vídeo final) num único grupo (`mediaGroup`) com itens
    tipados.
- `ImageCarousel.tsx` → `MediaCarousel` (renomear/generalizar):
  - Recebe itens `{ type: 'image' | 'video'; src }`.
  - Slide imagem: `<img>` (mantém clique → lightbox).
  - Slide vídeo: `<video muted loop playsInline>` que dá play quando
    `selectedIndex` aponta para ele e pausa caso contrário (evita tocar vídeos
    fora de vista). Mostra controles nativos.
- `MessageBubble.tsx`: ajustar tipos para o grupo de mídia e renderizar
  `MediaCarousel`. Item de vídeo isolado (sem imagens) renderiza um `<video>`
  standalone.
- `ImageLightbox.tsx`: permanece **só imagem** (vídeo não abre lightbox).

## Fora de escopo

- Múltiplos vídeos por produto.
- Transcodificação/compressão do vídeo no upload (sobe o arquivo como está,
  validando só tipo e tamanho).
- Vídeo na visualização de detalhes do produto (`ProductDetailsDrawer`) — pode
  ser incremento futuro; não bloqueia a feature.

## Riscos

- `BUSCAR_PRODUTOS` passa a mostrar todos os matches (até 6) como cards — pode
  trazer item menos relevante que o matching semântico trouxe. Aceito.
- Resolução de `product_id` por nome pode colidir em nomes duplicados; mitigado
  com `LIMIT 1`.
- Autoplay mudo: browsers permitem autoplay só com `muted`; garantir o atributo
  para não ser bloqueado.

## Testes

- **sync.ts:** teste de mapeamento — produto com `video` → `video_url`
  preenchido; sem `video` → `null`.
- **message-segments.ts:** parsing de texto com imagens + vídeo final →
  segmentos corretos e agrupamento num único `mediaGroup` com vídeo por último;
  vídeo isolado; só imagens (regressão).
- **chat-service tools/runner:** `_build_card` com `video_url` coloca o vídeo na
  última linha; `buscar_produtos` retorna `(segmento, ids, resumo)` e o runner
  popula `product_segments`/`shown_product_ids`.
- **Manual/UI:** validação de tamanho/tipo no `uploadProductVideo`; smoke test do
  carrossel no browser (autoplay mudo, vídeo por último, troca de slide).
