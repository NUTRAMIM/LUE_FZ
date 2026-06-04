'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { answerKnowledgeGap, type KnowledgeGap } from '@/actions/painel'
import { MAX_FAQ_ANSWER_LENGTH } from '@/lib/store-settings-sanitize'
import { Icon } from './Icons'

export function GapsConhecimento({
  gaps,
  totalPending,
}: {
  gaps: KnowledgeGap[]
  totalPending: number
}) {
  const [items, setItems] = useState(gaps)
  const [pending, setPending] = useState(totalPending)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [saving, setSaving] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)

  // Fluxo "Completar respostas": snapshot das perguntas percorridas uma a uma
  // num modal. O snapshot mantém os índices estáveis mesmo quando uma resposta
  // salva remove o item da lista principal.
  const [batchQueue, setBatchQueue] = useState<KnowledgeGap[] | null>(null)
  const [batchIndex, setBatchIndex] = useState(0)

  function openRow(question: string) {
    setOpenKey(question)
    setAnswer('')
    setRowError(null)
  }

  function closeRow() {
    setOpenKey(null)
    setAnswer('')
    setRowError(null)
  }

  function startBatch() {
    if (items.length === 0) return
    closeRow()
    setBatchQueue(items)
    setBatchIndex(0)
    setAnswer('')
    setRowError(null)
  }

  function closeBatch() {
    setBatchQueue(null)
    setBatchIndex(0)
    setAnswer('')
    setRowError(null)
  }

  function advanceBatch() {
    if (!batchQueue) return
    const next = batchIndex + 1
    if (next >= batchQueue.length) {
      closeBatch()
    } else {
      setBatchIndex(next)
      setAnswer('')
      setRowError(null)
    }
  }

  async function handleBatchSave() {
    const current = batchQueue?.[batchIndex]
    if (!current) return
    if (!answer.trim()) {
      setRowError('Informe uma resposta.')
      return
    }
    setSaving(true)
    setRowError(null)
    const result = await answerKnowledgeGap({
      question: current.question,
      answer,
    })
    setSaving(false)
    if (result.success) {
      setItems((prev) => prev.filter((i) => i.question !== current.question))
      setPending((p) => Math.max(0, p - (result.resolvedCount ?? 0)))
      advanceBatch()
    } else {
      setRowError(result.error ?? 'Erro ao salvar.')
    }
  }

  useEffect(() => {
    if (!batchQueue) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeBatch()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [batchQueue])

  async function handleSave(question: string) {
    if (!answer.trim()) {
      setRowError('Informe uma resposta.')
      return
    }
    setSaving(true)
    setRowError(null)
    const result = await answerKnowledgeGap({ question, answer })
    setSaving(false)
    if (result.success) {
      setItems((prev) => prev.filter((i) => i.question !== question))
      setPending((p) => Math.max(0, p - (result.resolvedCount ?? 0)))
      closeRow()
    } else {
      setRowError(result.error ?? 'Erro ao salvar.')
    }
  }

  return (
    <div className="card p-0 h-full flex flex-col">
      <div className="flex flex-wrap items-end justify-between gap-3 px-5 sm:px-6 pt-5 sm:pt-6 pb-4 sm:pb-5">
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
          Abrir todos · {pending}{' '}
          <Icon name="arrow" className="w-3.5 h-3.5" />
        </button>
      </div>

      {items.length === 0 ? (
        <div className="px-6 py-10 text-center text-[13px] text-ink-500 border-t border-ink-100 flex-1">
          Nenhuma pergunta sem resposta na última semana.
        </div>
      ) : (
        <ul className="divide-y divide-ink-100 border-t border-ink-100 flex-1">
          {items.map((g) => (
            <li key={g.question} className="px-5 sm:px-6 py-3">
              <div className="flex items-center gap-3">
                <span className="font-mono tabular text-[12px] font-semibold text-brand-700 bg-brand-50 ring-1 ring-brand-100 px-1.5 py-0.5 rounded-md min-w-[42px] text-center">
                  {g.count}×
                </span>
                <span
                  className={`text-[13.5px] text-ink-800 flex-1 ${
                    openKey === g.question ? '' : 'truncate'
                  }`}
                >
                  &ldquo;{g.question}&rdquo;
                </span>
                <span className="eyebrow text-ink-400 shrink-0">{g.tag}</span>
                {openKey !== g.question && (
                  <button
                    type="button"
                    onClick={() => openRow(g.question)}
                    className="text-[12px] font-semibold text-brand-700 hover:text-brand-800 shrink-0"
                  >
                    Responder
                  </button>
                )}
              </div>

              {openKey === g.question && (
                <div className="mt-3 space-y-2">
                  <textarea
                    className="input"
                    rows={3}
                    maxLength={MAX_FAQ_ANSWER_LENGTH}
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    placeholder="Resposta que o agente deve usar com os clientes…"
                    autoFocus
                  />
                  {rowError && (
                    <p className="text-[12px] text-[#DC2626]">{rowError}</p>
                  )}
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeRow}
                      disabled={saving}
                      className="text-[12.5px] font-semibold text-ink-500 hover:text-ink-800 px-3 py-1.5"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSave(g.question)}
                      disabled={saving}
                      className="btn btn-primary"
                    >
                      {saving ? 'Salvando…' : 'Salvar resposta'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="px-5 sm:px-6 py-4 border-t border-ink-100 bg-ink-50/40">
        <button
          type="button"
          onClick={startBatch}
          disabled={items.length === 0}
          className="w-full inline-flex items-center justify-center gap-2 text-[13px] font-semibold text-ink-900 bg-white ring-1 ring-ink-200 hover:ring-brand-300 hover:text-brand-700 px-4 py-2.5 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:ring-ink-200 disabled:hover:text-ink-900"
        >
          <Icon name="sparkle" className="w-4 h-4" />
          Completar respostas no catálogo
        </button>
      </div>

      {batchQueue &&
        batchQueue[batchIndex] &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={closeBatch}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="card w-full max-w-[520px] p-5 sm:p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <div className="eyebrow text-ink-500">COMPLETAR RESPOSTAS</div>
                  <h3 className="font-display font-bold text-ink-900 text-[17px] mt-0.5">
                    Pergunta {batchIndex + 1} de {batchQueue.length}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={closeBatch}
                  aria-label="Fechar"
                  className="text-ink-400 hover:text-ink-700 p-1 shrink-0"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono tabular text-[12px] font-semibold text-brand-700 bg-brand-50 ring-1 ring-brand-100 px-1.5 py-0.5 rounded-md">
                  {batchQueue[batchIndex].count}×
                </span>
                <span className="eyebrow text-ink-400">
                  {batchQueue[batchIndex].tag}
                </span>
              </div>
              <p className="text-[14px] text-ink-800 mb-3">
                &ldquo;{batchQueue[batchIndex].question}&rdquo;
              </p>

              <textarea
                key={batchQueue[batchIndex].question}
                className="input"
                rows={3}
                maxLength={MAX_FAQ_ANSWER_LENGTH}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Resposta que o agente deve usar com os clientes…"
                autoFocus
              />
              {rowError && (
                <p className="text-[12px] text-[#DC2626] mt-1">{rowError}</p>
              )}

              <div className="flex items-center justify-between gap-2 mt-4">
                <button
                  type="button"
                  onClick={advanceBatch}
                  disabled={saving}
                  className="text-[12.5px] font-semibold text-ink-500 hover:text-ink-800 px-3 py-1.5"
                >
                  Pular
                </button>
                <button
                  type="button"
                  onClick={handleBatchSave}
                  disabled={saving}
                  className="btn btn-primary"
                >
                  {saving
                    ? 'Salvando…'
                    : batchIndex === batchQueue.length - 1
                      ? 'Salvar e concluir'
                      : 'Salvar e próxima'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
