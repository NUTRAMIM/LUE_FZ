'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logout } from '@/actions/auth'
import { Wordmark } from '@/components/ui/Wordmark'
import {
  IconMessage,
  IconPackage,
  IconStore,
  IconLogOut,
} from '@/components/icons'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/painel', label: 'Conversas', icon: IconMessage },
  { href: '/estoque', label: 'Estoque', icon: IconPackage },
  { href: '/loja', label: 'Loja', icon: IconStore },
] as const

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 pt-6 pb-5">
        <Wordmark size="md" />
        <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          Painel do Operador
        </p>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname?.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all',
                active
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-brand-500"
                />
              )}
              <Icon
                className={cn(
                  'h-[18px] w-[18px]',
                  active
                    ? 'text-brand-600'
                    : 'text-slate-400 group-hover:text-slate-600',
                )}
              />
              {label}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-slate-100 p-3">
        <form action={logout}>
          <button
            type="submit"
            className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition-all hover:bg-slate-50 hover:text-slate-900"
          >
            <IconLogOut className="h-[18px] w-[18px] text-slate-400 group-hover:text-slate-600" />
            Sair
          </button>
        </form>
      </div>
    </aside>
  )
}
