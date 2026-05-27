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

function formatOptionalNumber(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? String(numberValue) : ''
}

function formatRequiredNumber(value: unknown): string {
  const formatted = formatOptionalNumber(value)
  return formatted || '0'
}

function listToText(values: string[] | null): string {
  return (values ?? []).join(', ')
}


export function ProductEditDrawer({
  productId,
  open,
  onClose,
}: {
  productId: string | null
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [product, setProduct] = useState<Product | null>(null)
  const [loading, setLoading] = useState(false)
  const [imageUrls, setImageUrls] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)

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

  function handleClose() {
    if (isPending || uploading) return
    setError(null)
    onClose()
  }

  function handleSubmit(formData: FormData) {
    if (!product) return
    setError(null)

    if (imageUrls.length > MAX_PRODUCT_IMAGES) {
      setError(
        `Máximo de ${MAX_PRODUCT_IMAGES} imagens. Remova ${imageUrls.length - MAX_PRODUCT_IMAGES} para salvar.`,
      )
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

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title={product ? `Editar ${product.name}` : 'Editar produto'}
      widthClass="max-w-lg sm:max-w-2xl"
    >
      {loading ? (
        <DrawerSkeleton />
      ) : error && !product ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-danger/20 bg-danger-soft p-3 text-sm text-danger">
            {error}
          </div>
          <Button type="button" variant="secondary" onClick={handleClose}>
            Fechar
          </Button>
        </div>
      ) : !product ? null : (
        <form action={handleSubmit} className="space-y-5">
          {error && (
            <div className="rounded-xl border border-danger/20 bg-danger-soft p-3 text-sm text-danger">
              {error}
            </div>
          )}

          <section className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" name="name" defaultValue={product.name} required />
            <Field label="SKU" name="sku" defaultValue={product.sku} required />
            <Field label="Categoria" name="category" defaultValue={product.category ?? ''} />
            <Field label="Marca" name="brand" defaultValue={product.brand ?? ''} />
          </section>

          <div>
            <Label htmlFor="description">Descricao</Label>
            <textarea
              id="description"
              name="description"
              defaultValue={product.description ?? ''}
              rows={4}
              className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 transition-all duration-150 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100"
            />
          </div>

          <section className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Preco"
              name="price"
              type="text"
              inputMode="decimal"
              defaultValue={formatRequiredNumber(product.price)}
              required
            />
            <Field
              label="Preco comparativo"
              name="compare_at_price"
              type="text"
              inputMode="decimal"
              defaultValue={formatOptionalNumber(product.compare_at_price)}
            />
            <Field
              label="Estoque"
              name="stock_quantity"
              type="number"
              min={0}
              step={1}
              defaultValue={formatRequiredNumber(product.stock_quantity)}
              required
            />
            <Field
              label="Estoque minimo"
              name="stock_min"
              type="number"
              min={0}
              step={1}
              defaultValue={formatRequiredNumber(product.stock_min)}
              required
            />
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="tamanhos">Tamanhos</Label>
              <textarea
                id="tamanhos"
                name="tamanhos"
                defaultValue={listToText(product.tamanhos)}
                rows={3}
                placeholder="P, M, G"
                className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 transition-all duration-150 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100"
              />
            </div>
            <div>
              <Label htmlFor="cores">Cores</Label>
              <textarea
                id="cores"
                name="cores"
                defaultValue={listToText(product.cores)}
                rows={3}
                placeholder="Preto, Branco"
                className="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-900 transition-all duration-150 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100"
              />
            </div>
          </section>

          <div className="space-y-3">
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
          </div>

          <div className="sticky bottom-0 -mx-5 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4">
            <Button type="button" variant="secondary" onClick={handleClose} disabled={isPending || uploading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || uploading}>
              {isPending ? 'Salvando...' : 'Salvar produto'}
            </Button>
          </div>
        </form>
      )}
    </Drawer>
  )
}

function DrawerSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-12 rounded-lg bg-slate-100" />
        <div className="h-12 rounded-lg bg-slate-100" />
        <div className="h-12 rounded-lg bg-slate-100" />
        <div className="h-12 rounded-lg bg-slate-100" />
      </div>
      <div className="h-24 rounded-lg bg-slate-100" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="h-12 rounded-lg bg-slate-100" />
        <div className="h-12 rounded-lg bg-slate-100" />
      </div>
    </div>
  )
}

function Field({
  label,
  name,
  ...props
}: {
  label: string
  name: string
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...props} />
    </div>
  )
}
