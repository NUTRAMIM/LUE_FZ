# Estoque — limite de até 3 imagens por produto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o dono da loja adicione até 3 imagens por produto em ambos os drawers (Criar e Editar) do menu Estoque, usando o mesmo uploader de arquivos. URLs continuam persistidas em `products.image_urls` (`text[]`).

**Architecture:** Extrair o `ImageUploader` que vive aninhado em `ProductCreateDrawer.tsx` para um componente compartilhado em `src/components/estoque/ImageUploader.tsx`, com prop `maxImages` (default 3). Substituir o `<textarea>` de URLs no `ProductEditDrawer.tsx` por esse mesmo uploader. Endurecer `sanitizeUrlList` em `src/actions/products.ts` com `.slice(0, 3)` como defesa em profundidade.

**Tech Stack:** Next.js (versão local — ver `node_modules/next/dist/docs/` antes de duvidar de API), React 18 client components, Supabase JS, TypeScript.

**Spec:** `docs/superpowers/specs/2026-05-27-estoque-3-imagens-design.md`

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/components/estoque/ImageUploader.tsx` | **Criar** | Componente reutilizável: previews + dropzone + cap de N imagens. Exporta `MAX_PRODUCT_IMAGES`. |
| `src/components/estoque/ProductCreateDrawer.tsx` | **Modificar** | Remove `ImageUploader` interno; importa o novo componente. |
| `src/components/estoque/ProductEditDrawer.tsx` | **Modificar** | Troca textarea por `ImageUploader`. Adiciona state `imageUrls` + `uploading`. Bloqueia submit se > 3. |
| `src/actions/products.ts` | **Modificar** | `sanitizeUrlList` faz `.slice(0, MAX_PRODUCT_IMAGES)` no final. Importa a constante do componente. |

Sem alterações em DB, storage, sync n8n, export/import.

**Testes**: este repo não tem suíte automatizada para `/estoque`. Validação é manual no browser — passos descritos no fim do plano.

---

## Task 1: Extrair `ImageUploader` para arquivo próprio

Cria `src/components/estoque/ImageUploader.tsx` com o componente que hoje vive dentro de `ProductCreateDrawer.tsx`, agora com prop `maxImages` e a constante `MAX_PRODUCT_IMAGES`.

**Files:**
- Create: `src/components/estoque/ImageUploader.tsx`

- [ ] **Step 1.1: Criar o arquivo**

Conteúdo completo:

```tsx
// src/components/estoque/ImageUploader.tsx
'use client'

import { useRef } from 'react'
import { uploadProductImage } from '@/actions/products'
import { Label } from '@/components/ui/Input'

export const MAX_PRODUCT_IMAGES = 3

type Props = {
  urls: string[]
  onChange: React.Dispatch<React.SetStateAction<string[]>>
  onError: (msg: string | null) => void
  uploading: boolean
  onUploadingChange: (uploading: boolean) => void
  maxImages?: number
  inputId?: string
}

export function ImageUploader({
  urls,
  onChange,
  onError,
  uploading,
  onUploadingChange,
  maxImages = MAX_PRODUCT_IMAGES,
  inputId = 'product-images',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const remaining = Math.max(0, maxImages - urls.length)
  const atLimit = remaining === 0

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    onUploadingChange(true)
    onError(null)

    const selected = Array.from(files)
    const accepted = selected.slice(0, remaining)
    const dropped = selected.length - accepted.length

    const uploaded: string[] = []
    for (const file of accepted) {
      const fd = new FormData()
      fd.append('file', file)
      const result = await uploadProductImage(fd)
      if (!result.success || !result.url) {
        onError(result.error ?? 'Falha no upload de uma imagem.')
        break
      }
      uploaded.push(result.url)
    }

    if (uploaded.length > 0) onChange(prev => [...prev, ...uploaded])
    if (dropped > 0) {
      onError(
        `Limite de ${maxImages} imagens. Apenas ${uploaded.length} foram enviadas.`,
      )
    }

    onUploadingChange(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  function remove(url: string) {
    onChange(prev => prev.filter(u => u !== url))
  }

  return (
    <div>
      <Label>Fotos</Label>
      {atLimit ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-sm text-slate-500">
          Limite de {maxImages} imagens atingido. Remova uma para adicionar outra.
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 hover:border-brand-400 hover:bg-brand-50/40"
        >
          <span className="font-semibold">
            {uploading ? 'Enviando...' : 'Clique para escolher imagens'}
          </span>
          <span className="text-xs">
            JPG, PNG, WEBP ou GIF (máx 5MB cada) — até {maxImages} no total
          </span>
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={e => uploadFiles(e.target.files)}
          />
        </label>
      )}
      {urls.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {urls.map(url => (
            <div
              key={url}
              className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-white"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
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

- [ ] **Step 1.2: Verificar typecheck**

Run: `npx tsc --noEmit` (do diretório `C:\LUE FZ`)
Expected: zero erros novos. O arquivo ainda não é importado em lugar nenhum, então só valida tipos do próprio componente.

- [ ] **Step 1.3: Commit**

```bash
git add src/components/estoque/ImageUploader.tsx
git commit -m "feat(estoque): extract ImageUploader component with max-images cap"
```

---

## Task 2: Migrar `ProductCreateDrawer` para o novo componente

Substitui o `ImageUploader` aninhado (function declarada no fim do arquivo) pelo import do componente compartilhado.

**Files:**
- Modify: `src/components/estoque/ProductCreateDrawer.tsx`

- [ ] **Step 2.1: Adicionar o import**

Edite o bloco de imports no topo do arquivo. Adicione, logo após a linha que importa `cn`:

```ts
import { ImageUploader } from './ImageUploader'
```

- [ ] **Step 2.2: Remover a função `ImageUploader` local**

Apague todo o bloco que começa em `function ImageUploader({` e termina no `}` final do arquivo (linhas ~286–369 no estado atual). Também apague a linha `import { useRef, ... }` o `useRef` se ele não for mais usado em outro lugar do arquivo — confira: hoje só era usado dentro do `ImageUploader` local. O import vira:

```ts
import { useState, useTransition } from 'react'
```

(Remove o `useRef` da lista.)

- [ ] **Step 2.3: Confirmar uso do JSX**

O JSX no `handleSubmit`/render do `ProductCreateDrawer` já chama `<ImageUploader urls={imageUrls} onChange={setImageUrls} ... />`. Não muda nada lá — agora ele resolve para o componente importado.

- [ ] **Step 2.4: Verificar build de tipos**

Run: `npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 2.5: Smoke manual**

Run: `npm run dev`
Abrir `http://localhost:3000/estoque`, clicar em "Adicionar produto", abrir o uploader. Deve continuar funcionando como antes; tente enviar 4 fotos — só 3 devem entrar e aparecer uma mensagem de erro no topo do drawer informando que 3 foram enviadas (na verdade vai dizer "apenas 3 foram enviadas" — está correto porque a 4ª foi descartada).

- [ ] **Step 2.6: Commit**

```bash
git add src/components/estoque/ProductCreateDrawer.tsx
git commit -m "refactor(estoque): use shared ImageUploader in create drawer"
```

---

## Task 3: Migrar `ProductEditDrawer` — trocar textarea por uploader

Maior mudança do plano. Remove o textarea de URLs e adiciona o `ImageUploader` com state local.

**Files:**
- Modify: `src/components/estoque/ProductEditDrawer.tsx`

- [ ] **Step 3.1: Atualizar imports**

Substitua o bloco de imports no topo do arquivo por:

```tsx
'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  getProductDetails,
  saveProduct,
  type SaveProductInput,
} from '@/actions/products'
import { Button } from '@/components/ui/Button'
import { Drawer } from '@/components/ui/Drawer'
import { Input, Label } from '@/components/ui/Input'
import { ImageUploader, MAX_PRODUCT_IMAGES } from './ImageUploader'
import type { Product } from '@/types/product'
```

- [ ] **Step 3.2: Remover a helper `urlsToText`**

Apague o bloco:

```ts
function urlsToText(values: string[] | null): string {
  return (values ?? []).join('\n')
}
```

(`listToText` continua — é usada por tamanhos/cores.)

- [ ] **Step 3.3: Adicionar states de uploader**

Logo após `const [loading, setLoading] = useState(false)`, adicione:

```ts
const [imageUrls, setImageUrls] = useState<string[]>([])
const [uploading, setUploading] = useState(false)
```

- [ ] **Step 3.4: Inicializar `imageUrls` quando o produto carrega**

No `useEffect` que carrega o produto, dentro do `.then((p) => { ... })`, logo após `setProduct(p)`, adicione:

```ts
setImageUrls(p.image_urls ?? [])
```

E quando `open || productId` é falsy e reseta tudo, adicione no bloco `if (!open || !productId)`:

```ts
setImageUrls([])
setUploading(false)
```

O `useEffect` completo fica:

```tsx
useEffect(() => {
  if (!open || !productId) {
    setProduct(null)
    setError(null)
    setLoading(false)
    setImageUrls([])
    setUploading(false)
    return
  }
  let cancelled = false
  setLoading(true)
  setError(null)
  setProduct(null)
  setImageUrls([])
  getProductDetails(productId)
    .then((p) => {
      if (cancelled) return
      if (!p) {
        setError('Produto nao encontrado para esta loja.')
      } else {
        setProduct(p)
        setImageUrls(p.image_urls ?? [])
      }
      setLoading(false)
    })
    .catch((err: unknown) => {
      if (cancelled) return
      const msg = err instanceof Error ? err.message : 'Erro ao carregar produto.'
      setError(msg)
      setLoading(false)
    })
  return () => {
    cancelled = true
  }
}, [productId, open])
```

- [ ] **Step 3.5: Validar no submit e passar URLs**

Substitua o `handleSubmit` por:

```tsx
function handleSubmit(formData: FormData) {
  if (!product) return
  setError(null)

  if (imageUrls.length > MAX_PRODUCT_IMAGES) {
    setError(`Máximo de ${MAX_PRODUCT_IMAGES} imagens. Remova ${imageUrls.length - MAX_PRODUCT_IMAGES} para salvar.`)
    return
  }

  const payload: SaveProductInput = {
    id: product.id,
    sku: String(formData.get('sku') ?? ''),
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? ''),
    category: String(formData.get('category') ?? ''),
    brand: String(formData.get('brand') ?? ''),
    price: String(formData.get('price') ?? ''),
    compare_at_price: String(formData.get('compare_at_price') ?? ''),
    stock_quantity: String(formData.get('stock_quantity') ?? ''),
    stock_min: String(formData.get('stock_min') ?? ''),
    tamanhos: String(formData.get('tamanhos') ?? ''),
    cores: String(formData.get('cores') ?? ''),
    image_urls: imageUrls.join('\n'),
  }

  startTransition(async () => {
    const result = await saveProduct(payload)
    if (!result.success) {
      setError(result.error ?? 'Nao foi possivel salvar o produto.')
      return
    }
    router.refresh()
    handleClose()
  })
}
```

- [ ] **Step 3.6: Trocar o textarea pelo `ImageUploader`**

Localize o bloco do textarea:

```tsx
<div>
  <Label htmlFor="image_urls">URLs das imagens</Label>
  <textarea
    id="image_urls"
    name="image_urls"
    defaultValue={urlsToText(product.image_urls)}
    rows={4}
    placeholder="https://..."
    className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 transition-all duration-150 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100"
  />
</div>
```

E substitua por:

```tsx
<ImageUploader
  urls={imageUrls}
  onChange={setImageUrls}
  onError={setError}
  uploading={uploading}
  onUploadingChange={setUploading}
  inputId="ep-images"
/>

{imageUrls.length > MAX_PRODUCT_IMAGES && (
  <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
    Este produto tem {imageUrls.length} imagens. O limite agora é {MAX_PRODUCT_IMAGES} —
    remova as extras antes de salvar.
  </div>
)}
```

- [ ] **Step 3.7: Desabilitar botões durante upload**

Localize os botões no rodapé:

```tsx
<Button type="button" variant="secondary" onClick={handleClose} disabled={isPending}>
  Cancelar
</Button>
<Button type="submit" disabled={isPending}>
  {isPending ? 'Salvando...' : 'Salvar produto'}
</Button>
```

Substitua por:

```tsx
<Button type="button" variant="secondary" onClick={handleClose} disabled={isPending || uploading}>
  Cancelar
</Button>
<Button type="submit" disabled={isPending || uploading}>
  {isPending ? 'Salvando...' : 'Salvar produto'}
</Button>
```

- [ ] **Step 3.8: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: zero erros.

- [ ] **Step 3.9: Smoke manual**

Run: `npm run dev`
Abrir `/estoque`, clicar em um produto existente para editar. Verificar:
- Se o produto tem 0 imagens → uploader vazio, dropzone visível.
- Se tem 1–2 imagens → previews aparecem, dropzone visível.
- Se tem 3 imagens → previews + mensagem "Limite de 3 imagens atingido".
- Remover uma imagem → dropzone reaparece.
- Adicionar 1 nova → preview aparece imediatamente.
- Clicar em "Salvar produto" → fecha drawer, página atualiza.
- Reabrir o mesmo produto → as imagens salvas estão lá.

- [ ] **Step 3.10: Commit**

```bash
git add src/components/estoque/ProductEditDrawer.tsx
git commit -m "feat(estoque): use ImageUploader in edit drawer (max 3 images)"
```

---

## Task 4: Endurecer `sanitizeUrlList` com cap

Defesa em profundidade: mesmo que a UI falhe ou um cliente malicioso envie payload manipulado, o servidor nunca grava mais que `MAX_PRODUCT_IMAGES` URLs.

**Files:**
- Modify: `src/actions/products.ts`

- [ ] **Step 4.1: Importar a constante**

No bloco de imports no topo do arquivo, adicione:

```ts
import { MAX_PRODUCT_IMAGES } from '@/components/estoque/ImageUploader'
```

Nota: importar componente client num server action é seguro aqui porque só estamos importando uma constante exportada. O bundler (Next.js) trata constantes top-level como tree-shakable. Se isso causar warning de "client/server boundary", mova a constante para um arquivo neutro:

- Plano B: criar `src/lib/inventory/constants.ts` com `export const MAX_PRODUCT_IMAGES = 3` e importar dos dois lugares.

Se não houver warning, plano A está ok.

- [ ] **Step 4.2: Aplicar slice no `sanitizeUrlList`**

Localize:

```ts
function sanitizeUrlList(input: string): string[] {
  return sanitizeStringList(input, MAX_URL).filter(url => {
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:'
    } catch {
      return false
    }
  })
}
```

Substitua por:

```ts
function sanitizeUrlList(input: string): string[] {
  return sanitizeStringList(input, MAX_URL)
    .filter(url => {
      try {
        const parsed = new URL(url)
        return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      } catch {
        return false
      }
    })
    .slice(0, MAX_PRODUCT_IMAGES)
}
```

- [ ] **Step 4.3: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: zero erros. Se aparecer aviso sobre client component importado em server action, executar o plano B do Step 4.1.

- [ ] **Step 4.4: Smoke server-side**

Run: `npm run dev` (se não estiver rodando)
Abrir `/estoque`, editar um produto, tentar manipular via DevTools (adicionar 5 URLs no array `imageUrls` antes de submeter — pode ser via React DevTools ou ignorando esta etapa se sem ferramenta). Mesmo passando >3, o produto persistido deve ter no máximo 3 (confirmar reabrindo o drawer).

Esta etapa é opcional — o caminho normal pela UI já bloqueia.

- [ ] **Step 4.5: Commit**

```bash
git add src/actions/products.ts
git commit -m "feat(estoque): cap product image URLs at MAX_PRODUCT_IMAGES on server"
```

---

## Task 5: Validação final manual completa

Roteiro end-to-end no browser para sanity check antes de considerar pronto.

- [ ] **Step 5.1: Subir dev server**

Run: `npm run dev`

- [ ] **Step 5.2: Criar produto novo, tentar 5 fotos**

1. Em `/estoque`, clique "Adicionar produto".
2. Preencha nome, preço, unidades.
3. No uploader, selecione 5 imagens de uma vez no diálogo do SO.
4. **Esperado**: 3 sobem, aparece erro: "Limite de 3 imagens. Apenas 3 foram enviadas." Dropzone some.
5. Clique "Criar produto". Drawer fecha, card aparece no grid.

- [ ] **Step 5.3: Criar produto novo, fluxo incremental**

1. Novo produto. Suba 1 imagem, depois mais 1, depois mais 1.
2. **Esperado**: na 3ª, dropzone some e mostra mensagem de limite.
3. Remova uma → dropzone volta.
4. Salve.

- [ ] **Step 5.4: Editar produto existente**

1. Clique num card do produto criado no 5.2 → drawer de Editar abre.
2. **Esperado**: 3 previews visíveis, dropzone escondida, mensagem de limite.
3. Remova 1 imagem. Adicione 1 nova. Salve.
4. Reabra o mesmo produto → confirme que a nova substituiu corretamente.

- [ ] **Step 5.5: Produto sem imagens**

1. Edite um produto que não tem imagens.
2. **Esperado**: uploader vazio, dropzone visível.
3. Suba 2 imagens, salve.
4. Reabra → 2 imagens lá.

- [ ] **Step 5.6: Cancelar não persiste**

1. Edite um produto com 2 imagens. Adicione 1 (ficam 3). Clique "Cancelar".
2. Reabra → ainda tem 2 imagens (mudança descartada).

Nota: o upload em si já gravou o arquivo no Storage mesmo cancelando — isso é comportamento atual e fora do escopo. Documentado para clareza.

- [ ] **Step 5.7: Build de produção**

Run: `npm run build`
Expected: build passa sem erros novos.

- [ ] **Step 5.8: Commit final (se houver)**

Nesse ponto, sem mudanças pendentes. Se algum ajuste apareceu na validação, fazer commit incremental.

---

## Self-Review (já feito pelo autor)

**Spec coverage:**
- ✅ Extração do `ImageUploader` → Task 1
- ✅ Cap de 3 no componente → Task 1 (lógica `remaining` + `atLimit`)
- ✅ Mensagem de erro com número real → Task 1 Step 1.1
- ✅ Reutilização no Create → Task 2
- ✅ Substituição do textarea no Edit → Task 3
- ✅ State `imageUrls` + `uploading` no Edit → Task 3 Steps 3.3, 3.4
- ✅ Banner para legado >3 → Task 3 Step 3.6
- ✅ Bloqueio de submit se >3 → Task 3 Step 3.5
- ✅ Desabilitar botões durante upload no Edit → Task 3 Step 3.7
- ✅ `sanitizeUrlList` com `.slice(0, 3)` → Task 4
- ✅ Pontos não tocados (sync, export, details, row) — confirmados, sem tasks

**Placeholder scan:** sem TBD/TODO. Toda mudança tem código completo. Step 4.4 é opcional e está explicitado como tal.

**Type consistency:** `MAX_PRODUCT_IMAGES` exportado de `./ImageUploader` e importado pelos consumidores com o mesmo nome. Props do `ImageUploader` (`urls`, `onChange`, `onError`, `uploading`, `onUploadingChange`, `maxImages`, `inputId`) consistentes entre Create e Edit.
