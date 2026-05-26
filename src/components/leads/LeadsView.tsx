'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { markLeadContacted, type LeadRow } from '@/actions/leads'

function formatLeadDate(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function LeadsView({ leads }: { leads: LeadRow[] }) {
  const router = useRouter()
  const [tab, setTab] = useState<'novos' | 'contatados'>('novos')
  const [pending, startTransition] = useTransition()
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const novos = leads.filter((l) => !l.contactedAt)
  const contatados = leads.filter((l) => l.contactedAt)
  const shown = tab === 'novos' ? novos : contatados

  function handleContacted(id: string) {
    startTransition(async () => {
      const res = await markLeadContacted(id)
      if (res.ok) router.refresh()
    })
  }

  async function handleCopy(id: string, whatsapp: string) {
    try {
      await navigator.clipboard.writeText(whatsapp)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1400)
    } catch {
      // clipboard indisponível — ignora
    }
  }

  function toggleExpanded(id: string) {
    setExpandedId((current) => (current === id ? null : id))
  }

  return (
    <div className="max-w-[1100px] mx-auto px-8 py-7">
      <div className="eyebrow text-ink-500">PIPELINE</div>
      <h1
        className="font-display font-bold text-ink-900 tracking-tight mt-1"
        style={{ fontSize: '26px' }}
      >
        Fila de leads
      </h1>

      <div className="mt-5 inline-flex rounded-xl bg-white border border-ink-200 p-0.5 text-[12px] font-semibold">
        <button
          type="button"
          onClick={() => setTab('novos')}
          className={
            tab === 'novos'
              ? 'px-3 py-1.5 rounded-lg bg-ink-900 text-white'
              : 'px-3 py-1.5 rounded-lg text-ink-600'
          }
        >
          Novos · {novos.length}
        </button>
        <button
          type="button"
          onClick={() => setTab('contatados')}
          className={
            tab === 'contatados'
              ? 'px-3 py-1.5 rounded-lg bg-ink-900 text-white'
              : 'px-3 py-1.5 rounded-lg text-ink-600'
          }
        >
          Contatados · {contatados.length}
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="card mt-5 px-6 py-10 text-center text-[13px] text-ink-500">
          {tab === 'novos'
            ? 'Nenhum lead novo.'
            : 'Nenhum lead contatado ainda.'}
        </div>
      ) : (
        <div className="card mt-5 divide-y divide-ink-100">
          {shown.map((l) => (
            <div key={l.id} className="px-5 py-4 flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-ink-900 truncate">
                    {l.name}
                  </div>
                  <div className="text-[12.5px] text-ink-500 truncate">
                    {l.interestSummary || 'Sem resumo de interesse'}
                  </div>
                  {l.contactedAt && (
                    <div className="eyebrow text-ink-400 mt-1">
                      CONTATADO
                      {l.contactedByName ? ` POR ${l.contactedByName}` : ''} ·{' '}
                      {formatLeadDate(l.contactedAt)}
                    </div>
                  )}
                </div>
                <div className="text-[12.5px] font-mono text-ink-600 shrink-0">
                  {l.whatsapp}
                </div>
                <div className="text-[11.5px] text-ink-400 tabular shrink-0">
                  {formatLeadDate(l.createdAt)}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(l.id)}
                    aria-expanded={expandedId === l.id}
                    aria-controls={`lead-details-${l.id}`}
                    className="text-[12.5px] font-semibold text-ink-700 hover:text-ink-900 px-2.5 py-1.5 rounded-lg ring-1 ring-ink-200"
                  >
                    {expandedId === l.id ? 'Ocultar' : 'Ver detalhes'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopy(l.id, l.whatsapp)}
                    className="text-[12.5px] font-semibold text-ink-700 hover:text-ink-900 px-2.5 py-1.5 rounded-lg ring-1 ring-ink-200"
                  >
                    {copiedId === l.id ? 'Copiado!' : 'Copiar nº'}
                  </button>
                  {!l.contactedAt && (
                    <button
                      type="button"
                      onClick={() => handleContacted(l.id)}
                      disabled={pending}
                      className="text-[12.5px] font-semibold text-white bg-brand-600 hover:bg-brand-700 px-2.5 py-1.5 rounded-lg disabled:opacity-50"
                    >
                      Marcar contatado
                    </button>
                  )}
                </div>
              </div>

              {expandedId === l.id && (
                <div
                  id={`lead-details-${l.id}`}
                  role="region"
                  className="border-t border-ink-100 pt-4"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                    <div>
                      <div className="eyebrow text-ink-500">NOME</div>
                      <div className="text-[13px] text-ink-900 mt-0.5">{l.name}</div>
                    </div>
                    <div>
                      <div className="eyebrow text-ink-500">NÚMERO</div>
                      <div className="text-[13px] text-ink-900 mt-0.5 font-mono">
                        {l.whatsapp || (
                          <span className="text-ink-400 font-sans">Não informado</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="eyebrow text-ink-500">EMAIL</div>
                      <div className="text-[13px] mt-0.5">
                        {l.email ? (
                          <span className="text-ink-900">{l.email}</span>
                        ) : (
                          <span className="text-ink-400">Não informado</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="eyebrow text-ink-500">CEP</div>
                      <div className="text-[13px] mt-0.5">
                        {l.cep ? (
                          <span className="text-ink-900">{l.cep}</span>
                        ) : (
                          <span className="text-ink-400">Não informado</span>
                        )}
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <div className="eyebrow text-ink-500">RESUMO DE INTERESSE</div>
                      <div className="text-[13px] mt-0.5">
                        {l.interestSummary ? (
                          <span className="text-ink-900 whitespace-pre-wrap">
                            {l.interestSummary}
                          </span>
                        ) : (
                          <span className="text-ink-400">Não informado</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
