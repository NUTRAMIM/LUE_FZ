'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Icon } from '@/components/painel/Icons'

const BUCKET = 'store-logos'
const MAX_SIZE = 2 * 1024 * 1024
const ACCEPTED_MIME = ['image/png', 'image/jpeg', 'image/webp']
const ACCEPT_ATTR = ACCEPTED_MIME.join(',')

function extFromMime(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'jpg'
}

export function LogoUpload({
  userId,
  value,
  onChange,
}: {
  userId: string | null
  value: string
  onChange: (url: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)

    if (!userId) {
      setError('Faça login para enviar a logomarca.')
      return
    }
    if (!ACCEPTED_MIME.includes(file.type)) {
      setError('Formato inválido. Use PNG, JPG ou WebP.')
      return
    }
    if (file.size > MAX_SIZE) {
      setError('Imagem muito grande. Máximo 2 MB.')
      return
    }

    setUploading(true)
    const supabase = createClient()
    const path = `${userId}/logo.${extFromMime(file.type)}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, {
        upsert: true,
        contentType: file.type,
        cacheControl: '3600',
      })

    if (uploadError) {
      setError('Falha ao enviar imagem. Tente novamente.')
      setUploading(false)
      return
    }

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    onChange(`${data.publicUrl}?t=${Date.now()}`)
    setUploading(false)
  }

  async function handleRemove() {
    if (!userId) return
    setError(null)
    onChange('')
    const supabase = createClient()
    await supabase.storage
      .from(BUCKET)
      .remove([
        `${userId}/logo.png`,
        `${userId}/logo.jpg`,
        `${userId}/logo.webp`,
      ])
  }

  return (
    <div>
      <div className="flex items-center gap-5">
        <div className="logo-frame">
          {value ? (
            <Image
              src={value}
              alt="Logomarca da loja"
              width={96}
              height={96}
              unoptimized
            />
          ) : (
            <Icon name="image" className="w-[30px] h-[30px]" />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT_ATTR}
            onChange={handleFile}
            className="hidden"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="btn btn-secondary"
            >
              <Icon name="upload" className="w-4 h-4" />
              {uploading
                ? 'Enviando…'
                : value
                  ? 'Trocar logo'
                  : 'Enviar logo'}
            </button>
            {value && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={uploading}
                className="btn btn-ghost"
              >
                Remover
              </button>
            )}
          </div>
          <p className="helper">
            PNG, JPG ou WebP · até 2&nbsp;MB · recomendado 512×512.
          </p>
        </div>
      </div>
      {error && (
        <p className="mt-2 text-sm text-danger-700">{error}</p>
      )}
    </div>
  )
}
