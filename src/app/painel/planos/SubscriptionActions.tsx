'use client'

import { useState } from 'react'
import { createPortalSession, cancelSubscription } from '@/actions/billing'

// Botões de gestão da assinatura (client). Portal e cancelamento só fazem
// sentido para assinatura Stripe (cartão); PIX é avulso e simplesmente não
// renova. O webhook do Stripe é quem reflete o cancelamento no banco — aqui
// só disparamos a ação e recarregamos.
export function SubscriptionActions({
  isActive,
  provider,
  cancelAtPeriodEnd,
}: {
  isActive: boolean
  provider: 'stripe' | 'mercadopago' | 'manual' | null
  cancelAtPeriodEnd: boolean
}) {
  const [loading, setLoading] = useState<'portal' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isStripe = provider === 'stripe'

  async function handlePortal() {
    setLoading('portal')
    setError(null)
    try {
      const res = await createPortalSession()
      if ('url' in res) {
        window.location.href = res.url
      } else {
        setError(`Não foi possível abrir o portal (${res.error}).`)
        setLoading(null)
      }
    } catch {
      setError('Erro inesperado ao abrir o portal.')
      setLoading(null)
    }
  }

  async function handleCancel() {
    if (
      !window.confirm(
        'Cancelar a assinatura? Seu acesso continua até o fim do período já pago.',
      )
    ) {
      return
    }
    setLoading('cancel')
    setError(null)
    try {
      const res = await cancelSubscription()
      if ('ok' in res) {
        window.location.reload()
      } else {
        setError(`Não foi possível cancelar (${res.error}).`)
        setLoading(null)
      }
    } catch {
      setError('Erro inesperado ao cancelar.')
      setLoading(null)
    }
  }

  // Cancelamento já agendado: mostra estado, sem botão de cancelar de novo.
  if (cancelAtPeriodEnd) {
    return (
      <div className="flex items-center gap-2">
        <button
          className="btn btn-ghost"
          onClick={handlePortal}
          disabled={!isStripe || loading !== null}
        >
          {loading === 'portal' ? 'Abrindo…' : 'Gerenciar pagamento'}
        </button>
        <span className="text-[12.5px] font-semibold text-amber-700">
          Cancelamento agendado
        </span>
        {error && <span className="text-[12px] text-red-500">{error}</span>}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-[12px] text-red-500">{error}</span>}
      <button
        className="btn btn-ghost"
        onClick={handlePortal}
        disabled={!isStripe || loading !== null}
        title={isStripe ? undefined : 'Disponível para pagamento via cartão'}
      >
        {loading === 'portal' ? 'Abrindo…' : 'Gerenciar pagamento'}
      </button>
      <button
        className="btn btn-secondary"
        onClick={handleCancel}
        disabled={!isActive || !isStripe || loading !== null}
      >
        {loading === 'cancel' ? 'Cancelando…' : 'Cancelar assinatura'}
      </button>
    </div>
  )
}
