import { NextResponse, type NextRequest } from 'next/server'
import crypto from 'node:crypto'
import { getMpPayment } from '@/lib/mercadopago'
import { createAdminClient } from '@/lib/supabase/admin'
import { PLANS, type PlanId } from '@/lib/plans'
import type { Json } from '@/types/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Webhook do Mercado Pago. Recebe notificações de pagamento (Pix).
//
// Validação de assinatura (newer MP API):
//   header `x-signature` = "ts=...,v1=hmac_sha256_hex"
//   header `x-request-id`
//   manifest = `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
//   HMAC-SHA256(manifest, MERCADOPAGO_WEBHOOK_SECRET) deve bater com v1.
// Se o secret não está configurado (placeholder), pula validação e loga
// warning — útil em dev local com `ngrok` antes de configurar webhook no
// dashboard MP. EM PRODUÇÃO sem secret a verificação fica frouxa, atenção.
//
// Idempotência: PK = `mp_<data.id>_<action>` em payment_events.
//
// Pagamento aprovado (status='approved') → upsert subscription com
// status='active', current_period_end = now() + plan.duration_days.

interface MpWebhookPayload {
  type?: string
  action?: string
  data?: { id?: string | number }
}

function verifySignature(
  sigHeader: string,
  requestId: string,
  dataId: string,
  secret: string,
): boolean {
  const parts = Object.fromEntries(
    sigHeader.split(',').map((p) => {
      const [k, v] = p.trim().split('=')
      return [k, v ?? '']
    }),
  )
  const ts = parts.ts
  const v1 = parts.v1
  if (!ts || !v1) return false

  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`
  const computed = crypto.createHmac('sha256', secret).update(manifest).digest('hex')
  // timingSafeEqual exige Buffers do mesmo tamanho — comparamos como hex.
  const a = Buffer.from(computed, 'hex')
  const b = Buffer.from(v1, 'hex')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  const body = await req.text()

  let payload: MpWebhookPayload
  try {
    payload = JSON.parse(body)
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 })
  }

  const dataId = payload.data?.id
  if (!dataId) {
    return new NextResponse('Missing data.id', { status: 400 })
  }
  const dataIdStr = String(dataId)

  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET
  const sigHeader = req.headers.get('x-signature')
  const requestId = req.headers.get('x-request-id')

  if (secret && secret !== 'placeholder') {
    if (!sigHeader || !requestId) {
      return new NextResponse('Missing signature headers', { status: 400 })
    }
    if (!verifySignature(sigHeader, requestId, dataIdStr, secret)) {
      return new NextResponse('Invalid signature', { status: 401 })
    }
  } else {
    console.warn(
      'MP webhook signature verification SKIPPED — MERCADOPAGO_WEBHOOK_SECRET is placeholder',
    )
  }

  const admin = createAdminClient()
  const eventType = payload.action ?? payload.type ?? 'unknown'
  const eventId = `mp_${dataIdStr}_${eventType}`

  // Idempotência
  const { error: insertError } = await admin.from('payment_events').insert({
    id: eventId,
    provider: 'mercadopago',
    type: eventType,
    payload: payload as unknown as Json,
  })
  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ received: true, duplicate: true })
    }
    console.error('payment_events insert error', insertError)
    return new NextResponse('Storage error', { status: 500 })
  }

  // Só pagamento nos interessa. Notificações de "merchant_order" ignoramos.
  if (payload.type !== 'payment') {
    return NextResponse.json({ received: true, ignored: true })
  }

  try {
    const payment = await getMpPayment().get({ id: dataIdStr })

    if (payment.status !== 'approved') {
      return NextResponse.json({ received: true, status: payment.status })
    }

    const storeId = payment.external_reference
    const meta = (payment.metadata ?? {}) as Record<string, unknown>
    // O SDK do MP normaliza `metadata` em snake_case quando lê; usamos os dois.
    const planIdRaw = (meta.plan_id ?? meta.planId ?? 'pro') as string
    const planId: PlanId = planIdRaw in PLANS ? (planIdRaw as PlanId) : 'pro'

    if (!storeId) {
      console.error('MP webhook: missing external_reference on payment', payment.id)
      return new NextResponse('Missing store_id', { status: 400 })
    }

    const plan = PLANS[planId]
    const periodEnd = new Date(Date.now() + plan.duration_days * 86_400_000).toISOString()

    const { error: upsertError } = await admin.from('store_subscriptions').upsert(
      {
        store_id: storeId,
        plan_id: planId,
        provider: 'mercadopago',
        status: 'active',
        mp_payment_id: dataIdStr,
        mp_customer_id: payment.payer?.id ? String(payment.payer.id) : null,
        current_period_end: periodEnd,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'store_id' },
    )
    if (upsertError) {
      console.error('MP subscription upsert error', upsertError)
      return new NextResponse('Storage error', { status: 500 })
    }
  } catch (err) {
    console.error('MP webhook handler error', err)
    return new NextResponse('Handler error', { status: 500 })
  }

  return NextResponse.json({ received: true })
}
