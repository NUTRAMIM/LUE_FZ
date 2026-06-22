'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
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

function formatPedidoItem(item: {
  produto: string
  qtd: number
  tamanho?: string | null
  cor?: string | null
}): string {
  const extras = [
    item.tamanho ? `tam ${item.tamanho}` : null,
    item.cor ? `cor ${item.cor}` : null,
  ].filter(Boolean)
  const base = `${item.qtd}x ${item.produto}`
  return extras.length ? `${base} (${extras.join(', ')})` : base
}

function formatBRL(valor: number): string {
  return valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
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
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 md:px-8 py-5 md:py-7">
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
            <div key={l.id} className="px-4 sm:px-5 py-4 flex flex-col gap-4">
              <div className="flex flex-wrap items-start gap-x-4 gap-y-2 sm:items-center">
                <div className="min-w-0 flex-1 basis-full sm:basis-auto">
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
                {l.tipoCliente === 'revendedor' && (
                  <div className="shrink-0 eyebrow text-brand-700 px-2 py-1 rounded-lg bg-brand-50 ring-1 ring-brand-200">
                    REVENDEDOR
                  </div>
                )}
                {l.valorTotal != null && (
                  <div className="shrink-0 text-[12.5px] font-semibold text-ink-900 px-2 py-1 rounded-lg bg-brand-50 ring-1 ring-brand-200">
                    {formatBRL(l.valorTotal)}
                  </div>
                )}
                <div className="text-[12.5px] font-mono text-ink-600 shrink-0">
                  {l.whatsapp}
                </div>
                <div className="text-[11.5px] text-ink-400 tabular shrink-0">
                  {formatLeadDate(l.createdAt)}
                </div>
                <div className="flex flex-wrap items-center gap-2 basis-full sm:basis-auto sm:shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(l.id)}
                    aria-expanded={expandedId === l.id}
                    aria-controls={`lead-details-${l.id}`}
                    className="text-[12.5px] font-semibold text-ink-700 hover:text-ink-900 px-2.5 py-1.5 rounded-lg ring-1 ring-ink-200"
                  >
                    {expandedId === l.id ? 'Ocultar' : 'Ver detalhes'}
                  </button>
                  {l.conversationId && (
                    <Link
                      href={`/conversas?c=${l.conversationId}`}
                      className="text-[12.5px] font-semibold text-ink-700 hover:text-ink-900 px-2.5 py-1.5 rounded-lg ring-1 ring-ink-200"
                    >
                      Ver conversa
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => handleCopy(l.id, l.whatsapp)}
                    className="text-[12.5px] font-semibold text-ink-700 hover:text-ink-900 px-2.5 py-1.5 rounded-lg ring-1 ring-ink-200"
                  >
                    {copiedId === l.id ? 'Copiado!' : 'Copiar nº'}
                  </button>
                  {l.whatsapp.replace(/\D/g, '') && (
                    <a
                      href={`https://api.whatsapp.com/send?phone=${l.whatsapp.replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ backgroundColor: '#25D366', color: '#FFFFFF' }}
                      className="text-[12.5px] font-semibold px-2.5 py-1.5 rounded-lg hover:brightness-95"
                    >
                      Conversar no WhatsApp
                    </a>
                  )}
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
                  aria-label={`Detalhes de ${l.name}`}
                  className="border-t border-ink-100 pt-4"
                >
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                    <div>
                      <div className="eyebrow text-ink-500">NOME</div>
                      <div className="text-[13px] text-ink-900 mt-0.5">{l.name}</div>
                    </div>
                    <div>
                      <div className="eyebrow text-ink-500">NÚMERO</div>
                      <div className="text-[13px] mt-0.5">
                        {l.whatsapp ? (
                          <span className="text-ink-900 font-mono">{l.whatsapp}</span>
                        ) : (
                          <span className="text-ink-400">Não informado</span>
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
                    <div>
                      <div className="eyebrow text-ink-500">TIPO DE CLIENTE</div>
                      <div className="text-[13px] mt-0.5">
                        <span className="text-ink-900">
                          {l.tipoCliente === 'revendedor'
                            ? 'Revendedor (atacado)'
                            : 'Varejo'}
                        </span>
                      </div>
                    </div>
                    {l.tipoCliente === 'revendedor' && (
                      <div>
                        <div className="eyebrow text-ink-500">CARRO-CHEFE</div>
                        <div className="text-[13px] mt-0.5">
                          {l.carroChefe ? (
                            <span className="text-ink-900">{l.carroChefe}</span>
                          ) : (
                            <span className="text-ink-400">Não informado</span>
                          )}
                        </div>
                      </div>
                    )}
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
                    <div className="md:col-span-2">
                      <div className="eyebrow text-ink-500">PEDIDO</div>
                      <div className="text-[13px] mt-0.5">
                        {l.pedido.length > 0 ? (
                          <ul className="text-ink-900 list-none space-y-0.5">
                            {l.pedido.map((item, i) => (
                              <li key={i}>{formatPedidoItem(item)}</li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-ink-400">Nenhum item</span>
                        )}
                      </div>
                    </div>
                    <div className="md:col-span-2">
                      <div className="eyebrow text-ink-500">VALOR TOTAL</div>
                      <div className="text-[13px] mt-0.5">
                        {l.valorTotal != null ? (
                          <span className="text-ink-900 font-medium">
                            {formatBRL(l.valorTotal)}
                            {l.descontoAplicado != null &&
                              l.descontoAplicado > 0 &&
                              l.valorBruto != null && (
                                <span className="text-ink-400 font-normal ml-1">
                                  · bruto {formatBRL(l.valorBruto)} · desconto{' '}
                                  {formatBRL(l.descontoAplicado)}
                                </span>
                              )}
                          </span>
                        ) : (
                          <span className="text-ink-400">Não informado</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="eyebrow text-ink-500">FORMA DE PAGAMENTO</div>
                      <div className="text-[13px] mt-0.5">
                        {l.formaPagamento ? (
                          <span className="text-ink-900">{l.formaPagamento}</span>
                        ) : (
                          <span className="text-ink-400">Não informado</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="eyebrow text-ink-500">FORMA DE ENTREGA</div>
                      <div className="text-[13px] mt-0.5">
                        {l.formaEntrega ? (
                          <span className="text-ink-900">{l.formaEntrega}</span>
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
