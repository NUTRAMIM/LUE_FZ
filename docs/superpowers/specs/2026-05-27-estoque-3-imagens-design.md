# Estoque — limite de até 3 imagens por produto

**Data**: 2026-05-27
**Status**: Design aprovado, aguardando spec review

## Contexto

Hoje o menu **Estoque** já persiste fotos do produto na coluna `products.image_urls` (tipo `text[]`), mas a UX é inconsistente:

- **Criar produto** (`ProductCreateDrawer`): uploader de arquivos para o bucket `product-images`, sem limite explícito.
- **Editar produto** (`ProductEditDrawer`): `<textarea>` onde se cola URLs (uma por linha), sem limite e sem uploader.

A `sync.ts` do n8n já capa em 3 imagens (`p.imagens.slice(0, 3)`), o que sugere que 3 é o limite informal usado no resto do sistema (chat, painel etc.).

## Objetivo

Permitir que o dono da loja adicione **até 3 imagens** por produto, com a mesma UX de uploader em **Criar e Editar**, persistidas como URLs no array `products.image_urls` (estrutura inalterada).

## Não-objetivos

- Mudar o storage (continua `product-images` no Supabase Storage).
- Mexer em `ProductDetailsDrawer` ou `ProductRow` (já tratam array de tamanho qualquer).
- Adicionar suporte a URLs externas (somente upload por arquivo).
- Adicionar constraint no banco (`array_length <= 3`). YAGNI por enquanto — as validações no servidor cobrem.

## Arquitetura

### Fluxo de dados (inalterado)

```
ImageUploader (UI, max 3 URLs)
    → server action (saveProduct / createProduct, sanitize + cap em 3)
    → Supabase products.image_urls (text[])
```

### Componentes

#### 1. Novo: `src/components/estoque/ImageUploader.tsx`

Extração do componente que hoje vive aninhado em `ProductCreateDrawer.tsx`. Recebe:

```ts
type Props = {
  urls: string[]
  onChange: React.Dispatch<React.SetStateAction<string[]>>
  onError: (msg: string | null) => void
  uploading: boolean
  onUploadingChange: (uploading: boolean) => void
  maxImages?: number  // default: MAX_PRODUCT_IMAGES (3)
}

export const MAX_PRODUCT_IMAGES = 3
```

Comportamentos:

- Se `urls.length >= maxImages` → esconde o dropzone (label "Clique para escolher imagens") e renderiza, no lugar, uma frase neutra: *"Limite de 3 imagens atingido. Remova uma para adicionar outra."*
- Se o usuário seleciona N arquivos mas só cabem M (M < N) → faz upload só dos M primeiros e chama `onError` com mensagem interpolando o número real, ex: *"Limite de 3 imagens. Apenas 2 foram enviadas."*
- O grid de previews e o botão de remover ficam como hoje.

#### 2. `src/components/estoque/ProductCreateDrawer.tsx`

- Remove a declaração local de `ImageUploader`.
- Importa `{ ImageUploader, MAX_PRODUCT_IMAGES }` de `./ImageUploader`.
- Nenhuma outra mudança.

#### 3. `src/components/estoque/ProductEditDrawer.tsx`

- Remove `<textarea name="image_urls">` e a helper `urlsToText`.
- Adiciona state: `const [imageUrls, setImageUrls] = useState<string[]>([])`, inicializado de `product.image_urls ?? []` quando `getProductDetails` resolve.
- Adiciona state `uploading` (igual ao Create).
- Renderiza `<ImageUploader urls={imageUrls} onChange={setImageUrls} ... />` no lugar do textarea.
- No `handleSubmit`, em vez de ler `formData.get('image_urls')`, passa `image_urls: imageUrls.join('\n')` (mantém compat com a server action existente, que recebe `string`).
- Validação client-side: se `imageUrls.length > MAX_PRODUCT_IMAGES`, mostra erro inline e bloqueia submit. Isso só ocorre em produtos legados (importados via sync antiga) — o uploader normal já impede ultrapassar.
- Botões "Salvar"/"Cancelar" desabilitam quando `uploading` (mesmo padrão do Create).

#### 4. `src/actions/products.ts`

- Importar `MAX_PRODUCT_IMAGES` de `@/components/estoque/ImageUploader` (fonte única; componente é onde a constante é mais semanticamente próxima do uso).
- Em `sanitizeUrlList`, aplicar `.slice(0, MAX_PRODUCT_IMAGES)` no final.
- Em `saveProduct` e `createProduct`: o sanitize já garante o cap; **não** adicionar erro explícito — preferir truncar silenciosamente (a UI já impede o caso normal; o servidor só protege contra payload manipulado).

### Schema do banco

Sem mudança. `image_urls` continua `text[] NULL`. Sem migration, sem constraint check.

## Tratamento de produtos legados (> 3 imagens)

Cenário: um produto antigo já tem 5 URLs em `image_urls` (improvável dado o slice do n8n, mas possível em dados manuais).

- **Listagem / detalhes**: mostra todas (comportamento atual).
- **Drawer de editar**:
  - Carrega todas no uploader (mostra todos os previews).
  - Banner inline avisa: *"Este produto tem N imagens. O limite agora é 3 — remova as extras antes de salvar."*
  - Submit bloqueado até `imageUrls.length <= 3`.
- **Server action** (defesa em profundidade): se mesmo assim chegar payload com > 3, o `slice(0, 3)` no `sanitizeUrlList` garante que apenas as 3 primeiras são gravadas.

## Testing

Manual:

1. Criar produto novo → tentar enviar 5 fotos de uma vez → só 3 sobem, com aviso.
2. Criar produto novo → enviar 1, 1, 1 → 3 imagens, dropzone some.
3. Criar produto novo → 3 imagens, remover 1 → dropzone volta, posso adicionar mais 1.
4. Editar produto existente com 0 imagens → uploader vazio, fluxo normal.
5. Editar produto com 2 imagens → vejo 2 previews, dropzone visível, posso adicionar +1.
6. Editar produto manipulado com 5 imagens → banner aparece, save bloqueado, após remover sobra 3 → salva ok.
7. Reload da página `/estoque` → cards mostram as imagens salvas (primeira como capa, comportamento atual).

Sem teste automatizado nesta entrega — projeto não tem suite de teste de UI para `/estoque` hoje.

## Pontos não tocados

- `ProductDetailsDrawer` (já renderiza array de qualquer tamanho).
- `ProductRow` (usa só `image_urls?.[0]`).
- Bucket `product-images` e action `uploadProductImage`.
- `lib/inventory/sync.ts` (já tem `slice(0, 3)`).
- `api/inventory/export` e `api/inventory/import` (consomem array; não impõem limite — fora do escopo).
