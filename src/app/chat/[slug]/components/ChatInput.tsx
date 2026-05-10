'use client'

import { useState, useRef, useEffect } from 'react'
import { getUploadUrl, sendMessage } from '@/actions/chat'
import type { ChatMessage } from '../ChatClient'
import { AudioRecorder } from './AudioRecorder'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ALLOWED_IMAGE = ['image/jpeg', 'image/png', 'image/webp']

async function resizeImage(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    const maxW = 1920
    if (img.width <= maxW) return file
    const scale = maxW / img.width
    const canvas = document.createElement('canvas')
    canvas.width = maxW
    canvas.height = Math.round(img.height * scale)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b ?? file), file.type, 0.9)
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function ChatInput({
  slug,
  conversationId,
  sending,
  onSending,
  onError,
  onLocalAdd,
}: {
  slug: string
  conversationId: string
  sending: boolean
  onSending: (s: boolean) => void
  onError: (e: string | null) => void
  onLocalAdd: (m: ChatMessage) => void
}) {
  const [text, setText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [audioSupported, setAudioSupported] = useState(false)
  const [recordingMode, setRecordingMode] = useState(false)

  useEffect(() => {
    setAudioSupported(
      typeof window !== 'undefined' &&
        typeof navigator !== 'undefined' &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof MediaRecorder !== 'undefined',
    )
  }, [])

  async function handleAudio(blob: Blob) {
    setRecordingMode(false)
    if (blob.size > 2 * 1024 * 1024) {
      onError('Áudio maior que 2MB.')
      return
    }
    onSending(true)
    onError(null)
    try {
      const upload = await getUploadUrl({
        slug,
        mime: 'audio/webm',
        size: blob.size,
      })
      if (!upload.success || !upload.uploadUrl || !upload.mediaPath) {
        onError(upload.error ?? 'Erro no upload.')
        return
      }
      const put = await fetch(upload.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'audio/webm' },
        body: blob,
      })
      if (!put.ok) {
        onError('Falha no upload.')
        return
      }
      const result = await sendMessage({
        slug,
        text: '',
        mediaPath: upload.mediaPath,
        messageType: 'audio',
      })
      if (!result.success) {
        onError(result.error ?? 'Erro ao enviar áudio.')
      }
    } finally {
      onSending(false)
    }
  }

  async function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!ALLOWED_IMAGE.includes(file.type)) {
      onError('Tipo de imagem não suportado.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      onError('Imagem maior que 5MB.')
      return
    }
    onSending(true)
    onError(null)
    try {
      const blob = await resizeImage(file)
      const upload = await getUploadUrl({
        slug,
        mime: file.type,
        size: blob.size,
      })
      if (!upload.success || !upload.uploadUrl || !upload.mediaPath) {
        onError(upload.error ?? 'Erro no upload.')
        return
      }
      const put = await fetch(upload.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: blob,
      })
      if (!put.ok) {
        onError('Falha no upload.')
        return
      }
      const result = await sendMessage({
        slug,
        text: '',
        mediaPath: upload.mediaPath,
        messageType: 'image',
      })
      if (!result.success) {
        onError(result.error ?? 'Erro ao enviar imagem.')
      }
    } finally {
      onSending(false)
    }
  }

  async function handleSend() {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    onSending(true)
    onError(null)

    const tempId = `temp-${Date.now()}`
    onLocalAdd({
      id: tempId,
      role: 'user',
      content: trimmed,
      message_type: 'text',
      media_url: null,
      created_at: new Date().toISOString(),
    })
    setText('')

    const result = await sendMessage({
      slug,
      text: trimmed,
      messageType: 'text',
    })

    if (!result.success) {
      onError(result.error ?? 'Erro ao enviar.')
    }
    onSending(false)
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <footer className="flex items-end gap-2 bg-white px-3 py-2 shadow-inner">
      {recordingMode ? (
        <AudioRecorder
          onRecorded={handleAudio}
          onCancel={() => setRecordingMode(false)}
          disabled={sending}
        />
      ) : (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={handleImage}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            className="flex h-10 w-10 items-center justify-center text-gray-500 disabled:opacity-50"
            aria-label="Anexar imagem"
          >
            📎
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKey}
            rows={1}
            placeholder="Mensagem"
            className="max-h-32 flex-1 resize-none rounded-2xl bg-gray-100 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#075E54]"
          />
          {text.trim() ? (
            <button
              type="button"
              onClick={handleSend}
              disabled={sending}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#075E54] text-white disabled:opacity-50"
              aria-label="Enviar"
            >
              ➤
            </button>
          ) : audioSupported ? (
            <button
              type="button"
              onClick={() => setRecordingMode(true)}
              disabled={sending}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#075E54] text-white disabled:opacity-50"
              aria-label="Gravar áudio"
            >
              🎤
            </button>
          ) : null}
        </>
      )}
    </footer>
  )
}
