'use client'

import { Icon } from './Icons'

type Gap = { count: number; question: string; tag: string }

const GAPS: Gap[] = [
  { count: 12, question: 'vocês entregam em Niterói?',         tag: 'POLÍTICA DE ENTREGA' },
  { count:  9, question: 'qual o prazo de produção?',          tag: 'PRAZO' },
  { count:  7, question: 'tem desconto pra pedido grande?',    tag: 'ATACADO' },
  { count:  6, question: 'rosas importadas?',                  tag: 'SKU INEXISTENTE' },
  { count:  4, question: 'fazem entrega no domingo?',          tag: 'POLÍTICA DE ENTREGA' },
]

const TOTAL_PENDING = 47

export function GapsConhecimento() {
  return (
    <div className="card p-0 h-full flex flex-col">
      <div className="flex items-end justify-between px-6 pt-6 pb-5">
        <div>
          <div className="eyebrow text-ink-500">RAG · GAPS DE CONHECIMENTO</div>
          <h2
            className="font-display font-bold text-ink-900 tracking-tight mt-1"
            style={{ fontSize: '20px' }}
          >
            Perguntas sem resposta
          </h2>
        </div>
        <button className="text-[12.5px] font-semibold text-brand-700 hover:text-brand-800 inline-flex items-center gap-1">
          Abrir todos · {TOTAL_PENDING} <Icon name="arrow" className="w-3.5 h-3.5" />
        </button>
      </div>

      <ul className="divide-y divide-ink-100 border-t border-ink-100 flex-1">
        {GAPS.map((g) => (
          <li key={g.question} className="px-6 py-3 flex items-center gap-3">
            <span className="font-mono tabular text-[12px] font-semibold text-brand-700 bg-brand-50 ring-1 ring-brand-100 px-1.5 py-0.5 rounded-md min-w-[42px] text-center">
              {g.count}×
            </span>
            <span className="text-[13.5px] text-ink-800 flex-1 truncate">
              &ldquo;{g.question}&rdquo;
            </span>
            <span className="eyebrow text-ink-400 shrink-0">{g.tag}</span>
          </li>
        ))}
      </ul>

      <div className="px-6 py-4 border-t border-ink-100 bg-ink-50/40">
        <button className="w-full inline-flex items-center justify-center gap-2 text-[13px] font-semibold text-ink-900 bg-white ring-1 ring-ink-200 hover:ring-brand-300 hover:text-brand-700 px-4 py-2.5 rounded-xl">
          <Icon name="sparkle" className="w-4 h-4" />
          Completar respostas no catálogo
        </button>
      </div>
    </div>
  )
}
