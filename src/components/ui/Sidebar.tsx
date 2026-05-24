'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { logout } from '@/actions/auth'
import { Icon, type IconName } from '@/components/painel/Icons'
import type { StoreRole } from '@/lib/store-role'

type NavItem = {
  href: string
  label: string
  iconName: IconName
  badge?: string
  ownerOnly?: boolean
}

const NAV: NavItem[] = [
  { href: '/painel', label: 'Painel', iconName: 'trend', ownerOnly: true },
  { href: '/conversas', label: 'Conversas', iconName: 'msgSq', badge: '12' },
  { href: '/leads', label: 'Leads', iconName: 'inbox' },
  { href: '/estoque', label: 'Estoque', iconName: 'package', ownerOnly: true },
  { href: '/loja', label: 'Loja', iconName: 'store', ownerOnly: true },
  { href: '/equipe', label: 'Equipe', iconName: 'userX', ownerOnly: true },
]

const NAV_ACCOUNT: NavItem[] = [
  { href: '/painel/planos', label: 'Planos & assinatura', iconName: 'sparkle', ownerOnly: true },
]

const OPERADORES = [
  { n: 'Mariana A.', i: 'MA', c: '#A78BFA', s: 'em 3 chats' },
  { n: 'Bruno T.', i: 'BT', c: '#FBBF24', s: 'em 2 chats' },
  { n: 'Camila R.', i: 'CR', c: '#34D399', s: 'em 4 chats' },
  { n: 'Diego P.', i: 'DP', c: '#60A5FA', s: 'ocioso' },
]

function ProximaNaFila() {
  return (
    <div className="mt-6 mx-1 p-3.5 rounded-2xl bg-ink-900 text-white relative overflow-hidden">
      <div
        aria-hidden
        className="absolute -top-10 -right-10 w-32 h-32 rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(167,139,250,0.30), transparent 65%)',
        }}
      />
      <div className="relative">
        <div className="flex items-center gap-2">
          <span className="live-dot" />
          <span className="eyebrow text-brand-300">PRÓXIMA NA FILA</span>
        </div>
        <div className="mt-2.5 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-brand-400 font-display font-bold text-brand-950 text-[11px] flex items-center justify-center">
            RC
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold truncate">Renata Costa</div>
            <div className="text-[11.5px] text-ink-300 tabular">aguardando há 8m</div>
          </div>
        </div>
        <button className="mt-3 w-full bg-white text-ink-900 hover:bg-brand-100 transition-colors text-[12.5px] font-semibold py-2 rounded-lg">
          Assumir conversa
        </button>
      </div>
    </div>
  )
}

function OperadoresOnline() {
  return (
    <>
      <div className="eyebrow text-ink-400 px-3 mt-7 mb-2">
        OPERADORES · ONLINE
      </div>
      <ul className="space-y-1.5 px-1">
        {OPERADORES.map((o) => (
          <li
            key={o.n}
            className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-ink-50"
          >
            <div className="relative">
              <div
                className="w-7 h-7 rounded-full font-display font-bold text-white text-[10.5px] flex items-center justify-center"
                style={{ background: o.c }}
              >
                {o.i}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-success-500 ring-2 ring-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold text-ink-900 truncate leading-tight">
                {o.n}
              </div>
              <div className="text-[10.5px] text-ink-500 truncate leading-tight">
                {o.s}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

const LOJA_SECTIONS = [
  { href: '#sec-identidade', label: 'Identidade' },
  { href: '#sec-contato', label: 'Contato' },
  { href: '#sec-atendimento', label: 'Atendimento (IA)' },
  { href: '#sec-operacao', label: 'Operação' },
]

function NestaPaginaLoja() {
  return (
    <>
      <div className="eyebrow text-ink-400 px-3 mt-7 mb-2">NESTA PÁGINA</div>
      <ul className="space-y-1 text-[12.5px]">
        {LOJA_SECTIONS.map((s) => (
          <li key={s.href}>
            <a
              href={s.href}
              className="block px-3 py-1.5 rounded-md text-ink-600 hover:text-brand-700 hover:bg-brand-50"
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </>
  )
}

function SuaUrlPublica({ slug }: { slug: string | null }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (!slug) return
    const base =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ??
      (typeof window !== 'undefined' ? window.location.origin : '')
    try {
      await navigator.clipboard.writeText(`${base}/chat/${slug}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      // ignore
    }
  }

  return (
    <div className="mt-6 mx-1 p-3.5 rounded-2xl bg-ink-900 text-white relative overflow-hidden">
      <div
        aria-hidden
        className="absolute -top-10 -right-10 w-32 h-32 rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(167,139,250,0.30), transparent 65%)',
        }}
      />
      <div className="relative">
        <div className="flex items-center gap-2">
          <span className="live-dot" />
          <span className="eyebrow text-brand-300">SUA URL PÚBLICA</span>
        </div>
        <div className="text-[12.5px] mt-1.5 text-ink-200 leading-snug">
          <span className="font-mono text-brand-200">lue.fz/chat/</span>
          <span className="font-mono text-white font-semibold">
            {slug ?? '…'}
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!slug}
          className="mt-2.5 w-full bg-white/10 hover:bg-white/15 text-white text-[12px] font-semibold py-1.5 rounded-lg ring-1 ring-white/15 disabled:opacity-50"
        >
          {copied ? 'Copiado!' : 'Copiar link'}
        </button>
      </div>
    </div>
  )
}

function AgenteIA() {
  return (
    <div className="mt-6 mx-1 p-3.5 rounded-2xl bg-ink-900 text-white relative overflow-hidden">
      <div
        aria-hidden
        className="absolute -top-10 -right-10 w-32 h-32 rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(167,139,250,0.30), transparent 65%)',
        }}
      />
      <div className="relative">
        <div className="flex items-center gap-2">
          <span className="live-dot" />
          <span className="eyebrow text-brand-300">AGENTE IA</span>
        </div>
        <div className="text-[13px] mt-1.5 text-ink-200 leading-snug">
          Auto-respondendo em{' '}
          <span className="font-semibold text-white">2 conversas</span> agora.
        </div>
        <button className="mt-2.5 w-full bg-white/10 hover:bg-white/15 text-white text-[12px] font-semibold py-1.5 rounded-lg ring-1 ring-white/15">
          Configurar IA
        </button>
      </div>
    </div>
  )
}

export function Sidebar({
  role,
  slug,
}: {
  role: StoreRole
  slug: string | null
}) {
  const pathname = usePathname()
  // Fail-open vive em getSidebarData (server-side); aqui o role chega
  // determinístico via prop.
  const isOwner = role !== 'agent'

  const isConversas = pathname?.startsWith('/conversas') ?? false
  const isLoja = pathname?.startsWith('/loja') ?? false

  return (
    <aside
      className="w-64 shrink-0 bg-white border-r border-ink-200 flex flex-col"
      style={{ height: '100vh', position: 'sticky', top: 0 }}
    >
      {/* Brand */}
      <div className="px-6 pt-7 pb-6 flex items-center gap-3">
        <div
          className="font-display font-extrabold tracking-tight leading-none"
          style={{ fontSize: 32 }}
        >
          <span className="lue-l">L</span>
          <span className="text-ink-900">UE</span>
        </div>
        <div className="ml-auto eyebrow text-ink-400">FZ</div>
      </div>

      {/* Org switcher */}
      <button className="mx-3 mb-5 p-3 rounded-2xl bg-ink-50 hover:bg-ink-100 transition-colors flex items-center gap-3 text-left">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center font-display font-bold text-white text-[13px]">
          FZ
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink-900 truncate">
            Floricultura Zaira
          </div>
          <div className="eyebrow text-ink-500 mt-0.5">PLANO PRO</div>
        </div>
        <Icon name="chev" className="w-4 h-4 text-ink-400" />
      </button>

      {/* Nav */}
      <nav className="px-3 flex-1 overflow-y-auto">
        <div className="eyebrow text-ink-400 px-3 mb-2">PRINCIPAL</div>
        <ul className="space-y-1">
          {NAV.filter((item) => isOwner || !item.ownerOnly).map(({ href, label, iconName, badge }) => {
            const active =
              pathname === href || pathname?.startsWith(href + '/')
            return (
              <li key={href}>
                <Link href={href} className={`nav-link ${active ? 'active' : ''}`}>
                  <Icon name={iconName} className="w-[18px] h-[18px]" />
                  {label}
                  {badge && (
                    <span
                      className={`ml-auto tabular text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${
                        active
                          ? 'bg-brand-100 text-brand-700'
                          : 'bg-ink-100 text-ink-600'
                      }`}
                    >
                      {badge}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>

        {isOwner && (
          <>
            <div className="eyebrow text-ink-400 px-3 mb-2 mt-6">CONTA</div>
            <ul className="space-y-1">
              {NAV_ACCOUNT.map(({ href, label, iconName }) => {
                const active =
                  pathname === href || pathname?.startsWith(href + '/')
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      className={`nav-link ${active ? 'active' : ''}`}
                    >
                      <Icon name={iconName} className="w-[18px] h-[18px]" />
                      {label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        {/* Context-aware bottom widget */}
        {isConversas ? (
          <>
            <OperadoresOnline />
            <AgenteIA />
          </>
        ) : isLoja ? (
          <>
            <NestaPaginaLoja />
            <SuaUrlPublica slug={slug} />
          </>
        ) : (
          <ProximaNaFila />
        )}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-ink-200">
        <div className="flex items-center gap-3 px-2 py-1.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-300 to-brand-500 font-display font-bold text-white flex items-center justify-center text-[11px]">
            MA
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-ink-900 truncate">
              Mariana Alves
            </div>
            <div className="eyebrow text-ink-500 truncate">OPERADORA</div>
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="w-7 h-7 rounded-lg text-ink-500 hover:text-ink-900 hover:bg-ink-100 flex items-center justify-center"
              title="Sair"
            >
              <Icon name="logout" className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  )
}
