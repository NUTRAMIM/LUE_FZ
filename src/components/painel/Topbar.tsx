'use client'

import { Icon } from './Icons'

export function Topbar({ dateLabel }: { dateLabel: string }) {
  return (
    <div className="flex items-center justify-between mb-7">
      <div>
        <div className="eyebrow text-ink-500">PAINEL · OPERAÇÃO</div>
        <h1
          className="font-display font-bold text-ink-900 tracking-tight mt-1.5"
          style={{ fontSize: '26px', lineHeight: 1.1 }}
        >
          Visão geral · {dateLabel}
        </h1>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <Icon
            name="search"
            className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2"
          />
          <input
            placeholder="Buscar conversas, produtos, pedidos…"
            className="w-[300px] pl-9 pr-12 py-2.5 rounded-xl bg-white border border-ink-200 text-[13px] placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 eyebrow text-ink-400 bg-ink-50 px-1.5 py-0.5 rounded-md">
            ⌘K
          </span>
        </div>
        <button className="relative w-10 h-10 rounded-xl bg-white border border-ink-200 text-ink-600 hover:text-ink-900 hover:bg-ink-50 flex items-center justify-center">
          <Icon name="bell" className="w-4 h-4" />
          <span className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-brand-600 ring-2 ring-white" />
        </button>
      </div>
    </div>
  )
}
