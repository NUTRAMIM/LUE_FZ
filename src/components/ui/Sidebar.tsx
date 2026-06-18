'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
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
  { href: '/conversas', label: 'Conversas', iconName: 'msgSq' },
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

function SuaUrlPublica({
  slug,
  appUrl,
}: {
  slug: string | null
  appUrl: string
}) {
  const [copied, setCopied] = useState(false)
  const host = appUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')

  async function handleCopy() {
    if (!slug) return
    try {
      await navigator.clipboard.writeText(`${appUrl}/chat/${slug}`)
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
        <div className="text-[12.5px] mt-1.5 text-ink-200 leading-snug break-all">
          <span className="font-mono text-brand-200">{host}/chat/</span>
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

function SidebarBody({
  role,
  slug,
  appUrl,
  pathname,
  onNavigate,
  isAdmin,
  storeName,
  email,
}: {
  role: StoreRole
  slug: string | null
  appUrl: string
  pathname: string | null
  onNavigate?: () => void
  isAdmin: boolean
  storeName: string | null
  email: string | null
}) {
  const isOwner = role !== 'agent'
  const userInitials = (email?.trim()?.[0] ?? '?').toUpperCase()
  const isConversas = pathname?.startsWith('/conversas') ?? false
  const isLoja = pathname?.startsWith('/loja') ?? false

  return (
    <>
      {/* Brand */}
      <div className="px-6 pt-6 pb-5 md:pt-7 md:pb-6 flex items-center gap-3 shrink-0">
        <div
          className="font-display font-extrabold tracking-tight leading-none"
          style={{ fontSize: 30 }}
        >
          <span className="lue-l">L</span>
          <span className="text-ink-900">UE</span>
        </div>
        <div className="ml-auto eyebrow text-ink-400">FZ</div>
      </div>

      {/* Org switcher */}
      <button className="mx-3 mb-5 p-3 rounded-2xl bg-ink-50 hover:bg-ink-100 transition-colors flex items-center gap-3 text-left shrink-0">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center font-display font-bold text-white text-[13px]">
          FZ
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink-900 truncate">
            {storeName || 'Minha loja'}
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
                <Link
                  href={href}
                  onClick={onNavigate}
                  className={`nav-link ${active ? 'active' : ''}`}
                >
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
                      onClick={onNavigate}
                      className={`nav-link ${active ? 'active' : ''}`}
                    >
                      <Icon name={iconName} className="w-[18px] h-[18px]" />
                      {label}
                    </Link>
                  </li>
                )
              })}
              {isAdmin && (
                <li>
                  <Link
                    href="/painel/_internal"
                    onClick={onNavigate}
                    className={`nav-link ${
                      pathname?.startsWith('/painel/_internal') ? 'active' : ''
                    }`}
                  >
                    <Icon name="shield" className="w-[18px] h-[18px]" />
                    Admin
                  </Link>
                </li>
              )}
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
            <SuaUrlPublica slug={slug} appUrl={appUrl} />
          </>
        ) : null}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-ink-200 shrink-0">
        <div className="flex items-center gap-3 px-2 py-1.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-300 to-brand-500 font-display font-bold text-white flex items-center justify-center text-[11px]">
            {userInitials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-ink-900 truncate">
              {email ?? 'Minha conta'}
            </div>
            <div className="eyebrow text-ink-500 truncate">
              {isOwner ? 'DONO DA LOJA' : 'OPERADOR'}
            </div>
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
        <a
          href="/termos"
          className="mt-1 block px-2 text-[11px] text-ink-400 hover:text-ink-600"
        >
          Termos de Uso e Privacidade
        </a>
      </div>
    </>
  )
}

export function Sidebar({
  role,
  slug,
  appUrl,
  isAdmin,
  storeName,
  email,
}: {
  role: StoreRole
  slug: string | null
  appUrl: string
  isAdmin: boolean
  storeName: string | null
  email: string | null
}) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [lastPath, setLastPath] = useState(pathname)

  // Fecha drawer ao navegar — set-state-em-render é a forma React-idiomática
  // de zerar estado quando uma prop/valor reativo muda.
  if (lastPath !== pathname) {
    setLastPath(pathname)
    if (mobileOpen) setMobileOpen(false)
  }

  // Trava scroll do body enquanto o drawer mobile está aberto
  useEffect(() => {
    if (!mobileOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileOpen])

  return (
    <>
      {/* Mobile topbar — só visível abaixo de md */}
      <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 bg-white border-b border-ink-200 px-4 py-3 shrink-0">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menu"
          aria-expanded={mobileOpen}
          className="-ml-1.5 p-1.5 rounded-lg text-ink-700 hover:bg-ink-50 active:bg-ink-100"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div
          className="font-display font-extrabold leading-none"
          style={{ fontSize: 22 }}
        >
          <span className="lue-l">L</span>
          <span className="text-ink-900">UE</span>
        </div>
        <div className="ml-auto eyebrow text-ink-400">FZ</div>
      </header>

      {/* Desktop sidebar — sticky */}
      <aside
        className="hidden md:flex md:sticky md:top-0 md:w-64 md:h-screen md:shrink-0 bg-white border-r border-ink-200 flex-col"
      >
        <SidebarBody
          role={role}
          slug={slug}
          appUrl={appUrl}
          pathname={pathname}
          isAdmin={isAdmin}
          storeName={storeName}
          email={email}
        />
      </aside>

      {/* Mobile drawer — só renderiza quando aberto */}
      {mobileOpen && (
        <>
          <div
            aria-hidden
            onClick={() => setMobileOpen(false)}
            className="md:hidden fixed inset-0 z-40 bg-black/40"
          />
          <aside
            role="dialog"
            aria-label="Menu"
            className="md:hidden fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] bg-white border-r border-ink-200 flex flex-col shadow-xl"
            style={{ height: '100dvh' }}
          >
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Fechar menu"
              className="absolute top-3 right-3 w-8 h-8 rounded-lg text-ink-500 hover:text-ink-900 hover:bg-ink-100 flex items-center justify-center z-10"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
            <SidebarBody
              role={role}
              slug={slug}
              appUrl={appUrl}
              pathname={pathname}
              onNavigate={() => setMobileOpen(false)}
              isAdmin={isAdmin}
              storeName={storeName}
              email={email}
            />
          </aside>
        </>
      )}
    </>
  )
}
