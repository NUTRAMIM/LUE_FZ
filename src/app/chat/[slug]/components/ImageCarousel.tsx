'use client'

import { useCallback, useEffect, useState } from 'react'
import useEmblaCarousel from 'embla-carousel-react'

interface ImageCarouselProps {
  srcs: string[]
  onImageClick: (index: number) => void
}

export function ImageCarousel({ srcs, onImageClick }: ImageCarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: 'start',
    containScroll: 'trimSnaps',
  })
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [scrollSnaps, setScrollSnaps] = useState<number[]>([])

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

  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi])
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi])
  const scrollTo = useCallback(
    (i: number) => emblaApi?.scrollTo(i),
    [emblaApi],
  )

  return (
    <div className="group relative my-1">
      <div className="overflow-hidden rounded" ref={emblaRef}>
        <div className="flex">
          {srcs.map((src, i) => (
            <div key={`${i}-${src}`} className="min-w-0 flex-[0_0_100%]">
              <button
                type="button"
                onClick={() => onImageClick(i)}
                className="block w-full"
              >
                <img
                  src={src}
                  alt=""
                  loading="lazy"
                  className="max-h-80 w-full object-cover"
                />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Setas desktop — só aparecem no hover */}
      <button
        type="button"
        onClick={scrollPrev}
        aria-label="Imagem anterior"
        className="absolute left-1 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/40 p-1 text-white opacity-0 transition group-hover:opacity-100 md:block"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <button
        type="button"
        onClick={scrollNext}
        aria-label="Próxima imagem"
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
              aria-label={`Ir para imagem ${i + 1}`}
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
