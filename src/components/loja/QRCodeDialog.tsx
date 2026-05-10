'use client'

import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

export function QRCodeDialog({ value }: { value: string }) {
  const [open, setOpen] = useState(false)
  const [svg, setSvg] = useState<string>('')

  useEffect(() => {
    if (!open) return
    QRCode.toString(value, { type: 'svg', width: 240, margin: 1 }).then(setSvg)
  }, [open, value])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-blue-700 underline"
      >
        📱 Ver QR Code
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="mb-3"
              dangerouslySetInnerHTML={{ __html: svg }}
              aria-label="QR code"
            />
            <p className="mb-3 break-all text-center text-xs text-gray-600">
              {value}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full rounded-md bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-300"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  )
}
