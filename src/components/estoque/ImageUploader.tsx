// src/components/estoque/ImageUploader.tsx
'use client'

import { useRef } from 'react'
import { uploadProductImage } from '@/actions/products'
import { Label } from '@/components/ui/Input'
import { MAX_PRODUCT_IMAGES } from '@/lib/inventory/constants'

export { MAX_PRODUCT_IMAGES }

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
    if (dropped > 0 && uploaded.length === accepted.length) {
      const sentVerb = uploaded.length === 1 ? 'foi enviada' : 'foram enviadas'
      onError(
        `Limite de ${maxImages} imagens. ${uploaded.length} ${sentVerb}; as demais foram ignoradas.`,
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
            disabled={uploading}
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
                disabled={uploading}
                aria-label="Remover imagem"
                className="absolute right-1 top-1 rounded-full bg-white/90 px-1.5 py-0.5 text-xs font-bold text-slate-700 shadow hover:bg-white disabled:opacity-50"
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
