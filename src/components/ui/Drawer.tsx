'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

export function Drawer({
  open,
  onClose,
  title,
  children,
  side = 'right',
  widthClass = 'max-w-md sm:max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title?: string
  children?: React.ReactNode
  side?: 'right' | 'left'
  widthClass?: string
}) {
  const panelRef = useRef<HTMLElement>(null)

  // onClose muda de identidade a cada render do pai; mantê-lo num ref evita
  // re-rodar o effect de foco a cada tecla (o que roubava o foco dos inputs).
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      previouslyFocused?.focus?.()
    }
  }, [open])

  return (
    <div
      aria-hidden={!open}
      className={cn(
        'fixed inset-0 z-50 transition-opacity duration-200',
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <div
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'absolute top-0 h-full w-full bg-white shadow-2xl transition-transform duration-200',
          widthClass,
          side === 'right' ? 'right-0' : 'left-0',
          open
            ? 'translate-x-0'
            : side === 'right'
              ? 'translate-x-full'
              : '-translate-x-full',
        )}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="font-display text-lg font-semibold text-slate-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>
        <div className="h-[calc(100%-65px)] overflow-y-auto px-5 py-4">
          {children}
        </div>
      </aside>
    </div>
  )
}
