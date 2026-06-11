# Vídeo de produto no chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que a IA envie um vídeo do produto como último slide do carrossel no chat, nos dois tools do agente (`LISTAR_CATEGORIA` e `BUSCAR_PRODUTOS`), com upload manual no cadastro e mapeamento do campo `"video"` do JSON FacilZap.

**Architecture:** Coluna `video_url` em `products` (+ no metadata do RAG via trigger). O card do agente passa a anexar a URL do vídeo após as imagens (última mídia → último slide). O front detecta URLs de vídeo e renderiza um `<video>` autoplay-mudo dentro de um carrossel de mídia generalizado. Upload de vídeo vai pra um bucket Supabase novo (`product-videos`, 20 MB).

**Tech Stack:** Next.js 16 (React 19, server actions), Supabase (Postgres + Storage), Python chat-service (asyncpg), Vitest (front), Pytest (chat-service).

**Spec:** `docs/superpowers/specs/2026-06-11-video-produtos-chat-design.md`

---

## File Structure

- **Migrations (criar):**
  - `supabase/migrations/037_products_video_url.sql` — coluna `video_url`.
  - `supabase/migrations/038_product_videos_bucket.sql` — bucket + policies.
  - `supabase/migrations/039_documents_video_url.sql` — trigger/backfill do metadata.
- **Front — tipos/dados:**
  - `src/types/database.ts` — `video_url` em `products`.
  - `src/lib/inventory/sync.ts` — mapear `video` → `video_url` (exportar `mapProduct`).
  - `src/lib/__tests__/inventory-sync.test.ts` — teste do mapeamento.
- **Front — actions/UI:**
  - `src/actions/products.ts` — `uploadProductVideo`, `video_url` em create/save.
  - `src/components/estoque/VideoUploader.tsx` (criar).
  - `src/components/estoque/ProductCreateDrawer.tsx` / `ProductEditDrawer.tsx` — plugar uploader.
- **Front — chat render:**
  - `src/app/chat/[slug]/components/message-segments.ts` — detecção/agrupamento de mídia.
  - `src/app/chat/[slug]/components/__tests__/message-segments.test.ts` — testes.
  - `src/app/chat/[slug]/components/MediaCarousel.tsx` (criar; substitui `ImageCarousel.tsx`).
  - `src/app/chat/[slug]/components/MessageBubble.tsx` — usar `MediaCarousel`/grupo de mídia.
- **chat-service:**
  - `chat-service/app/agent/tools.py` — `_build_card` + refactor `buscar_produtos`.
  - `chat-service/app/agent/runner.py` — roteamento do `BUSCAR_PRODUTOS`.
  - `chat-service/app/db.py` — `video_url` no SELECT de categoria.
  - `chat-service/tests/test_tools.py` / `test_runner.py` — testes.

**Comandos de teste:**
- Front: `npm test` (Vitest). Arquivo único: `npx vitest run src/caminho/arquivo.test.ts`.
- chat-service: `cd chat-service && pytest tests/arquivo.py -v`.

**Migrations:** aplicar pelo processo padrão do projeto (Supabase local/staging), **não** direto em produção. Cada task de migration tem um passo de verificação manual.

---

## Task 1: Migration — coluna `products.video_url` + tipos

**Files:**
- Create: `supabase/migrations/037_products_video_url.sql`
- Modify: `src/types/database.ts` (bloco `products`, ~linhas 12-76)

- [ ] **Step 1: Criar a migration**

`supabase/migrations/037_products_video_url.sql`:
```sql
-- 037_products_video_url.sql
-- URL única de vídeo por produto. Aparece como último slide do carrossel no chat.
ALTER TABLE products ADD COLUMN IF NOT EXISTS video_url text;
```

- [ ] **Step 2: Adicionar `video_url` aos tipos**

Em `src/types/database.ts`, no bloco `products`, adicionar a linha após `image_urls` em **Row**, **Insert** e **Update**:

Row (após `image_urls: string[] | null`):
```ts
          video_url: string | null
```
Insert (após `image_urls?: string[] | null`):
```ts
          video_url?: string | null
```
Update (após `image_urls?: string[] | null`):
```ts
          video_url?: string | null
```

- [ ] **Step 3: Verificar typecheck do front**

Run: `npx tsc --noEmit`
Expected: sem novos erros relacionados a `video_url`.

- [ ] **Step 4: Aplicar e verificar a migration (dev/staging)**

Aplicar a migration pelo processo do projeto. Verificar:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'products' AND column_name = 'video_url';
```
Expected: 1 linha.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/037_products_video_url.sql src/types/database.ts
git commit -m "feat(db): coluna video_url em products"
```

---

## Task 2: Migration — bucket `product-videos`

**Files:**
- Create: `supabase/migrations/038_product_videos_bucket.sql`

- [ ] **Step 1: Criar a migration (espelha a 030)**

`supabase/migrations/038_product_videos_bucket.sql`:
```sql
-- 038_product_videos_bucket.sql
-- Bucket publico para videos de produtos. Leitura publica (front consome por
-- URL direta). Escrita/update/delete restritos ao dono via primeiro segmento
-- do path (<user_id>/<uuid>.ext). Limite 20 MB.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-videos',
  'product-videos',
  true,
  20971520,
  ARRAY['video/mp4','video/webm','video/quicktime']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "product_videos_select_public" ON storage.objects;
DROP POLICY IF EXISTS "product_videos_insert_own"    ON storage.objects;
DROP POLICY IF EXISTS "product_videos_update_own"    ON storage.objects;
DROP POLICY IF EXISTS "product_videos_delete_own"    ON storage.objects;

CREATE POLICY "product_videos_select_public" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'product-videos');

CREATE POLICY "product_videos_insert_own" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'product-videos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "product_videos_update_own" ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'product-videos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "product_videos_delete_own" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'product-videos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
```

- [ ] **Step 2: Aplicar e verificar (dev/staging)**

```sql
SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'product-videos';
```
Expected: 1 linha, `public = true`, `file_size_limit = 20971520`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/038_product_videos_bucket.sql
git commit -m "feat(storage): bucket product-videos (20MB)"
```

---

## Task 3: Migration — `video_url` no metadata dos documentos (RAG)

**Files:**
- Create: `supabase/migrations/039_documents_video_url.sql`

- [ ] **Step 1: Criar a migration (estende a 034)**

`supabase/migrations/039_documents_video_url.sql`:
```sql
-- 039_documents_video_url.sql
-- Estende a logica da 034: alem de image_urls, copia tambem video_url do
-- produto casado (por lower(name)+user_id) para o metadata do documento, para
-- que o BUSCAR_PRODUTOS consiga enviar o video no carrossel.
-- Idempotente: seguro re-rodar.

CREATE OR REPLACE FUNCTION documents_attach_image_urls()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  imgs jsonb;
  vid  text;
BEGIN
  IF NEW.metadata ? 'name' AND NEW.metadata ? 'user_id' THEN
    SELECT to_jsonb(p.image_urls), p.video_url
      INTO imgs, vid
      FROM products p
     WHERE lower(p.name) = lower(NEW.metadata->>'name')
       AND p.user_id::text = NEW.metadata->>'user_id'
     LIMIT 1;

    IF imgs IS NOT NULL THEN
      NEW.metadata := NEW.metadata || jsonb_build_object('image_urls', imgs);
    END IF;
    IF vid IS NOT NULL THEN
      NEW.metadata := NEW.metadata || jsonb_build_object('video_url', to_jsonb(vid));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger ja existe (trg_documents_attach_image_urls); CREATE OR REPLACE acima
-- atualiza a funcao in-place. Backfill do video_url nos documentos existentes:
UPDATE documents d
   SET metadata = d.metadata || jsonb_build_object('video_url', to_jsonb(p.video_url))
  FROM products p
 WHERE lower(p.name) = lower(d.metadata->>'name')
   AND p.user_id::text = d.metadata->>'user_id'
   AND p.video_url IS NOT NULL;
```

- [ ] **Step 2: Aplicar e verificar (dev/staging)**

Verificar que a função foi atualizada:
```sql
SELECT pg_get_functiondef('documents_attach_image_urls'::regproc) LIKE '%video_url%';
```
Expected: `t` (true).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/039_documents_video_url.sql
git commit -m "feat(rag): anexa video_url ao metadata dos documentos"
```

---

## Task 4: Import JSON — mapear `video` → `video_url`

**Files:**
- Modify: `src/lib/inventory/sync.ts` (interface `FacilZapProduct` ~21-33; `mapProduct` ~216-257)
- Test: `src/lib/__tests__/inventory-sync.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao fim de `src/lib/__tests__/inventory-sync.test.ts`:
```ts
import { mapProduct } from '../inventory/sync'

function baseProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: '123',
    nome: 'Camiseta',
    descricao: null,
    categorias: [],
    link: null,
    preco: 50,
    preco_promocional: null,
    imagens: ['http://x/a.jpg'],
    controlar_estoque: false,
    estoque: 5,
    variacoes: null,
    ...overrides,
  }
}

describe('mapProduct - video', () => {
  it('mapeia o campo video para video_url', () => {
    const mapped = mapProduct(
      baseProduct({ video: 'http://x/v.mp4' }) as never,
      'user-1',
    )
    expect(mapped.video_url).toBe('http://x/v.mp4')
  })

  it('usa null quando não há video', () => {
    const mapped = mapProduct(baseProduct() as never, 'user-1')
    expect(mapped.video_url).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/__tests__/inventory-sync.test.ts`
Expected: FAIL — `mapProduct` não é exportado / `video_url` undefined.

- [ ] **Step 3: Exportar `mapProduct` e mapear o campo**

Em `src/lib/inventory/sync.ts`:

3a. Na interface `FacilZapProduct`, adicionar após `imagens: string[]`:
```ts
  video: string | null
```

3b. Trocar `function mapProduct(` por `export function mapProduct(`.

3c. No objeto retornado por `mapProduct`, adicionar após a linha `image_urls: ...`:
```ts
    video_url: p.video ?? null,
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/__tests__/inventory-sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inventory/sync.ts src/lib/__tests__/inventory-sync.test.ts
git commit -m "feat(import): mapeia campo video do JSON para video_url"
```

---

## Task 5: Action `uploadProductVideo` + `video_url` em create/save

**Files:**
- Modify: `src/actions/products.ts`

- [ ] **Step 1: Adicionar constantes e a action de upload**

Em `src/actions/products.ts`, após o bloco de upload de imagem (depois de `uploadProductImage`, ~linha 265), adicionar:
```ts
const MAX_VIDEO_BYTES = 20 * 1024 * 1024
const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
])
const VIDEO_EXT_BY_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

export interface UploadProductVideoResult {
  success: boolean
  url?: string
  error?: string
}

export async function uploadProductVideo(
  formData: FormData,
): Promise<UploadProductVideoResult> {
  const supabase = await createClient()

  const user = await getAuthedUser()
  if (!user) {
    return { success: false, error: 'Nao autorizado. Faca login novamente.' }
  }
  if ((await getStoreRole()) !== 'owner') {
    return { success: false, error: 'Apenas o dono da loja pode subir videos.' }
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return { success: false, error: 'Arquivo invalido.' }
  }
  if (!ALLOWED_VIDEO_MIMES.has(file.type)) {
    return { success: false, error: 'Formato nao suportado. Use MP4, WEBM ou MOV.' }
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return { success: false, error: 'Video maior que 20MB.' }
  }

  const ext = VIDEO_EXT_BY_MIME[file.type]
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('product-videos')
    .upload(path, file, { contentType: file.type, upsert: false })

  if (uploadError) {
    console.error('uploadProductVideo error:', uploadError)
    return { success: false, error: 'Erro ao subir video. Tente novamente.' }
  }

  const { data } = supabase.storage.from('product-videos').getPublicUrl(path)
  if (!data?.publicUrl) {
    return { success: false, error: 'Erro ao gerar URL publica.' }
  }
  return { success: true, url: data.publicUrl }
}
```

- [ ] **Step 2: Adicionar helper de sanitização de 1 URL**

Após a função `sanitizeUrlList` (~linha 86), adicionar:
```ts
function sanitizeOptionalUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim().slice(0, MAX_URL)
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return trimmed
  } catch {
    return null
  }
}
```

- [ ] **Step 3: `video_url` em `SaveProductInput` + persistência em `saveProduct`**

3a. Em `SaveProductInput`, adicionar após `image_urls: string`:
```ts
  video_url: string
```
3b. Em `saveProduct`, após `const imageUrls = sanitizeUrlList(data.image_urls)`:
```ts
  const videoUrl = sanitizeOptionalUrl(data.video_url)
```
3c. No `.update({ ... })`, após `image_urls: imageUrls.length ? imageUrls : null,`:
```ts
      video_url: videoUrl,
```

- [ ] **Step 4: `video_url` em `CreateProductInput` + persistência em `createProduct`**

4a. Em `CreateProductInput`, adicionar após `image_urls: string[]`:
```ts
  video_url: string
```
4b. Em `createProduct`, após o bloco que monta `imageUrls`:
```ts
  const videoUrl = sanitizeOptionalUrl(data.video_url)
```
4c. No `.insert({ ... })`, após `image_urls: imageUrls.length ? imageUrls : null,`:
```ts
        video_url: videoUrl,
```

- [ ] **Step 5: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: erros apenas nos drawers que ainda não enviam `video_url` (corrigidos na Task 7). Se quiser isolar, rode após a Task 7. Nenhum erro dentro de `products.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/actions/products.ts
git commit -m "feat(actions): uploadProductVideo e video_url em create/save"
```

---

## Task 6: Componente `VideoUploader`

**Files:**
- Create: `src/components/estoque/VideoUploader.tsx`

- [ ] **Step 1: Criar o componente (1 vídeo único)**

`src/components/estoque/VideoUploader.tsx`:
```tsx
'use client'

import { useRef } from 'react'
import { uploadProductVideo } from '@/actions/products'
import { Label } from '@/components/ui/Input'

type Props = {
  url: string | null
  onChange: (url: string | null) => void
  onError: (msg: string | null) => void
  uploading: boolean
  onUploadingChange: (uploading: boolean) => void
  inputId?: string
}

export function VideoUploader({
  url,
  onChange,
  onError,
  uploading,
  onUploadingChange,
  inputId = 'product-video',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  async function uploadFile(files: FileList | null) {
    if (!files || files.length === 0) return
    onUploadingChange(true)
    onError(null)

    const fd = new FormData()
    fd.append('file', files[0])
    const result = await uploadProductVideo(fd)
    if (!result.success || !result.url) {
      onError(result.error ?? 'Falha no upload do video.')
    } else {
      onChange(result.url)
    }

    onUploadingChange(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div>
      <Label>Video</Label>
      {url ? (
        <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-black">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video src={url} controls className="max-h-60 w-full object-contain" />
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={uploading}
            aria-label="Remover video"
            className="absolute right-1 top-1 rounded-full bg-white/90 px-1.5 py-0.5 text-xs font-bold text-slate-700 shadow hover:bg-white disabled:opacity-50"
          >
            ×
          </button>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 hover:border-brand-400 hover:bg-brand-50/40"
        >
          <span className="font-semibold">
            {uploading ? 'Enviando...' : 'Clique para escolher um video'}
          </span>
          <span className="text-xs">MP4, WEBM ou MOV (máx 20MB)</span>
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            disabled={uploading}
            className="sr-only"
            onChange={e => uploadFile(e.target.files)}
          />
        </label>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verificar typecheck**

Run: `npx tsc --noEmit`
Expected: sem erros em `VideoUploader.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/estoque/VideoUploader.tsx
git commit -m "feat(estoque): componente VideoUploader (1 video)"
```

---

## Task 7: Plugar `VideoUploader` nos drawers de criar/editar

**Files:**
- Modify: `src/components/estoque/ProductCreateDrawer.tsx`
- Modify: `src/components/estoque/ProductEditDrawer.tsx`

- [ ] **Step 1: ProductCreateDrawer — estado + uploader + payload**

1a. Import (após `import { ImageUploader }`):
```tsx
import { VideoUploader } from './VideoUploader'
```
1b. Estado (após `const [imageUrls, setImageUrls] = useState<string[]>([])`):
```tsx
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
```
1c. Em `resetForm`, após `setImageUrls([])`:
```tsx
    setVideoUrl(null)
```
1d. No `payload` (objeto `CreateProductInput`), após `image_urls: imageUrls,`:
```tsx
      video_url: videoUrl ?? '',
```
1e. Renderizar o uploader logo após o `<ImageUploader ... inputId="cp-images" />`:
```tsx
        <VideoUploader
          url={videoUrl}
          onChange={setVideoUrl}
          onError={setError}
          uploading={uploading}
          onUploadingChange={setUploading}
          inputId="cp-video"
        />
```

- [ ] **Step 2: ProductEditDrawer — estado + carregamento + uploader + payload**

2a. Import (após `import { ImageUploader, MAX_PRODUCT_IMAGES }`):
```tsx
import { VideoUploader } from './VideoUploader'
```
2b. Estado (após `const [imageUrls, setImageUrls] = useState<string[]>([])`):
```tsx
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
```
2c. No `useEffect`, no ramo de reset (quando `!open || !productId`), após `setImageUrls([])`:
```tsx
      setVideoUrl(null)
```
2d. No mesmo `useEffect`, antes do `getProductDetails(...)`, junto de `setImageUrls([])`:
```tsx
    setVideoUrl(null)
```
2e. No `.then((p) => {...})`, no ramo de sucesso, após `setImageUrls(p.image_urls ?? [])`:
```tsx
          setVideoUrl(p.video_url ?? null)
```
2f. No `payload` (`SaveProductInput`), após `image_urls: imageUrls.join('\n'),`:
```tsx
      video_url: videoUrl ?? '',
```
2g. Renderizar o uploader dentro do bloco que envolve o `<ImageUploader ... inputId="ep-images" />` (logo após o `</div>` de aviso de limite de imagens, ainda dentro do `<div className="space-y-3">`):
```tsx
            <VideoUploader
              url={videoUrl}
              onChange={setVideoUrl}
              onError={setError}
              uploading={uploading}
              onUploadingChange={setUploading}
              inputId="ep-video"
            />
```

- [ ] **Step 3: Verificar o tipo `Product` tem `video_url`**

`ProductEditDrawer` usa `p.video_url`. Confirmar que `src/types/product.ts` deriva de `Database['public']['Tables']['products']['Row']` (que já ganhou `video_url` na Task 1). Se `Product` for um tipo manual, adicionar `video_url: string | null`.

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Smoke test no browser**

Run: `npm run dev`. Abrir `/estoque`, criar um produto com vídeo (upload .mp4 ≤20MB) e editar outro adicionando vídeo. Confirmar preview e persistência (reabrir o drawer mostra o vídeo).

- [ ] **Step 5: Commit**

```bash
git add src/components/estoque/ProductCreateDrawer.tsx src/components/estoque/ProductEditDrawer.tsx
git commit -m "feat(estoque): vídeo no cadastro manual (criar/editar)"
```

---

## Task 8: chat-service — `_build_card` com vídeo + `LISTAR_CATEGORIA`

**Files:**
- Modify: `chat-service/app/agent/tools.py` (`_build_card` ~37-51)
- Modify: `chat-service/app/db.py` (`get_products_by_category` ~85-92)
- Test: `chat-service/tests/test_tools.py`

- [ ] **Step 1: Escrever o teste que falha**

Em `chat-service/tests/test_tools.py`, atualizar o helper `_prod` para aceitar `video_url` (adicionar parâmetro com default None e incluí-lo no dict):
```python
def _prod(pid, name, category, price=89.9, tamanhos=None, cores=None,
          image_urls=None, is_available=True, video_url=None):
    return {"id": pid, "name": name, "category": category, "price": price,
            "brand": None, "tamanhos": tamanhos if tamanhos is not None else ["P", "M"],
            "cores": cores if cores is not None else ["preto", "branco"],
            "image_urls": image_urls if image_urls is not None else [f"http://img/{pid}.jpg"],
            "video_url": video_url,
            "is_available": is_available}
```
E adicionar o teste:
```python
async def test_listar_categoria_card_appends_video_after_images(db):
    db.category_products = [_prod("p1", "Com Video", "Tops",
                                  image_urls=["http://img/p1-a.jpg", "http://img/p1-b.jpg"],
                                  video_url="http://vid/p1.mp4")]
    segmento, _, _ = await listar_categoria(db, "store-1", "Tops")
    assert segmento == (
        "[produto]\n"
        "Com Video\n"
        "http://img/p1-a.jpg\n"
        "http://img/p1-b.jpg\n"
        "http://vid/p1.mp4\n"
        "R$ 89,90\n"
        "Tamanhos: P, M\n"
        "Cores: preto, branco\n"
        "[/produto]"
    )
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd chat-service && pytest tests/test_tools.py::test_listar_categoria_card_appends_video_after_images -v`
Expected: FAIL — o vídeo não aparece no card.

- [ ] **Step 3: Anexar `video_url` no `_build_card`**

Em `chat-service/app/agent/tools.py`, dentro de `_build_card`, após `lines.extend(urls)`:
```python
    video = p.get("video_url")
    if video:
        lines.append(video)
```

- [ ] **Step 4: Incluir `video_url` no SELECT de categoria**

Em `chat-service/app/db.py`, `get_products_by_category`, trocar a linha do SELECT por:
```python
            """SELECT id::text, name, price, brand, tamanhos, cores, image_urls,
                      video_url
               FROM products
               WHERE user_id = $1 AND lower(category) = lower($2)
                 AND is_available = true
               ORDER BY name""", store_id, category)
```

- [ ] **Step 5: Rodar a suíte de tools**

Run: `cd chat-service && pytest tests/test_tools.py -v`
Expected: PASS (incluindo os testes existentes de `listar_categoria`, que usam `_prod` agora com `video_url=None` → sem linha de vídeo).

- [ ] **Step 6: Commit**

```bash
git add chat-service/app/agent/tools.py chat-service/app/db.py chat-service/tests/test_tools.py
git commit -m "feat(chat): video como ultima midia do card (LISTAR_CATEGORIA)"
```

---

## Task 9: chat-service — `BUSCAR_PRODUTOS` emite cards com vídeo

**Files:**
- Modify: `chat-service/app/agent/tools.py` (`buscar_produtos` ~6-30)
- Modify: `chat-service/app/agent/runner.py` (loop de tool calls ~126-149)
- Test: `chat-service/tests/test_tools.py`, `chat-service/tests/test_runner.py`

- [ ] **Step 1: Reescrever os testes de `buscar_produtos` (novo contrato)**

Em `chat-service/tests/test_tools.py`, substituir os três testes existentes de `buscar_produtos`
(`test_buscar_produtos_includes_all_colors`, `test_category_fallback_when_filtered_empty`,
`test_empty_result_returns_empty_list`) por:
```python
def _doc(name, category, cores, image_urls=None, video_url=None):
    md = {"name": name, "category": category, "price": 99.9,
          "tamanhos": ["P", "M"], "cores": cores, "brand": None,
          "image_url": f"http://x/{name}"}
    if image_urls is not None:
        md["image_urls"] = image_urls
    if video_url is not None:
        md["video_url"] = video_url
    return {"content": name, "similarity": 0.5, "metadata": md}


async def test_buscar_produtos_builds_cards_with_video_last(db, llm):
    db.match_results = [_doc("Top Alça", "top", ["rosa", "azul"],
                             image_urls=["http://img/a.jpg", "http://img/b.jpg"],
                             video_url="http://vid/a.mp4")]
    segmento, ids, resumo = await buscar_produtos(db, llm, "store-1", "top floral", "top")
    assert ids == []
    assert segmento == (
        "[produto]\n"
        "Top Alça\n"
        "http://img/a.jpg\n"
        "http://img/b.jpg\n"
        "http://vid/a.mp4\n"
        "R$ 99,90\n"
        "Tamanhos: P, M\n"
        "Cores: rosa, azul\n"
        "[/produto]"
    )
    assert "Mostrei 1" in resumo
    assert llm.embed_calls == ["top floral"]


async def test_buscar_produtos_falls_back_to_single_image_url(db, llm):
    # quando o metadata não tem image_urls (plural), usa image_url (singular)
    db.match_results = [_doc("Vestido", "vestido", ["azul"])]
    segmento, _, _ = await buscar_produtos(db, llm, "store-1", "algo", "vestido")
    assert "http://x/Vestido" in segmento


async def test_buscar_produtos_category_fallback_when_filtered_empty(db, llm):
    db.match_results = [_doc("Vestido Longo", "vestido", ["azul"])]
    segmento, _, _ = await buscar_produtos(db, llm, "store-1", "algo", "top")
    assert "Vestido Longo" in segmento


async def test_buscar_produtos_empty_returns_empty_segment(db, llm):
    db.match_results = []
    segmento, ids, resumo = await buscar_produtos(db, llm, "store-1", "x", "")
    assert segmento == ""
    assert ids == []
    assert resumo
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd chat-service && pytest tests/test_tools.py -k buscar_produtos -v`
Expected: FAIL — `buscar_produtos` ainda retorna JSON (string), não a tupla.

- [ ] **Step 3: Refatorar `buscar_produtos` para emitir cards**

Em `chat-service/app/agent/tools.py`, substituir a função `buscar_produtos` inteira por:
```python
async def buscar_produtos(db, llm, store_id: str, consulta: str, category: str):
    embedding = await llm.embed(settings.embed_model, consulta)
    cat = (category or "").strip()

    rows = await db.match_documents(
        embedding=embedding, match_count=settings.match_count,
        user_id=store_id, category=cat or None)
    if not rows and cat:
        rows = await db.match_documents(
            embedding=embedding, match_count=settings.match_count,
            user_id=store_id, category=None)

    if not rows:
        return ("", [], "Não encontrei peças para esse pedido. Peça ao cliente "
                "mais detalhes (cor, tamanho ou ocasião) numa frase curta.")

    cards = []
    for r in rows:
        m = r.get("metadata", {}) or {}
        imgs = m.get("image_urls")
        if not imgs:
            single = m.get("image_url")
            imgs = [single] if single else []
        cards.append(_build_card({
            "name": m.get("name"),
            "price": m.get("price"),
            "tamanhos": m.get("tamanhos") or [],
            "cores": m.get("cores") or [],
            "image_urls": imgs,
            "video_url": m.get("video_url"),
        }))

    resumo = (f"Mostrei {len(rows)} peças ao cliente. Escreva só uma frase curta "
              "de fecho perguntando se quer ver tamanho ou cor de alguma.")
    return ("\n".join(cards), [], resumo)
```
Nota: `json` continua importado/usado por outras funções do módulo — não remover o import.

- [ ] **Step 4: Atualizar o `runner.py` para tratar o novo retorno**

Em `chat-service/app/agent/runner.py`, no loop `for call in tool_calls:`, trocar o ramo `else` que chamava `buscar_produtos` por um `elif` explícito (mantendo o roteamento dos outros tools):
```python
            elif call["name"] == TOOL_NAME:
                segmento, ids, resumo = await buscar_produtos(
                    db, llm, store.id, args.get("consulta", ""), args.get("category", ""))
                if segmento:
                    product_segments.append(segmento)
                    shown_product_ids.extend(ids)
                log.info("BUSCAR_PRODUTOS(consulta=%r, category=%r) -> %d cards",
                         args.get("consulta", ""), args.get("category", ""),
                         segmento.count("[produto]") if segmento else 0)
                content = resumo
            else:
                content = ""
```

- [ ] **Step 5: Rodar tools + runner**

Run: `cd chat-service && pytest tests/test_tools.py tests/test_runner.py -v`
Expected: PASS. (Os testes `test_executes_tool_then_returns_text` e `test_replayed_tool_calls_use_openai_shape` continuam válidos: o LLM ainda recebe a mensagem `tool` com o `resumo` e devolve o texto final.)

- [ ] **Step 6: Rodar a suíte completa do chat-service**

Run: `cd chat-service && pytest -v`
Expected: PASS (conferir `test_pipeline.py` — os `product_segments` viram mensagens separadas; nada quebra).

- [ ] **Step 7: Commit**

```bash
git add chat-service/app/agent/tools.py chat-service/app/agent/runner.py chat-service/tests/test_tools.py chat-service/tests/test_runner.py
git commit -m "feat(chat): BUSCAR_PRODUTOS emite cards com carrossel+video"
```

---

## Task 10: Front — detecção e agrupamento de vídeo em `message-segments`

**Files:**
- Modify: `src/app/chat/[slug]/components/message-segments.ts`
- Test: `src/app/chat/[slug]/components/__tests__/message-segments.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Substituir o conteúdo de `src/app/chat/[slug]/components/__tests__/message-segments.test.ts` por:
```ts
import { describe, it, expect } from 'vitest'
import { parseSegments, groupConsecutiveMedia } from '../message-segments'

describe('parseSegments', () => {
  it('retorna texto único quando não há URL de mídia', () => {
    const { segments, hasMedia } = parseSegments('olá tudo bem?')
    expect(hasMedia).toBe(false)
    expect(segments).toEqual([{ type: 'text', value: 'olá tudo bem?' }])
  })

  it('detecta URL de imagem isolada', () => {
    const { segments, hasMedia } = parseSegments('https://x.com/a.jpg')
    expect(hasMedia).toBe(true)
    expect(segments).toEqual([{ type: 'image', src: 'https://x.com/a.jpg' }])
  })

  it('detecta URL de vídeo (mp4/webm/mov)', () => {
    const { segments, hasMedia } = parseSegments(
      'a https://x.com/v.mp4 b https://x.com/w.webm c https://x.com/z.mov',
    )
    expect(hasMedia).toBe(true)
    expect(segments.filter((s) => s.type === 'video')).toEqual([
      { type: 'video', src: 'https://x.com/v.mp4' },
      { type: 'video', src: 'https://x.com/w.webm' },
      { type: 'video', src: 'https://x.com/z.mov' },
    ])
  })

  it('intercala imagens e vídeo preservando ordem', () => {
    const text = 'https://x.com/a.jpg https://x.com/b.png https://x.com/v.mp4'
    const { segments } = parseSegments(text)
    expect(segments).toEqual([
      { type: 'image', src: 'https://x.com/a.jpg' },
      { type: 'image', src: 'https://x.com/b.png' },
      { type: 'video', src: 'https://x.com/v.mp4' },
    ])
  })

  it('reconhece vídeo com querystring', () => {
    const { segments } = parseSegments('https://x.com/v.mp4?token=abc')
    expect(segments).toEqual([{ type: 'video', src: 'https://x.com/v.mp4?token=abc' }])
  })
})

describe('groupConsecutiveMedia', () => {
  it('mantém array vazio', () => {
    expect(groupConsecutiveMedia([])).toEqual([])
  })

  it('mantém uma imagem solitária como image', () => {
    expect(groupConsecutiveMedia([{ type: 'image', src: 'a.jpg' }])).toEqual([
      { type: 'image', src: 'a.jpg' },
    ])
  })

  it('mantém um vídeo solitário como video', () => {
    expect(groupConsecutiveMedia([{ type: 'video', src: 'v.mp4' }])).toEqual([
      { type: 'video', src: 'v.mp4' },
    ])
  })

  it('agrupa imagens + vídeo final num mediaGroup, com vídeo por último', () => {
    expect(
      groupConsecutiveMedia([
        { type: 'image', src: 'a.jpg' },
        { type: 'image', src: 'b.jpg' },
        { type: 'video', src: 'v.mp4' },
      ]),
    ).toEqual([
      {
        type: 'mediaGroup',
        items: [
          { type: 'image', src: 'a.jpg' },
          { type: 'image', src: 'b.jpg' },
          { type: 'video', src: 'v.mp4' },
        ],
      },
    ])
  })

  it('mídia separada por texto não agrupa', () => {
    expect(
      groupConsecutiveMedia([
        { type: 'image', src: 'a.jpg' },
        { type: 'text', value: 'meio' },
        { type: 'video', src: 'v.mp4' },
      ]),
    ).toEqual([
      { type: 'image', src: 'a.jpg' },
      { type: 'text', value: 'meio' },
      { type: 'video', src: 'v.mp4' },
    ])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "src/app/chat/[slug]/components/__tests__/message-segments.test.ts"`
Expected: FAIL — `groupConsecutiveMedia`/`hasMedia` não existem; vídeo não é detectado.

- [ ] **Step 3: Reescrever `message-segments.ts`**

Substituir o conteúdo de `src/app/chat/[slug]/components/message-segments.ts` por:
```ts
export type Segment =
  | { type: 'text'; value: string }
  | { type: 'image'; src: string }
  | { type: 'video'; src: string }

export type MediaItem =
  | { type: 'image'; src: string }
  | { type: 'video'; src: string }

export type RenderItem =
  | { type: 'text'; value: string }
  | { type: 'image'; src: string }
  | { type: 'video'; src: string }
  | { type: 'mediaGroup'; items: MediaItem[] }

const MEDIA_URL_RE =
  /https?:\/\/\S+?\.(?:jpe?g|png|webp|gif|mp4|webm|mov)(?:\?\S*)?/gi
const VIDEO_EXT_RE = /\.(?:mp4|webm|mov)(?:\?\S*)?$/i

function mediaSegment(url: string): Segment {
  return VIDEO_EXT_RE.test(url)
    ? { type: 'video', src: url }
    : { type: 'image', src: url }
}

export function parseSegments(
  text: string,
): { segments: Segment[]; hasMedia: boolean } {
  const segments: Segment[] = []
  const re = new RegExp(MEDIA_URL_RE.source, MEDIA_URL_RE.flags)
  let lastIndex = 0
  let match: RegExpExecArray | null
  let hasMedia = false
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const chunk = text.slice(lastIndex, match.index)
      if (chunk.trim()) segments.push({ type: 'text', value: chunk.trim() })
    }
    segments.push(mediaSegment(match[0]))
    hasMedia = true
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    const tail = text.slice(lastIndex)
    if (tail.trim()) segments.push({ type: 'text', value: tail.trim() })
  }
  if (segments.length === 0 && text) segments.push({ type: 'text', value: text })
  return { segments, hasMedia }
}

export function groupConsecutiveMedia(segments: Segment[]): RenderItem[] {
  const out: RenderItem[] = []
  let buffer: MediaItem[] = []

  const flush = () => {
    if (buffer.length === 0) return
    if (buffer.length === 1) {
      out.push(buffer[0])
    } else {
      out.push({ type: 'mediaGroup', items: buffer })
    }
    buffer = []
  }

  for (const seg of segments) {
    if (seg.type === 'image' || seg.type === 'video') {
      buffer.push(seg)
    } else {
      flush()
      out.push(seg)
    }
  }
  flush()

  return out
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run "src/app/chat/[slug]/components/__tests__/message-segments.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/chat/[slug]/components/message-segments.ts" "src/app/chat/[slug]/components/__tests__/message-segments.test.ts"
git commit -m "feat(chat): parser detecta video e agrupa midia (video por ultimo)"
```

---

## Task 11: Front — `MediaCarousel` + render no `MessageBubble`

**Files:**
- Create: `src/app/chat/[slug]/components/MediaCarousel.tsx`
- Delete: `src/app/chat/[slug]/components/ImageCarousel.tsx`
- Modify: `src/app/chat/[slug]/components/MessageBubble.tsx`

- [ ] **Step 1: Criar `MediaCarousel.tsx`**

`src/app/chat/[slug]/components/MediaCarousel.tsx`:
```tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'
import type { MediaItem } from './message-segments'

interface MediaCarouselProps {
  items: MediaItem[]
  onImageClick: (src: string) => void
}

export function MediaCarousel({ items, onImageClick }: MediaCarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'start',
    containScroll: 'trimSnaps',
  })
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [scrollSnaps, setScrollSnaps] = useState<number[]>([])
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([])

  const onSelect = useCallback(() => {
    if (!emblaApi) return
    setSelectedIndex(emblaApi.selectedScrollSnap())
  }, [emblaApi])

  useEffect(() => {
    if (!emblaApi) return
    setScrollSnaps(emblaApi.scrollSnapList())
    emblaApi.on('select', onSelect)
    emblaApi.on('reInit', onSelect)
    onSelect()
    return () => {
      emblaApi.off('select', onSelect)
      emblaApi.off('reInit', onSelect)
    }
  }, [emblaApi, onSelect])

  // toca o vídeo só quando o slide está selecionado; pausa os demais
  useEffect(() => {
    items.forEach((item, i) => {
      const v = videoRefs.current[i]
      if (!v || item.type !== 'video') return
      if (i === selectedIndex) {
        void v.play().catch(() => {})
      } else {
        v.pause()
      }
    })
  }, [selectedIndex, items])

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi])
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi])
  const scrollTo = useCallback((i: number) => emblaApi?.scrollTo(i), [emblaApi])

  return (
    <div className="group relative my-1">
      <div className="overflow-hidden rounded" ref={emblaRef}>
        <div className="flex">
          {items.map((item, i) =>
            item.type === 'video' ? (
              <div key={`${i}-${item.src}`} className="min-w-0 flex-[0_0_100%]">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video
                  ref={(el) => {
                    videoRefs.current[i] = el
                  }}
                  src={item.src}
                  muted
                  loop
                  playsInline
                  controls
                  className="max-h-80 w-full object-cover"
                />
              </div>
            ) : (
              <div key={`${i}-${item.src}`} className="min-w-0 flex-[0_0_100%]">
                <button
                  type="button"
                  onClick={() => onImageClick(item.src)}
                  className="block w-full"
                >
                  <img
                    src={item.src}
                    alt=""
                    loading="lazy"
                    className="max-h-80 w-full object-cover"
                  />
                </button>
              </div>
            ),
          )}
        </div>
      </div>

      {/* Setas desktop — só aparecem no hover */}
      <button
        type="button"
        onClick={scrollPrev}
        aria-label="Mídia anterior"
        className="absolute left-1 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/40 p-1 text-white opacity-0 transition group-hover:opacity-100 md:block"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <button
        type="button"
        onClick={scrollNext}
        aria-label="Próxima mídia"
        className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/40 p-1 text-white opacity-0 transition group-hover:opacity-100 md:block"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
      </button>

      {/* Bullets */}
      {scrollSnaps.length > 1 && (
        <div className="mt-1.5 flex justify-center gap-1">
          {scrollSnaps.map((_, i) => (
            <button
              type="button"
              key={i}
              onClick={() => scrollTo(i)}
              aria-label={`Ir para mídia ${i + 1}`}
              className={`h-1.5 w-1.5 rounded-full transition ${
                i === selectedIndex ? 'bg-gray-700' : 'bg-gray-300'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Atualizar `MessageBubble.tsx`**

2a. Trocar os imports:
```tsx
import { parseSegments, groupConsecutiveMedia } from './message-segments'
import { MediaCarousel } from './MediaCarousel'
```
(remover o import de `ImageCarousel` e o de `groupConsecutiveImages`.)

2b. Trocar o bloco de parsing/derivação:
```tsx
  const { segments, hasMedia } =
    content && !isTypedImage
      ? parseSegments(content)
      : { segments: content ? [{ type: 'text' as const, value: content }] : [], hasMedia: false }

  const renderItems = groupConsecutiveMedia(segments)
  const bubbleMaxWidth = hasMedia ? 'max-w-[88%] sm:max-w-sm' : 'max-w-[75%]'
```

2c. No `renderItems.map(...)`, substituir o tratamento dos itens de mídia. O ramo de `text` permanece. Trocar os ramos `image`/grupo por:
```tsx
            if (item.type === 'image') {
              return (
                <button
                  type="button"
                  key={`i-${i}-${item.src}`}
                  onClick={() => setLightbox({ srcs: [item.src], index: 0 })}
                  className="my-1 block w-full"
                >
                  <img
                    src={item.src}
                    alt=""
                    className="max-h-80 w-full rounded object-cover"
                    loading="lazy"
                  />
                </button>
              )
            }
            if (item.type === 'video') {
              return (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video
                  key={`v-${i}-${item.src}`}
                  src={item.src}
                  muted
                  loop
                  playsInline
                  autoPlay
                  controls
                  className="my-1 max-h-80 w-full rounded object-cover"
                />
              )
            }
            // mediaGroup
            const imageSrcs = item.items
              .filter((m) => m.type === 'image')
              .map((m) => m.src)
            return (
              <MediaCarousel
                key={`g-${i}`}
                items={item.items}
                onImageClick={(src) =>
                  setLightbox({
                    srcs: imageSrcs,
                    index: Math.max(0, imageSrcs.indexOf(src)),
                  })
                }
              />
            )
```

- [ ] **Step 3: Remover `ImageCarousel.tsx`**

```bash
git rm "src/app/chat/[slug]/components/ImageCarousel.tsx"
```
Confirmar que não há outros imports de `ImageCarousel`:

Run: `npx vitest run --passWithNoTests` não cobre isso; rodar busca:
`git grep -n "ImageCarousel"` → Expected: sem resultados.

- [ ] **Step 4: Typecheck + testes do front**

Run: `npx tsc --noEmit && npm test`
Expected: PASS, sem erros de tipo.

- [ ] **Step 5: Smoke test no browser**

Run: `npm run dev`. Numa conversa, fazer a IA listar uma categoria e buscar com filtro de um produto que tenha vídeo. Confirmar:
- carrossel mostra fotos e o **vídeo como último slide**;
- vídeo dá **autoplay mudo** quando o slide entra em foco e pausa ao sair;
- clicar numa foto abre o lightbox (só imagens); o vídeo não abre lightbox;
- produto só com vídeo (sem fotos) renderiza um `<video>` standalone.

- [ ] **Step 6: Commit**

```bash
git add "src/app/chat/[slug]/components/MediaCarousel.tsx" "src/app/chat/[slug]/components/MessageBubble.tsx"
git commit -m "feat(chat): MediaCarousel com video autoplay-mudo por ultimo"
```

---

## Verificação final

- [ ] **Front:** `npx tsc --noEmit && npm test` → PASS.
- [ ] **chat-service:** `cd chat-service && pytest -v` → PASS.
- [ ] **Migrations** 037/038/039 aplicadas em dev/staging e verificadas.
- [ ] **Browser:** fluxo completo testado (cadastro manual com vídeo → import/JSON com `video` → IA envia carrossel com vídeo por último em `LISTAR_CATEGORIA` e `BUSCAR_PRODUTOS`).

## Notas de escopo

- `BUSCAR_PRODUTOS` retorna `ids = []`: o rastreio de `product_mentions`/`shown_products` para resultados de busca **permanece como hoje** (busca nunca registrou menções). Só foi adicionada a emissão de cards/carrossel+vídeo. Rastrear menções na busca (resolver `product_id` por nome) fica como incremento futuro.
- Sem transcodificação de vídeo: o arquivo é validado (tipo + 20 MB) e armazenado como está.
