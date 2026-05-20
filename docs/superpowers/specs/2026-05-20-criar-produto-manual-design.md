# Criar Produto Manual — Design

**Data:** 2026-05-20
**Branch sugerida:** `feat/estoque-criar-produto`

## Contexto

O menu `Estoque` (`src/app/estoque/page.tsx`) já lista produtos da tabela `products` e tem um drawer de edição (`ProductEditDrawer`). A barra de filtros (`src/components/estoque/FilterBar.tsx:68`) já tem o botão `+ Adicionar Produto`, mas ele está `disabled` e sem handler — comentário no `EstoqueClient.tsx:91` diz `// ativado na Leva 2`.

A server action `saveProduct` em `src/actions/products.ts` só faz `UPDATE`. A importação via JSON (`/estoque/import`) já funciona; falta o fluxo manual.

## Objetivo

Habilitar o botão `+ Adicionar Produto` e abrir um drawer onde o dono da loja preenche manualmente os campos abaixo, com persistência em `products` e upload de imagens pro Supabase Storage:

1. **Nome** — texto, obrigatório
2. **Fotos** — upload de arquivo (múltiplas), convertidas em URLs públicas
3. **Descrição** — texto longo
4. **Tamanhos** — chips pré-definidos + entrada custom
5. **Cores** — chips pré-definidos + entrada custom
6. **Preço** — decimal, obrigatório
7. **Unidades** — inteiro (`stock_quantity`), obrigatório

Campos do schema que **não** entram no formulário (mantém UI enxuta): `sku` (auto-gerado), `category`, `brand`, `compare_at_price`, `stock_min` (defaulta `0` = usa default da loja).

## Decisões

| Decisão | Escolha | Razão |
|---|---|---|
| Upload de foto | Upload de arquivo pro Supabase Storage; salva URL pública em `image_urls[]` | n8n consegue baixar/enviar a imagem por URL; UX natural pro usuário final |
| Pré-definidos tamanhos | `PP, P, M, G, GG, XGG, 36, 37, 38, 39, 40, 41, 42, 43, 44` | Cobre lojas mistas (roupa + calçado) |
| Pré-definidos cores | `Preto, Branco, Cinza, Bege, Azul, Vermelho, Verde, Rosa, Amarelo, Marrom` | Set comum de roupa/acessórios |
| SKU | Auto-gerado (`slug(name)-<hash6>`) | Usuário não precisa pensar nisso; constraint unique do schema preservada |
| Categoria/Marca | Omitidos do formulário | Manter enxuto; editáveis depois via drawer de edição |
| Reuso vs componente novo | Componente novo `ProductCreateDrawer` | Edit drawer tem ~5 campos a mais e usa textareas; misturar polui ambos |

## Arquitetura

### 1. Migration `030_product_images_bucket.sql`

Cria bucket público `product-images` (limite 5MB, mimes `image/*`) e RLS:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
);

CREATE POLICY "product_images_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');

CREATE POLICY "product_images_owner_insert" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'product-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "product_images_owner_update" ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'product-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "product_images_owner_delete" ON storage.objects FOR DELETE
  USING (
    bucket_id = 'product-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
```

Path convention: `<user_id>/<uuid>.<ext>`. Leitura é pública (n8n e front consomem direto); escrita/atualização/delete só pelo dono.

### 2. Server actions em `src/actions/products.ts`

**`uploadProductImage(formData: FormData): Promise<{ url?: string; error?: string }>`**

- Lê `file` do FormData.
- Valida `getAuthedUser()` + `getStoreRole() === 'owner'`.
- Valida `file.type.startsWith('image/')` e `file.size <= 5 * 1024 * 1024`.
- Gera path: `${user.id}/${crypto.randomUUID()}.${ext}` (ext do mime ou nome).
- `supabase.storage.from('product-images').upload(path, file, { contentType: file.type })`.
- Retorna `supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl`.

**`createProduct(input: CreateProductInput): Promise<{ success: boolean; error?: string; productId?: string }>`**

```ts
interface CreateProductInput {
  name: string
  description: string
  price: string
  stock_quantity: string
  tamanhos: string[]
  cores: string[]
  image_urls: string[]
}
```

Validação (espelha `saveProduct`):
- `name` obrigatório, sanitizado, ≤ 500 chars.
- `price` parseável, `0 ≤ price ≤ 99_999_999.99`.
- `stock_quantity` inteiro, `0 ≤ stock ≤ 1_000_000`.
- `tamanhos`, `cores`: cada item sanitizado, ≤ 80 chars, dedup case-insensitive.
- `image_urls`: cada URL valida `http(s)://`, ≤ 500 chars.

SKU auto-gerado:
```ts
function generateSku(name: string): string {
  const base = name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 40)
  const hash = crypto.randomBytes(3).toString('hex')
  return `${base || 'produto'}-${hash}`
}
```

Em caso de violação de unique constraint do SKU, retenta até 3x com novo hash. Após isso, retorna erro genérico.

INSERT:
```ts
.from('products').insert({
  user_id: user.id,
  sku, name, description: description || null,
  price, stock_quantity, stock_min: 0,
  tamanhos, cores,
  image_urls: image_urls.length ? image_urls : null,
}).select('id').single()
```

No sucesso: `revalidatePath('/estoque')` e retorna `{ success: true, productId }`.

### 3. Componente `src/components/estoque/ProductCreateDrawer.tsx`

```tsx
export function ProductCreateDrawer({
  open,
  onClose,
}: { open: boolean; onClose: () => void })
```

Estado local (sem FormData):
```ts
const [name, setName] = useState('')
const [description, setDescription] = useState('')
const [price, setPrice] = useState('')
const [units, setUnits] = useState('')
const [tamanhos, setTamanhos] = useState<string[]>([])
const [cores, setCores] = useState<string[]>([])
const [imageUrls, setImageUrls] = useState<string[]>([])
const [uploading, setUploading] = useState(false)
const [error, setError] = useState<string | null>(null)
const [isPending, startTransition] = useTransition()
```

**Constantes do componente:**
```ts
const TAMANHOS_PREDEFINIDOS = ['PP','P','M','G','GG','XGG','36','37','38','39','40','41','42','43','44']
const CORES_PREDEFINIDAS = ['Preto','Branco','Cinza','Bege','Azul','Vermelho','Verde','Rosa','Amarelo','Marrom']
```

**Sub-componentes inline (mesmo arquivo):**

`<ChipSelector />` — renderiza chips dos pré-definidos (clique toggle on/off, estado visual), lista de chips customs (com botão remover) e input "Outro..." que ao Enter adiciona ao array de selecionados.

`<ImageUploader />` — área dashed com prompt "Clique ou arraste imagens"; `<input type="file" multiple accept="image/*" />` invisível; ao escolher, chama `uploadProductImage` por arquivo em sequência (mostra progress por thumb); thumbnails das URLs já subidas com botão `×` pra remover (remove do array; não deleta do bucket — sem custo de manutenção).

**Submit:**
```ts
function handleSubmit(e: React.FormEvent) {
  e.preventDefault()
  setError(null)
  startTransition(async () => {
    const result = await createProduct({
      name, description, price, stock_quantity: units,
      tamanhos, cores, image_urls: imageUrls,
    })
    if (!result.success) { setError(result.error ?? 'Erro ao criar produto.'); return }
    router.refresh()
    resetForm()
    onClose()
  })
}
```

### 4. Wiring em `src/app/estoque/EstoqueClient.tsx`

Adicionar estado `creating: boolean`:

```tsx
const [creating, setCreating] = useState(false)
// ...
<FilterBar
  ...
  onAddProduct={() => setCreating(true)}
/>
// ...
<ProductCreateDrawer open={creating} onClose={() => setCreating(false)} />
```

### 5. Habilitar botão em `src/components/estoque/FilterBar.tsx`

Remover `disabled` da linha 68:

```tsx
<Button onClick={onAddProduct}>+ Adicionar Produto</Button>
```

## Fluxo end-to-end

1. Owner clica `+ Adicionar Produto` → drawer abre vazio.
2. Owner preenche Nome, escolhe fotos (cada arquivo sobe imediatamente; thumb aparece).
3. Owner seleciona chips de tamanho/cor ou digita customs.
4. Owner preenche Preço e Unidades.
5. Clica `Salvar produto`.
6. `createProduct` valida, gera SKU, faz INSERT em `products`.
7. `revalidatePath('/estoque')` → router.refresh() → lista atualiza com o novo produto.
8. Drawer fecha; form resetado.

## Segurança

- Toda action server-side checa `getAuthedUser()` + `getStoreRole() === 'owner'` (mesma guard de `saveProduct`).
- RLS no bucket garante que upload só vai pra pasta `<user_id>/`.
- Sanitização (`sanitizeText`, `sanitizeStringList`, `sanitizeUrlList`) reaproveitada de `saveProduct`.
- Imagens órfãs (uploadadas mas usuário fechou o drawer sem salvar) ficam no bucket — aceitável; pode-se rodar limpeza periódica depois se virar problema.

## Testes

Manual end-to-end na branch:
- Criar produto com 0 imagens.
- Criar produto com 1 imagem.
- Criar produto com 3 imagens, remover 1 antes de salvar.
- Nomes idênticos consecutivos (testa retentativa de SKU).
- Tentar acessar como não-owner (membro): server action retorna erro.
- Acessar URL pública da imagem deslogado: deve carregar (bucket público).

## Fora de escopo

- Edição de imagens (crop, ordenar).
- Deletar imagem do bucket quando produto é removido (limpeza separada).
- Categoria, marca, preço comparativo, estoque mínimo no formulário de criação (editáveis depois).
- Visualização "Estoque detalhado" por variante.
