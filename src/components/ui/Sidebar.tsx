import Link from 'next/link'
import { logout } from '@/actions/auth'

export function Sidebar() {
  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <h1 className="text-lg font-bold text-gray-900">LUE FZ</h1>
        <p className="text-xs text-gray-500">Painel do Operador</p>
      </div>
      <nav className="flex-1 p-4 space-y-1">
        <Link
          href="/painel"
          className="block px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900"
        >
          Conversas
        </Link>
        <Link
          href="/estoque"
          className="block px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900"
        >
          Estoque
        </Link>
        <Link
          href="/loja"
          className="block px-3 py-2 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900"
        >
          Loja
        </Link>
      </nav>
      <div className="p-4 border-t border-gray-200">
        <form action={logout}>
          <button
            type="submit"
            className="w-full px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md text-left"
          >
            Sair
          </button>
        </form>
      </div>
    </aside>
  )
}
