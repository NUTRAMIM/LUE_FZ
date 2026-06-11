// src/components/estoque/ProductCreateDrawer.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createProduct,
  type CreateProductInput,
} from '@/actions/products'
import { Button } from '@/components/ui/Button'
import { Drawer } from '@/components/ui/Drawer'
import { Input, Label } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { ImageUploader } from './ImageUploader'
import { VideoUploader } from './VideoUploader'

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
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  function resetForm() {
    setName('')
    setDescription('')
    setPrice('')
    setUnits('')
    setTamanhos([])
    setCores([])
    setImageUrls([])
    setVideoUrl(null)
    setError(null)
  }

  function handleClose() {
    if (isPending || uploading) return
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
      video_url: videoUrl ?? '',
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

        <ImageUploader
          urls={imageUrls}
          onChange={setImageUrls}
          onError={setError}
          uploading={uploading}
          onUploadingChange={setUploading}
          inputId="cp-images"
        />

        <VideoUploader
          url={videoUrl}
          onChange={setVideoUrl}
          onError={setError}
          uploading={uploading}
          onUploadingChange={setUploading}
          inputId="cp-video"
        />

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
          <Button type="button" variant="secondary" onClick={handleClose} disabled={isPending || uploading}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending || uploading}>
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
