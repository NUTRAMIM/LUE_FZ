'use client'

import { useEffect, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import useEmblaCarousel from 'embla-carousel-react'

interface ImageLightboxProps {
  srcs: string[]
  startIndex: number
  onClose: () => void
}

export function ImageLightbox({ srcs, startIndex, onClose }: ImageLightboxProps) {
  const multiple = srcs.length > 1
  const [emblaRef, emblaApi] = useEmblaCarousel({
    startIndex,
    align: 'center',
    containScroll: 'trimSnaps',
  })
  const [selectedIndex, setSelectedIndex] = useState(startIndex)

  // Trava o scroll do body enquanto montado
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Listeners de teclado
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (multiple && e.key === 'ArrowLeft') emblaApi?.scrollPrev()
      if (multiple && e.key === 'ArrowRight') emblaApi?.scrollNext()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [emblaApi, multiple, onClose])

  // Atualiza bullets do lightbox
  const onSelect = useCallback(() => {
    if (!emblaApi) return
    setSelectedIndex(emblaApi.selectedScrollSnap())
  }, [emblaApi])

  useEffect(() => {
    if (!emblaApi) return
    emblaApi.on('select', onSelect)
    emblaApi.on('reInit', onSelect)
    onSelect()
    return () => {
      emblaApi.off('select', onSelect)
      emblaApi.off('reInit', onSelect)
    }
  }, [emblaApi, onSelect])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar"
        className="absolute right-3 top-3 z-10 rounded-full bg-black/50 p-2 text-white"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>

      {multiple ? (
        <div
          className="h-full w-full overflow-hidden"
          ref={emblaRef}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex h-full">
            {srcs.map((src, i) => (
              <div
                key={`${i}-${src}`}
                className="flex h-full min-w-0 flex-[0_0_100%] items-center justify-center"
              >
                <img
                  src={src}
                  alt=""
                  className="max-h-[90vh] max-w-[95vw] object-contain"
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <img
          src={srcs[0]}
          alt=""
          className="max-h-[90vh] max-w-[95vw] object-contain"
          onClick={(e) => e.stopPropagation()}
        />
      )}

      {multiple && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {srcs.map((_, i) => (
            <button
              type="button"
              key={i}
              onClick={() => emblaApi?.scrollTo(i)}
              aria-label={`Ir para imagem ${i + 1}`}
              className={`h-2 w-2 rounded-full transition ${
                i === selectedIndex ? 'bg-white' : 'bg-white/40'
              }`}
            />
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}
