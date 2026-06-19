'use client'

import { useState } from 'react'
import { Icon, Chip } from '@/components/painel/Icons'
import {
  PLANS_DISPLAY,
  COMPARE_ROWS,
  FAQS,
  type PlanDisplay,
} from '@/lib/plans-display'

/* ───────── Toggle Mensal / Anual ───────── */
function BillingToggle({
  value,
  onChange,
}: {
  value: 'monthly' | 'annual'
  onChange: (v: 'monthly' | 'annual') => void
}) {
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
            className={value === 'annual' ? 'on' : ''}
            onClick={() => onChange('annual')}
          >
            Anual <span className="badge">−16%</span>
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
}: {
  plan: PlanDisplay
  currentPlanId: PlanDisplay['id'] | null
}) {
  const isCurrent = plan.id === currentPlanId
  const cls = `plan ${plan.featured ? 'featured' : ''} ${isCurrent ? 'current' : ''}`
  const btnCls = plan.featured
    ? 'btn btn-on-brand'
    : 'btn btn-secondary'
  const ctaLabel = isCurrent ? 'Plano atual' : plan.cta

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
        <div className="plan-msgs tabular">Indefinido</div>
        <div className="plan-msgs-suffix">mensagens / mês</div>
      </div>

      <div className="plan-price-row">
        <span className="plan-amt">Indefinido</span>
      </div>

      <button type="button" className={btnCls} disabled={isCurrent}>
        {ctaLabel}
        {!isCurrent && <Icon name="arrow" className="w-3.5 h-3.5" />}
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
              Sobre limite de mensagens, troca de plano e cancelamento.
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
}: {
  currentPlanId: PlanDisplay['id'] | null
}) {
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly')
  const [cmpOpen, setCmpOpen] = useState(false)

  return (
    <>
      <section className="mt-8 space-y-5">
        <BillingToggle value={billing} onChange={setBilling} />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-3">
          {PLANS_DISPLAY.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              currentPlanId={currentPlanId}
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
