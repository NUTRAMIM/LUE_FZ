// src/components/estoque/VideoUploader.tsx
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
    try {
      const result = await uploadProductVideo(fd)
      if (!result.success || !result.url) {
        onError(result.error ?? 'Falha no upload do video.')
      } else {
        onChange(result.url)
      }
    } catch {
      onError('Falha no upload do video. Tente um arquivo menor (máx 20MB).')
    } finally {
      onUploadingChange(false)
      if (inputRef.current) inputRef.current.value = ''
    }
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
