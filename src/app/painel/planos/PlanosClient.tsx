'use client'

import { useState } from 'react'
import { Icon, Chip } from '@/components/painel/Icons'
import {
  PLANS_DISPLAY,
  COMPARE_ROWS,
  FAQS,
  type PlanDisplay,
} from '@/lib/plans-display'
import { PLANS, isPlanId, type BillingCycle } from '@/lib/plans'
import { createCheckoutSession, changePlan } from '@/actions/billing'

// Maior desconto trimestral entre os planos (trimestral vs 3× mensal).
// Enquanto o trimestral for placeholder = 3× mensal, isto é 0 e o badge some.
function maxQuarterlyDiscountPct(): number {
  let max = 0
  for (const id of Object.keys(PLANS) as Array<keyof typeof PLANS>) {
    const p = PLANS[id]
    const full = p.monthly.price_brl * 3
    if (full > 0) {
      const pct = Math.round((1 - p.quarterly.price_brl / full) * 100)
      if (pct > max) max = pct
    }
  }
  return max
}

// Preço formatado em reais (price_brl está em centavos).
function reais(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR')
}

/* ───────── Toggle Mensal / Trimestral ───────── */
function BillingToggle({
  value,
  onChange,
}: {
  value: BillingCycle
  onChange: (v: BillingCycle) => void
}) {
  const discount = maxQuarterlyDiscountPct()
  return (
    <div className="flex items-center justify-between flex-wrap gap-3">
      <div>
        <div className="eyebrow text-ink-500">ESCOLHA UM PLANO</div>
        <h3
          className="font-display font-bold text-ink-900 mt-1"
          style={{ fontSize: '18px', lineHeight: 1.2 }}
        >
          Pelo volume de conversas da sua loja
        </h3>
      </div>
      <div className="flex items-center gap-3">
        <div className="seg">
          <button
            type="button"
            className={value === 'monthly' ? 'on' : ''}
            onClick={() => onChange('monthly')}
          >
            Mensal
          </button>
          <button
            type="button"
            className={value === 'quarterly' ? 'on' : ''}
            onClick={() => onChange('quarterly')}
          >
            Trimestral
            {discount > 0 && <span className="badge"> −{discount}%</span>}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ───────── Card de plano ───────── */
function PlanCard({
  plan,
  currentPlanId,
  cycle,
  busy,
  onSelect,
}: {
  plan: PlanDisplay
  currentPlanId: PlanDisplay['id'] | null
  cycle: BillingCycle
  busy: boolean
  onSelect: (planId: PlanDisplay['id']) => void
}) {
  const isCurrent = plan.id === currentPlanId
  const cls = `plan ${plan.featured ? 'featured' : ''} ${isCurrent ? 'current' : ''}`
  const btnCls = plan.featured ? 'btn btn-on-brand' : 'btn btn-secondary'
  const ctaLabel = isCurrent ? 'Plano atual' : plan.cta

  // Preço/limite reais vêm de PLANS (fonte única). PLANS_DISPLAY só dá copy.
  const real = isPlanId(plan.id) ? PLANS[plan.id] : null
  const priceCents = real ? real[cycle].price_brl : null
  const priceSuffix = cycle === 'quarterly' ? '/trimestre' : '/mês'
  const perMonth =
    real && cycle === 'quarterly' ? Math.round(real.quarterly.price_brl / 3) : null

  return (
    <article className={cls}>
      {plan.featured && !isCurrent && (
        <span className="plan-badge">
          <Icon name="sparkle" />
          {plan.badge}
        </span>
      )}
      {isCurrent && (
        <span className="plan-badge">
          <Icon name="check" />
          Plano atual
        </span>
      )}

      <div className="plan-name">{plan.name}</div>
      <div className="plan-for">{plan.for}</div>

      <div>
        <div className="plan-msgs tabular">
          {real ? real.convsLimit.toLocaleString('pt-BR') : '—'}
        </div>
        <div className="plan-msgs-suffix">conversas / mês</div>
      </div>

      <div className="plan-price-row">
        <span className="plan-amt">
          {priceCents !== null ? `R$ ${reais(priceCents)}` : '—'}
        </span>
        {priceCents !== null && (
          <span className="plan-price-suffix"> {priceSuffix}</span>
        )}
      </div>
      {perMonth !== null && (
        <div className="text-[11.5px] text-ink-500 -mt-1">
          equivale a R$ {reais(perMonth)}/mês
        </div>
      )}

      <button
        type="button"
        className={btnCls}
        disabled={isCurrent || busy}
        onClick={() => onSelect(plan.id)}
      >
        {busy ? 'Aguarde…' : ctaLabel}
        {!isCurrent && !busy && <Icon name="arrow" className="w-3.5 h-3.5" />}
      </button>

      {plan.intro && <div className="plan-feats-intro">{plan.intro}</div>}
      <ul className="plan-feats">
        {plan.feats.map((f, i) => (
          <li key={i}>
            <span className="check">
              <Icon name="check" />
            </span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </article>
  )
}

/* ───────── Comparativo ───────── */
function Compare({
  open,
  setOpen,
}: {
  open: boolean
  setOpen: (v: boolean) => void
}) {
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <Chip tone="slate" name="switchH" />
          <div>
            <div
              className="font-display font-bold text-ink-900"
              style={{ fontSize: '15px' }}
            >
              Comparativo de recursos
            </div>
            <div className="text-[12px] text-ink-500">
              Veja tudo o que cada plano entrega, lado a lado.
            </div>
          </div>
        </div>
        <Icon
          name="chev"
          className={`w-4 h-4 text-ink-500 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div className="border-t border-ink-100">
          <div className="cmp-row head">
            <div
              className="feat eyebrow text-ink-500"
              style={{ fontWeight: 600 }}
            >
              RECURSO
            </div>
            <div
              className="cell eyebrow"
              style={{ color: '#171B2E', fontWeight: 600 }}
            >
              Essencial
            </div>
            <div
              className="cell eyebrow col-featured"
              style={{ fontWeight: 600 }}
            >
              Profissional
            </div>
            <div
              className="cell eyebrow"
              style={{ color: '#171B2E', fontWeight: 600 }}
            >
              Performance
            </div>
          </div>
          {COMPARE_ROWS.map((row, i) => (
            <div className="cmp-row" key={i}>
              <div className="feat">
                {row.feat}
                {row.sub && <span className="sub">{row.sub}</span>}
              </div>
              {row.vals.map((v, ci) => (
                <div
                  key={ci}
                  className={`cell ${ci === 1 ? 'col-featured' : ''}`}
                >
                  {v === true ? (
                    <span className="check-y">
                      <Icon name="check" />
                    </span>
                  ) : v === false ? (
                    <span className="check-n">—</span>
                  ) : (
                    <span className="text-[12.5px] font-semibold text-ink-800">
                      {v}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
          <div className="cmp-foot">
            → mudança de plano é proporcional aos dias restantes do mês ·
            cobrança via mercado pago
          </div>
        </div>
      )}
    </div>
  )
}

/* ───────── FAQ ───────── */
function FAQ() {
  const [open, setOpen] = useState(0)
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <Chip tone="info" name="infoCircle" />
          <div>
            <div
              className="font-display font-bold text-ink-900"
              style={{ fontSize: '15px' }}
            >
              Perguntas frequentes
            </div>
            <div className="text-[12px] text-ink-500">
              Sobre limite de conversas, troca de plano e cancelamento.
            </div>
          </div>
        </div>
        <a className="text-[12.5px] font-semibold text-brand-700 hover:text-brand-800 inline-flex items-center gap-1 cursor-pointer">
          Falar com suporte <Icon name="arrow" className="w-3.5 h-3.5" />
        </a>
      </div>
      <div className="mt-2">
        {FAQS.map((f, i) => (
          <details
            key={i}
            className="faq"
            open={open === i}
            onToggle={(e) => {
              const el = e.currentTarget as HTMLDetailsElement
              if (el.open) setOpen(i)
              else if (open === i) setOpen(-1)
            }}
          >
            <summary>
              <span>{f.q}</span>
              <span className="plus">
                <Icon name="plus" />
              </span>
            </summary>
            <div className="answer">{f.a}</div>
          </details>
        ))}
      </div>
    </div>
  )
}

/* ───────── Interactive section (toggle + cards + compare + FAQ) ───────── */
export function PlanosInteractive({
  currentPlanId,
  isActive,
  provider,
}: {
  currentPlanId: PlanDisplay['id'] | null
  isActive: boolean
  provider: 'stripe' | 'mercadopago' | 'manual' | null
}) {
  const [billing, setBilling] = useState<BillingCycle>('monthly')
  const [cmpOpen, setCmpOpen] = useState(false)
  const [busy, setBusy] = useState<PlanDisplay['id'] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isStripeActive = isActive && provider === 'stripe'

  async function handleSelect(planId: PlanDisplay['id']) {
    if (!isPlanId(planId)) return
    setError(null)

    // Assinatura Stripe ativa: troca de plano inline (proration).
    if (isStripeActive) {
      setBusy(planId)
      try {
        const res = await changePlan(planId, billing)
        if ('ok' in res) {
          window.location.reload()
        } else {
          setError(`Não foi possível trocar de plano (${res.error}).`)
          setBusy(null)
        }
      } catch {
        setError('Erro inesperado ao trocar de plano.')
        setBusy(null)
      }
      return
    }

    // Nova assinatura (sem plano ativo ou pago via PIX): leva para a página de
    // checkout, que oferece cartão e Pix. Tenta o checkout de cartão direto
    // para o ciclo escolhido; se não houver Price configurado, manda para /planos.
    setBusy(planId)
    try {
      const res = await createCheckoutSession(planId, billing)
      if ('url' in res) {
        window.location.href = res.url
      } else {
        window.location.href = '/planos'
      }
    } catch {
      window.location.href = '/planos'
    }
  }

  return (
    <>
      <section className="mt-8 space-y-5">
        <BillingToggle value={billing} onChange={setBilling} />
        {error && <p className="text-[12.5px] text-red-500">{error}</p>}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-3">
          {PLANS_DISPLAY.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              currentPlanId={currentPlanId}
              cycle={billing}
              busy={busy === p.id}
              onSelect={handleSelect}
            />
          ))}
        </div>
      </section>

      <section className="mt-6">
        <Compare open={cmpOpen} setOpen={setCmpOpen} />
      </section>

      <section className="mt-6">
        <FAQ />
      </section>
    </>
  )
}
