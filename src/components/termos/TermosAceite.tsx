'use client'

import { useState } from 'react'
import { acceptTerms } from '@/actions/terms'

// Envolve o documento (passado como children) com checkbox obrigatorio e
// botao de aceite. O botao so habilita quando a caixa esta marcada.
export function TermosAceite({ children }: { children: React.ReactNode }) {
  const [agreed, setAgreed] = useState(false)

  return (
    <div className="mx-auto max-w-[760px] px-4 py-8 sm:px-6">
      <header className="mb-6">
        <div className="eyebrow text-ink-500">OBRIGATÓRIO · ANTES DE COMEÇAR</div>
        <h1 className="mt-1.5 font-display text-[24px] font-bold tracking-tight text-ink-900">
          Termos de Uso e Política de Privacidade
        </h1>
        <p className="mt-1.5 text-[13.5px] text-ink-500">
          Leia e confirme para acessar seu painel.
        </p>
      </header>

      <div className="max-h-[55vh] overflow-y-auto rounded-2xl border border-ink-200 bg-white p-5 sm:p-7">
        {children}
      </div>

      <form action={acceptTerms} className="mt-5">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-ink-50 p-4">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-brand-600"
          />
          <span className="text-[13.5px] text-ink-800">
            Li e concordo com os Termos de Uso e a Política de Privacidade.
          </span>
        </label>

        <button
          type="submit"
          disabled={!agreed}
          className="mt-4 w-full rounded-xl bg-brand-600 px-4 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Aceitar e continuar
        </button>
      </form>
    </div>
  )
}
