'use client'

import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { createCheckoutSession, getCurrentSubscription } from '@/actions/billing'
import type { PlanId, BillingCycle } from '@/lib/plans'

interface PixData {
  payment_id: string
  qr_code: string
  qr_code_base64: string | null
  ticket_url: string | null
  expires_at: string | null
}

export function CheckoutClient({ planId }: { planId: PlanId }) {
  const [loading, setLoading] = useState<'stripe' | 'pix' | null>(null)
  const [pix, setPix] = useState<PixData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [cycle, setCycle] = useState<BillingCycle>('monthly')
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Renderiza o QR no canvas quando o Pix é criado.
  useEffect(() => {
    if (!pix || !canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, pix.qr_code, {
      width: 240,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    }).catch((err) => console.error('QR render error', err))
  }, [pix])

  // Polling: enquanto o usuário não pagou, checa a assinatura a cada 4s.
  // Quando ativa, redireciona pro painel. O webhook do MP é quem altera o
  // status no banco; aqui só observamos.
  useEffect(() => {
    if (!pix) return
    const interval = setInterval(async () => {
      try {
        const sub = await getCurrentSubscription()
        if (sub.isActive) {
          window.location.href = '/painel'
        }
      } catch (err) {
        console.error('poll error', err)
      }
    }, 4000)
    return () => clearInterval(interval)
  }, [pix])

  async function handleStripe() {
    setLoading('stripe')
    setError(null)
    try {
      const res = await createCheckoutSession(planId, cycle)
      if ('url' in res) {
        window.location.href = res.url
      } else {
        setError(`Falha ao criar checkout (${res.error})`)
        setLoading(null)
      }
    } catch (err) {
      console.error(err)
      setError('Erro inesperado ao iniciar checkout')
      setLoading(null)
    }
  }

  async function handlePix() {
    setLoading('pix')
    setError(null)
    try {
      const res = await fetch('/api/mercadopago/pix', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan_id: planId, cycle }),
      })
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errBody.error ?? `http_${res.status}`)
      }
      const data = (await res.json()) as PixData
      setPix(data)
    } catch (err) {
      console.error('pix error', err)
      setError(err instanceof Error ? `Falha Pix (${err.message})` : 'Falha Pix')
    } finally {
      setLoading(null)
    }
  }

  async function handleCopy() {
    if (!pix) return
    try {
      await navigator.clipboard.writeText(pix.qr_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore — usuário pode selecionar manualmente
    }
  }

  if (pix) {
    return (
      <div className="space-y-5">
        <p className="text-sm text-neutral-300">
          Abra o app do seu banco, escolha <strong>Pagar com Pix</strong> e escaneie:
        </p>
        <div className="flex justify-center rounded-xl bg-white p-4">
          <canvas ref={canvasRef} />
        </div>
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-neutral-500">
            Ou copie o código Pix
          </p>
          <div className="flex gap-2">
            <code className="flex-1 truncate rounded-lg bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-400">
              {pix.qr_code}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-lg bg-neutral-800 px-4 py-2 text-xs font-medium transition hover:bg-neutral-700"
            >
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        </div>
        <p className="text-center text-xs text-neutral-500">
          Aguardando confirmação do pagamento... A página atualizará automaticamente.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 rounded-xl border border-neutral-800 p-1 text-xs">
        <button
          type="button"
          onClick={() => setCycle('monthly')}
          className={`flex-1 rounded-lg py-2 font-medium transition ${
            cycle === 'monthly' ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-400'
          }`}
        >
          Mensal
        </button>
        <button
          type="button"
          onClick={() => setCycle('quarterly')}
          className={`flex-1 rounded-lg py-2 font-medium transition ${
            cycle === 'quarterly' ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-400'
          }`}
        >
          Trimestral
        </button>
      </div>
      <button
        type="button"
        onClick={handleStripe}
        disabled={loading !== null}
        className="w-full rounded-xl bg-white py-3 text-sm font-semibold text-neutral-950 transition hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading === 'stripe' ? 'Redirecionando...' : 'Pagar com Cartão'}
      </button>
      <button
        type="button"
        onClick={handlePix}
        disabled={loading !== null}
        className="w-full rounded-xl border border-neutral-700 bg-neutral-900 py-3 text-sm font-semibold text-neutral-100 transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading === 'pix' ? 'Gerando QR Code...' : 'Pagar com Pix'}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
