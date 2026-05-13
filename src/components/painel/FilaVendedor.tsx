'use client'

import { Icon } from './Icons'

type AgeTone = 'ok' | 'warn' | 'danger'
type Status = 'ABERTO' | 'NÃO ATRIBUÍDO' | 'SEM RESPOSTA'

type Lead = {
  id: string
  age: string
  ageTone: AgeTone
  intent: string
  origin: string
  seller: string | null
  status: Status
}

const LEADS: Lead[] = [
  { id: '#2841', age: '14m',    ageTone: 'ok',     intent: 'Buquê casamento',     origin: 'loja/buques',   seller: 'Camila R.', status: 'ABERTO' },
  { id: '#2840', age: '18m',    ageTone: 'ok',     intent: 'Orçamento corporativo', origin: 'loja/atacado', seller: null,        status: 'NÃO ATRIBUÍDO' },
  { id: '#2837', age: '65m',    ageTone: 'warn',   intent: 'Coroa de flores',     origin: 'loja/coroas',   seller: 'Lucas P.',  status: 'SEM RESPOSTA' },
  { id: '#2835', age: '1h42m',  ageTone: 'danger', intent: 'Assinatura mensal',   origin: 'loja',          seller: null,        status: 'NÃO ATRIBUÍDO' },
  { id: '#2833', age: '2h05m',  ageTone: 'danger', intent: 'Buquê personalizado', origin: 'loja/buques',   seller: 'Camila R.', status: 'ABERTO' },
]

const AGE_CLS: Record<AgeTone, string> = {
  ok:     'text-ink-700 bg-ink-100 ring-ink-200',
  warn:   'text-warn-700 bg-warn-50 ring-warn-100',
  danger: 'text-danger-700 bg-danger-50 ring-danger-100',
}

const STATUS_CLS: Record<Status, string> = {
  'ABERTO':         'text-ink-700 bg-ink-50 ring-ink-200',
  'NÃO ATRIBUÍDO':  'text-warn-700 bg-warn-50 ring-warn-100',
  'SEM RESPOSTA':   'text-danger-700 bg-danger-50 ring-danger-100',
}

export function FilaVendedor() {
  return (
    <div className="card p-0">
      <div className="flex items-end justify-between px-6 pt-6 pb-5">
        <div>
          <div className="eyebrow text-ink-500">ATENDIMENTO · GARGALO</div>
          <h2
            className="font-display font-bold text-ink-900 tracking-tight mt-1"
            style={{ fontSize: '20px' }}
          >
            Fila do vendedor
          </h2>
        </div>
        <button className="text-[12.5px] font-semibold text-ink-600 hover:text-ink-900 inline-flex items-center gap-1">
          Ordenar: idade <Icon name="chev" className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-ink-50/60 border-y border-ink-100">
              <th className="eyebrow text-ink-400 text-left px-6 py-2 font-normal">LEAD</th>
              <th className="eyebrow text-ink-400 text-left px-3 py-2 font-normal">IDADE</th>
              <th className="eyebrow text-ink-400 text-left px-3 py-2 font-normal">INTENÇÃO</th>
              <th className="eyebrow text-ink-400 text-left px-3 py-2 font-normal">ORIGEM</th>
              <th className="eyebrow text-ink-400 text-left px-3 py-2 font-normal">VENDEDOR</th>
              <th className="eyebrow text-ink-400 text-left px-3 py-2 pr-6 font-normal">STATUS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {LEADS.map((l) => (
              <tr key={l.id} className="text-[13px]">
                <td className="px-6 py-3 font-mono tabular font-semibold text-ink-900">{l.id}</td>
                <td className="px-3 py-3">
                  <span className={`inline-block font-mono tabular text-[12px] font-semibold px-1.5 py-0.5 rounded-md ring-1 ${AGE_CLS[l.ageTone]}`}>
                    {l.age}
                  </span>
                </td>
                <td className="px-3 py-3 text-ink-800">{l.intent}</td>
                <td className="px-3 py-3 font-mono text-[12.5px] text-ink-500">{l.origin}</td>
                <td className="px-3 py-3 text-ink-700">{l.seller ?? <span className="text-ink-400">—</span>}</td>
                <td className="px-3 py-3 pr-6">
                  <span className={`eyebrow text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md ring-1 ${STATUS_CLS[l.status]}`}>
                    {l.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-4 divide-x divide-ink-100 border-t border-ink-100">
        <div className="px-6 py-4">
          <div className="eyebrow text-ink-500">MEDIANA TTFR</div>
          <div className="font-mono tabular font-bold text-ink-900 mt-1.5 text-[16px]">8m 12s</div>
        </div>
        <div className="px-6 py-4">
          <div className="eyebrow text-ink-500">p95 TTFR</div>
          <div className="font-mono tabular font-bold text-ink-900 mt-1.5 text-[16px]">47m 03s</div>
        </div>
        <div className="px-6 py-4">
          <div className="eyebrow text-ink-500">NÃO ATRIBUÍDOS</div>
          <div className="font-mono tabular font-bold text-warn-700 mt-1.5 text-[16px]">05</div>
        </div>
        <div className="px-6 py-4">
          <div className="eyebrow text-ink-500">SEM RESPOSTA &gt; 1H</div>
          <div className="font-mono tabular font-bold text-danger-700 mt-1.5 text-[16px]">02</div>
        </div>
      </div>
    </div>
  )
}
