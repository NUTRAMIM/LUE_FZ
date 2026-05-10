'use client'

import { useEffect, useRef, useState } from 'react'

const MAX_SECONDS = 60

export function AudioRecorder({
  onRecorded,
  onCancel,
  disabled,
}: {
  onRecorded: (blob: Blob, durationMs: number) => void
  onCancel: () => void
  disabled?: boolean
}) {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef<number>(0)
  const intervalRef = useRef<number | null>(null)

  async function start() {
    if (disabled) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        const b = new Blob(chunksRef.current, { type: 'audio/webm' })
        setBlob(b)
        setPreviewUrl(URL.createObjectURL(b))
        stream.getTracks().forEach((t) => t.stop())
      }
      rec.start()
      recorderRef.current = rec
      startedAtRef.current = Date.now()
      setRecording(true)
      setSeconds(0)
      intervalRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000)
        setSeconds(elapsed)
        if (elapsed >= MAX_SECONDS) stop()
      }, 250)
    } catch {
      onCancel()
    }
  }

  function stop() {
    if (intervalRef.current) window.clearInterval(intervalRef.current)
    intervalRef.current = null
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
  }

  function discard() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setBlob(null)
    setPreviewUrl(null)
    onCancel()
  }

  function send() {
    if (!blob) return
    onRecorded(blob, Date.now() - startedAtRef.current)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setBlob(null)
    setPreviewUrl(null)
  }

  useEffect(() => {
    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current)
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  if (blob && previewUrl) {
    return (
      <div className="flex flex-1 items-center gap-2">
        <audio controls src={previewUrl} className="flex-1" />
        <button
          onClick={discard}
          className="rounded px-3 py-1 text-sm text-red-600"
          type="button"
        >
          Descartar
        </button>
        <button
          onClick={send}
          className="rounded bg-[#075E54] px-3 py-1 text-sm text-white"
          type="button"
        >
          Enviar
        </button>
      </div>
    )
  }

  if (recording) {
    return (
      <div className="flex flex-1 items-center gap-2">
        <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
        <span className="font-mono text-sm">
          {String(Math.floor(seconds / 60)).padStart(2, '0')}:
          {String(seconds % 60).padStart(2, '0')}
        </span>
        <span className="flex-1" />
        <button
          onClick={discard}
          className="rounded px-3 py-1 text-sm text-red-600"
          type="button"
        >
          Cancelar
        </button>
        <button
          onClick={stop}
          className="rounded bg-[#075E54] px-3 py-1 text-sm text-white"
          type="button"
        >
          Parar
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled}
      className="flex h-10 w-10 items-center justify-center rounded-full bg-[#075E54] text-white disabled:opacity-50"
      aria-label="Gravar áudio"
    >
      🎤
    </button>
  )
}
