import { NextResponse, type NextRequest } from 'next/server'
import { getMpPayment } from '@/lib/mercadopago'
import { createClient } from '@/lib/supabase/server'
import { getAppUrl } from '@/lib/app-url'
import { PLANS, type PlanId } from '@/lib/plans'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Cria um pagamento Pix no Mercado Pago para a loja autenticada. Retorna
// `qr_code` (copia-cola), `qr_code_base64` (PNG), `ticket_url` (página MP) e
// `payment_id` (pra polling). Validação de auth via cookie Supabase.

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Vendedor não paga — só o dono.
  const { data: membership } = await supabase
    .from('store_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (membership?.role === 'agent') {
    return NextResponse.json({ error: 'agent_cannot_pay' }, { status: 403 })
  }

  let body: { plan_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const planIdRaw = body.plan_id ?? 'pro'
  if (!(planIdRaw in PLANS)) {
    return NextResponse.json({ error: 'unknown_plan' }, { status: 400 })
  }
  const planId = planIdRaw as PlanId
  const plan = PLANS[planId]

  const siteUrl = getAppUrl()

  try {
    const payment = await getMpPayment().create({
      body: {
        transaction_amount: plan.price_brl / 100,
        payment_method_id: 'pix',
        payer: {
          email: user.email ?? `store-${user.id}@lue.fz`,
        },
        description: `${plan.name} - ${plan.duration_days} dias`,
        external_reference: user.id,
        notification_url: `${siteUrl}/api/mercadopago/webhook`,
        metadata: { store_id: user.id, plan_id: planId },
      },
    })

    const tx = payment.point_of_interaction?.transaction_data
    if (!tx?.qr_code) {
      console.error('MP pix: missing transaction_data', payment.id)
      return NextResponse.json({ error: 'pix_unavailable' }, { status: 502 })
    }

    return NextResponse.json({
      payment_id: String(payment.id),
      qr_code: tx.qr_code,
      qr_code_base64: tx.qr_code_base64 ?? null,
      ticket_url: tx.ticket_url ?? null,
      expires_at: payment.date_of_expiration ?? null,
    })
  } catch (err) {
    console.error('MP pix create error', err)
    return NextResponse.json({ error: 'mp_failed' }, { status: 502 })
  }
}
