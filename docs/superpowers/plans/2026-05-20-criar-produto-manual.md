# Criar Produto Manual — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Habilitar o botão `+ Adicionar Produto` na página `/estoque` e abrir um drawer onde o dono da loja preenche nome, fotos (upload), descrição, tamanhos (chips), cores (chips), preço e unidades, com persistência em `products` e upload pro Supabase Storage.

**Architecture:** Migration nova cria bucket público `product-images` com RLS por user_id. Duas server actions novas em `src/actions/products.ts` (`uploadProductImage` e `createProduct`). Componente novo `ProductCreateDrawer` com sub-componentes inline (`ChipSelector`, `ImageUploader`). Botão existente em `FilterBar` perde o `disabled` e ganha handler em `EstoqueClient`.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Supabase (auth + Postgres + Storage), Vitest, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-05-20-criar-produto-manual-design.md`

---

## File Structure

**Create:**
- `src/lib/sku.ts` — helpers puros `slugifyName(name)` e `generateSku(name)`
- `src/lib/__tests__/sku.test.ts` — testes dos helpers
- `supabase/migrations/030_product_images_bucket.sql` — bucket + RLS
- `src/components/estoque/ProductCreateDrawer.tsx` — drawer + sub-componentes inline

**Modify:**
- `src/actions/products.ts` — adicionar `uploadProductImage` e `createProduct`
- `src/components/estoque/FilterBar.tsx:68` — remover `disabled`
- `src/app/estoque/EstoqueClient.tsx` — estado `creating` + renderizar drawer

---

## Task 1: SKU helper (TDD)

**Files:**
- Create: `src/lib/sku.ts`
- Test: `src/lib/__tests__/sku.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/__tests__/sku.test.ts
import { describe, it, expect } from 'vitest'
import { slugifyName, generateSku } from '../sku'

describe('slugifyName', () => {
  it('lowercases and kebab-cases simple names', () => {
    expect(slugifyName('Camiseta Azul')).toBe('camiseta-azul')
  })

  it('strips diacritics', () => {
    expect(slugifyName('Vestido Coração')).toBe('vestido-coracao')
  })

  it('collapses non-alphanumeric runs into single dash', () => {
    expect(slugifyName('Bermuda  ___  Verão  2025!!!')).toBe('bermuda-verao-2025')
  })

  it('trims leading/trailing dashes', () => {
    expect(slugifyName('---hello---')).toBe('hello')
  })

  it('truncates to 40 chars', () => {
    const long = 'a'.repeat(60)
    expect(slugifyName(long).length).toBe(40)
  })

  it('returns empty string for input with no alphanumerics', () => {
    expect(slugifyName('!!! ___ ???')).toBe('')
  })
})

describe('generateSku', () => {
  it('combines slug with 6-hex-char suffix', () => {
    const sku = generateSku('Camiseta Azul')
    expect(sku).toMatch(/^camiseta-azul-[0-9a-f]{6}$/)
  })

  it('falls back to "produto" prefix when slug is empty', () => {
    const sku = generateSku('!!!')
    expect(sku).toMatch(/^produto-[0-9a-f]{6}$/)
  })

  it('generates different suffixes on consecutive calls', () => {
    const suffixes = new Set(
      Array.from({ length: 20 }, () => generateSku('teste').split('-').pop()),
    )
    expect(suffixes.size).toBeGreaterThan(15)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
npm test -- src/lib/__tests__/sku.test.ts
```

Expected: FAIL with "Cannot find module '../sku'".

- [ ] **Step 3: Implement helpers**

```ts
// src/lib/sku.ts
import { randomBytes } from 'node:crypto'

export function slugifyName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

export function generateSku(name: string): string {
  const base = slugifyName(name) || 'produto'
  const suffix = randomBytes(3).toString('hex')
  return `${base}-${suffix}`
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
npm test -- src/lib/__tests__/sku.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sku.ts src/lib/__tests__/sku.test.ts
git commit -m "feat(estoque): add sku slugify + generator helpers"
```

---

## Task 2: Migration for product-images bucket

**Files:**
- Create: `supabase/migrations/030_product_images_bucket.sql`

- [ ] **Step 1: Create migration file**

```sql
-- 030_product_images_bucket.sql
-- Bucket publico para imagens de produtos. Leitura publica (n8n e front
-- consomem por URL direta). Escrita/update/delete restritos ao dono do
-- arquivo, via match do primeiro segmento do path (<user_id>/<uuid>.ext).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO NOTHING;

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

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/030_product_images_bucket.sql
git commit -m "feat(db): add product-images bucket with owner-scoped RLS"
```

> **Nota:** O usuário precisa rodar este SQL no SQL Editor do Supabase manualmente (mesmo padrão das outras migrations). Esta etapa é cumprida na Task 7.

---

## Task 3: `uploadProductImage` server action

**Files:**
- Modify: `src/actions/products.ts`

- [ ] **Step 1: Adicionar a action ao final do arquivo**

Abrir `src/actions/products.ts` e adicionar antes do último `}` do arquivo (depois de `getProductDetails`):

```ts
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export interface UploadProductImageResult {
  success: boolean
  url?: string
  error?: string
}

export async function uploadProductImage(
  formData: FormData,
): Promise<UploadProductImageResult> {
  const supabase = await createClient()

  const user = await getAuthedUser()
  if (!user) {
    return { success: false, error: 'Nao autorizado. Faca login novamente.' }
  }
  if ((await getStoreRole()) !== 'owner') {
    return { success: false, error: 'Apenas o dono da loja pode subir imagens.' }
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return { success: false, error: 'Arquivo invalido.' }
  }
  if (!ALLOWED_IMAGE_MIMES.has(file.type)) {
    return { success: false, error: 'Formato nao suportado. Use JPG, PNG, WEBP ou GIF.' }
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { success: false, error: 'Imagem maior que 5MB.' }
  }

  const ext = EXT_BY_MIME[file.type] ?? 'jpg'
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('product-images')
    .upload(path, file, { contentType: file.type, upsert: false })

  if (uploadError) {
    console.error('uploadProductImage error:', uploadError)
    return { success: false, error: 'Erro ao subir imagem. Tente novamente.' }
  }

  const { data } = supabase.storage.from('product-images').getPublicUrl(path)
  if (!data?.publicUrl) {
    return { success: false, error: 'Erro ao gerar URL publica.' }
  }
  return { success: true, url: data.publicUrl }
}
```

- [ ] **Step 2: Verificar build/lint**

```
npm run lint
```

Expected: sem novos erros.

- [ ] **Step 3: Commit**

```bash
git add src/actions/products.ts
git commit -m "feat(estoque): add uploadProductImage server action"
```

---

## Task 4: `createProduct` server action

**Files:**
- Modify: `src/actions/products.ts`

- [ ] **Step 1: Adicionar import do helper**

No topo de `src/actions/products.ts`, adicionar:

```ts
import { generateSku } from '@/lib/sku'
```

- [ ] **Step 2: Adicionar interface e action**

Adicionar ao arquivo (depois de `uploadProductImage`):

```ts
export interface CreateProductInput {
  name: string
  description: string
  price: string
  stock_quantity: string
  tamanhos: string[]
  cores: string[]
  image_urls: string[]
}

export interface CreateProductResult {
  success: boolean
  error?: string
  productId?: string
}

const MAX_SKU_RETRIES = 3

export async function createProduct(
  data: CreateProductInput,
): Promise<CreateProductResult> {
  const supabase = await createClient()

  const user = await getAuthedUser()
  if (!user) {
    return { success: false, error: 'Nao autorizado. Faca login novamente.' }
  }
  if ((await getStoreRole()) !== 'owner') {
    return { success: false, error: 'Apenas o dono da loja pode criar produtos.' }
  }

  const name = sanitizeText(data.name, MAX_TEXT)
  const description = sanitizeText(data.description, MAX_DESCRIPTION)
  const price = parseNumber(data.price)
  const stockQuantity = parseInteger(data.stock_quantity)

  const tamanhos = sanitizeStringList(
    Array.isArray(data.tamanhos) ? data.tamanhos.join('\n') : '',
    MAX_LIST_ITEM,
  )
  const cores = sanitizeStringList(
    Array.isArray(data.cores) ? data.cores.join('\n') : '',
    MAX_LIST_ITEM,
  )
  const imageUrls = sanitizeUrlList(
    Array.isArray(data.image_urls) ? data.image_urls.join('\n') : '',
  )

  if (!name) return { success: false, error: 'Nome do produto e obrigatorio.' }
  if (price === null || price < 0 || price > MAX_PRICE) {
    return { success: false, error: 'Preco invalido.' }
  }
  if (stockQuantity === null || stockQuantity < 0 || stockQuantity > MAX_STOCK) {
    return { success: false, error: 'Quantidade em estoque invalida.' }
  }

  for (let attempt = 0; attempt < MAX_SKU_RETRIES; attempt++) {
    const sku = generateSku(name)
    const { data: inserted, error } = await supabase
      .from('products')
      .insert({
        user_id: user.id,
        sku,
        name,
        description: description || null,
        price,
        stock_quantity: stockQuantity,
        stock_min: 0,
        tamanhos,
        cores,
        image_urls: imageUrls.length ? imageUrls : null,
      })
      .select('id')
      .single()

    if (!error && inserted) {
      revalidatePath('/estoque')
      return { success: true, productId: inserted.id }
    }

    // 23505 = unique_violation (Postgres). Tenta de novo com outro SKU.
    if (error?.code === '23505' && attempt < MAX_SKU_RETRIES - 1) {
      continue
    }

    console.error('createProduct error:', {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
    })
    return { success: false, error: 'Erro ao criar produto. Tente novamente.' }
  }

  return { success: false, error: 'Nao foi possivel gerar SKU unico. Tente novamente.' }
}
```

- [ ] **Step 3: Verificar build/lint**

```
npm run lint
```

Expected: sem novos erros.

- [ ] **Step 4: Commit**

```bash
git add src/actions/products.ts
git commit -m "feat(estoque): add createProduct server action with auto SKU"
```

---

## Task 5: `ProductCreateDrawer` componente

**Files:**
- Create: `src/components/estoque/ProductCreateDrawer.tsx`

- [ ] **Step 1: Criar componente completo**

```tsx
// src/components/estoque/ProductCreateDrawer.tsx
'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createProduct,
  uploadProductImage,
  type CreateProductInput,
} from '@/actions/products'
import { Button } from '@/components/ui/Button'
import { Drawer } from '@/components/ui/Drawer'
import { Input, Label } from '@/components/ui/Input'
import { cn } from '@/lib/utils'

const TAMANHOS_PREDEFINIDOS = [
  'PP','P','M','G','GG','XGG',
  '36','37','38','39','40','41','42','43','44',
]
const CORES_PREDEFINIDAS = [
  'Preto','Branco','Cinza','Bege','Azul','Vermelho','Verde','Rosa','Amarelo','Marrom',
]

export function ProductCreateDrawer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [units, setUnits] = useState('')
  const [tamanhos, setTamanhos] = useState<string[]>([])
  const [cores, setCores] = useState<string[]>([])
  const [imageUrls, setImageUrls] = useState<string[]>([])

  function resetForm() {
    setName('')
    setDescription('')
    setPrice('')
    setUnits('')
    setTamanhos([])
    setCores([])
    setImageUrls([])
    setError(null)
  }

  function handleClose() {
    if (isPending) return
    resetForm()
    onClose()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const payload: CreateProductInput = {
      name,
      description,
      price,
      stock_quantity: units,
      tamanhos,
      cores,
      image_urls: imageUrls,
    }
    startTransition(async () => {
      const result = await createProduct(payload)
      if (!result.success) {
        setError(result.error ?? 'Nao foi possivel criar o produto.')
        return
      }
      router.refresh()
      resetForm()
      onClose()
    })
  }

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="Adicionar produto"
      widthClass="max-w-lg sm:max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-xl border border-danger/20 bg-danger-soft p-3 text-sm text-danger">
            {error}
          </div>
        )}

        <div>
          <Label htmlFor="cp-name">Nome</Label>
          <Input
            id="cp-name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ex: Camiseta Algodao"
            required
            maxLength={500}
          />
        </div>

        <ImageUploader urls={imageUrls} onChange={setImageUrls} onError={setError} />

        <div>
          <Label htmlFor="cp-description">Descricao</Label>
          <textarea
            id="cp-description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={4}
            maxLength={2000}
            className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 transition-all duration-150 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100"
            placeholder="Detalhes do produto..."
          />
        </div>

        <ChipSelector
          label="Tamanhos"
          predefined={TAMANHOS_PREDEFINIDOS}
          selected={tamanhos}
          onChange={setTamanhos}
          placeholder="Outro tamanho..."
        />

        <ChipSelector
          label="Cores"
          predefined={CORES_PREDEFINIDAS}
          selected={cores}
          onChange={setCores}
          placeholder="Outra cor..."
        />

        <section className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="cp-price">Preco</Label>
            <Input
              id="cp-price"
              value={price}
              onChange={e => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              required
            />
          </div>
          <div>
            <Label htmlFor="cp-units">Unidades</Label>
            <Input
              id="cp-units"
              type="number"
              min={0}
              step={1}
              value={units}
              onChange={e => setUnits(e.target.value)}
              placeholder="0"
              required
            />
          </div>
        </section>

        <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
          <Button type="button" variant="secondary" onClick={handleClose} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Criando...' : 'Criar produto'}
          </Button>
        </div>
      </form>
    </Drawer>
  )
}

function ChipSelector({
  label,
  predefined,
  selected,
  onChange,
  placeholder,
}: {
  label: string
  predefined: string[]
  selected: string[]
  onChange: (next: string[]) => void
  placeholder: string
}) {
  const [draft, setDraft] = useState('')

  function toggle(value: string) {
    const exists = selected.some(v => v.toLowerCase() === value.toLowerCase())
    if (exists) {
      onChange(selected.filter(v => v.toLowerCase() !== value.toLowerCase()))
    } else {
      onChange([...selected, value])
    }
  }

  function addCustom() {
    const trimmed = draft.trim()
    if (!trimmed) return
    const exists = selected.some(v => v.toLowerCase() === trimmed.toLowerCase())
    if (!exists) onChange([...selected, trimmed])
    setDraft('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addCustom()
    }
  }

  const customs = selected.filter(
    v => !predefined.some(p => p.toLowerCase() === v.toLowerCase()),
  )

  return (
    <div>
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {predefined.map(value => {
          const active = selected.some(v => v.toLowerCase() === value.toLowerCase())
          return (
            <button
              key={value}
              type="button"
              onClick={() => toggle(value)}
              className={cn(
                'inline-flex h-8 items-center rounded-full border px-3 text-xs font-semibold transition-all',
                active
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
              )}
            >
              {value}
            </button>
          )
        })}
        {customs.map(value => (
          <span
            key={value}
            className="inline-flex h-8 items-center gap-1 rounded-full border border-brand-500 bg-brand-50 px-3 text-xs font-semibold text-brand-700"
          >
            {value}
            <button
              type="button"
              onClick={() => toggle(value)}
              aria-label={`Remover ${value}`}
              className="text-brand-500 hover:text-brand-700"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          maxLength={80}
        />
        <Button type="button" variant="secondary" onClick={addCustom}>
          Adicionar
        </Button>
      </div>
    </div>
  )
}

function ImageUploader({
  urls,
  onChange,
  onError,
}: {
  urls: string[]
  onChange: (next: string[]) => void
  onError: (msg: string | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploading(true)
    onError(null)
    const uploaded: string[] = []
    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('file', file)
      const result = await uploadProductImage(fd)
      if (!result.success || !result.url) {
        onError(result.error ?? 'Falha no upload de uma imagem.')
        break
      }
      uploaded.push(result.url)
    }
    if (uploaded.length > 0) onChange([...urls, ...uploaded])
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  function remove(url: string) {
    onChange(urls.filter(u => u !== url))
  }

  return (
    <div>
      <Label>Fotos</Label>
      <div
        onClick={() => inputRef.current?.click()}
        className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 hover:border-brand-400 hover:bg-brand-50/40"
      >
        <span className="font-semibold">
          {uploading ? 'Enviando...' : 'Clique para escolher imagens'}
        </span>
        <span className="text-xs">JPG, PNG, WEBP ou GIF (máx 5MB cada)</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={e => uploadFiles(e.target.files)}
        />
      </div>
      {urls.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {urls.map(url => (
            <div
              key={url}
              className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-white"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="Produto" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => remove(url)}
                aria-label="Remover imagem"
                className="absolute right-1 top-1 rounded-full bg-white/90 px-1.5 py-0.5 text-xs font-bold text-slate-700 shadow hover:bg-white"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verificar build/lint**

```
npm run lint
```

Expected: sem novos erros.

- [ ] **Step 3: Commit**

```bash
git add src/components/estoque/ProductCreateDrawer.tsx
git commit -m "feat(estoque): add ProductCreateDrawer with chip selector + image uploader"
```

---

## Task 6: Habilitar botão e wirear drawer

**Files:**
- Modify: `src/components/estoque/FilterBar.tsx:68`
- Modify: `src/app/estoque/EstoqueClient.tsx`

- [ ] **Step 1: Remover `disabled` do botão em `FilterBar.tsx:68`**

Trocar:

```tsx
<Button onClick={onAddProduct} disabled>
  + Adicionar Produto
</Button>
```

por:

```tsx
<Button onClick={onAddProduct}>
  + Adicionar Produto
</Button>
```

- [ ] **Step 2: Importar drawer em `EstoqueClient.tsx`**

Adicionar import junto aos demais (logo após o import de `ProductEditDrawer`):

```tsx
import { ProductCreateDrawer } from '@/components/estoque/ProductCreateDrawer'
```

- [ ] **Step 3: Adicionar estado `creating`**

Dentro de `EstoqueClient`, junto aos outros `useState`:

```tsx
const [creating, setCreating] = useState(false)
```

- [ ] **Step 4: Wirar handler no `FilterBar`**

Trocar:

```tsx
<FilterBar
  search={search}
  onSearchChange={setSearch}
  statusFilter={statusFilter}
  onStatusFilterChange={setStatusFilter}
  onAddProduct={() => {
    // ativado na Leva 2
  }}
/>
```

por:

```tsx
<FilterBar
  search={search}
  onSearchChange={setSearch}
  statusFilter={statusFilter}
  onStatusFilterChange={setStatusFilter}
  onAddProduct={() => setCreating(true)}
/>
```

- [ ] **Step 5: Renderizar o drawer**

Adicionar logo após o `<ProductEditDrawer ... />` no final do JSX:

```tsx
<ProductCreateDrawer
  open={creating}
  onClose={() => setCreating(false)}
/>
```

- [ ] **Step 6: Verificar build/lint**

```
npm run lint
```

Expected: sem novos erros.

- [ ] **Step 7: Commit**

```bash
git add src/components/estoque/FilterBar.tsx src/app/estoque/EstoqueClient.tsx
git commit -m "feat(estoque): wire ProductCreateDrawer to + Adicionar Produto button"
```

---

## Task 7: Verificação manual end-to-end

> Esta tarefa não tem código novo. É a checagem do fluxo real no browser. Sem isso, não dá pra afirmar que está funcionando — type-check e lint não verificam comportamento de UI nem RLS.

- [ ] **Step 1: Aplicar migration 030 no Supabase**

Abrir o SQL Editor do projeto Supabase (mesmo padrão das outras migrations). Colar e executar o conteúdo de `supabase/migrations/030_product_images_bucket.sql`.

Verificar no painel **Storage** se o bucket `product-images` aparece marcado como `public`.

- [ ] **Step 2: Subir o dev server**

```
npm run dev
```

- [ ] **Step 3: Caso de teste 1 — produto sem foto**

1. Login como dono.
2. Ir em `/estoque`.
3. Clicar `+ Adicionar Produto`.
4. Preencher Nome "Camiseta Teste", Preço "29,90", Unidades "5".
5. Salvar.

Expected: drawer fecha, produto aparece na lista, sem warning no console.

- [ ] **Step 4: Caso de teste 2 — produto com imagens**

1. Clicar `+ Adicionar Produto`.
2. Nome "Vestido Floral".
3. Subir 3 imagens JPG/PNG; thumbs aparecem.
4. Remover uma das thumbs (botão `×`); array fica com 2.
5. Selecionar chips `P`, `M`, `G` em tamanhos.
6. Selecionar `Preto`, digitar `Vinho` no input "Outra cor..." e Enter.
7. Preço "89,90", Unidades "10".
8. Salvar.

Expected: produto aparece na lista. Abrir o drawer de edição do novo produto e confirmar que `image_urls` tem 2 URLs do bucket, `tamanhos` tem `[P, M, G]`, `cores` tem `[Preto, Vinho]`.

- [ ] **Step 5: Caso de teste 3 — URL pública de imagem (n8n)**

1. Copiar uma das URLs gravadas em `image_urls`.
2. Abrir em aba anônima (deslogado).

Expected: a imagem carrega.

- [ ] **Step 6: Caso de teste 4 — não-owner**

Se há outro usuário com role `member` na mesma loja:

1. Logar como ele.
2. Tentar acessar `/estoque`.

Expected: redirect pra `/leads` (já é o comportamento de `EstoquePage`).

- [ ] **Step 7: Caso de teste 5 — validações**

1. Tentar criar com Nome vazio. Expected: erro "Nome do produto e obrigatorio."
2. Tentar criar com Preço `-1`. Expected: erro "Preco invalido."
3. Tentar subir arquivo `.txt`. Expected: erro "Formato nao suportado..."

- [ ] **Step 8: Reportar resultado**

Se tudo passar, mensagem final: "Verificação manual OK em todos os cenários." Se algo falhar, criar issue/nota e ajustar antes de fechar.

---

## Recap

Ao final dos 7 tasks:
- Helper de SKU com testes (Task 1)
- Migration de bucket commitada (Task 2)
- Server actions `uploadProductImage` e `createProduct` (Tasks 3-4)
- Drawer novo com chips + uploader (Task 5)
- Botão habilitado e wirado (Task 6)
- Verificação manual end-to-end (Task 7)
