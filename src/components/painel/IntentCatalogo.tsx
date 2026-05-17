'use client'

import { Icon } from './Icons'

type ProductStatus = 'OK' | 'DESC VAZIA' | 'SEM FOTO' | 'STOCK OUT'

type Product = {
  name: string
  views: number
  mentions: number
  leads: number
  hasDesc: boolean
  hasPhoto: boolean
  status: ProductStatus
}

const PRODUCTS: Product[] = [
  { name: 'Buquê Maria',       views: 412, mentions: 87, leads: 12, hasDesc: true,  hasPhoto: true,  status: 'OK' },
  { name: 'Tulipa Branca',     views: 298, mentions: 54, leads:  2, hasDesc: false, hasPhoto: true,  status: 'DESC VAZIA' },
  { name: 'Coroa Premium',     views: 211, mentions: 33, leads:  9, hasDesc: true,  hasPhoto: true,  status: 'OK' },
  { name: 'Assinatura Mensal', views: 142, mentions: 29, leads:  4, hasDesc: true,  hasPhoto: false, status: 'SEM FOTO' },
  { name: 'Bouquet Hortênsia', views:  98, mentions: 12, leads:  1, hasDesc: true,  hasPhoto: true,  status: 'OK' },
]

const STATUS_CLS: Record<ProductStatus, string> = {
  'OK':         'text-success-700 bg-success-50 ring-success-100',
  'DESC VAZIA': 'text-warn-700 bg-warn-50 ring-warn-100',
  'SEM FOTO':   'text-warn-700 bg-warn-50 ring-warn-100',
  'STOCK OUT':  'text-danger-700 bg-danger-50 ring-danger-100',
}

function CheckCell({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="font-mono text-success-700">✓</span>
  ) : (
    <span className="font-mono text-ink-300">—</span>
  )
}

export function IntentCatalogo() {
  return (
    <div className="card p-0">
      <div className="flex items-end justify-between px-6 pt-6 pb-5">
        <div>
          <div className="eyebrow text-ink-500">INTENT · MAIO</div>
          <h2
            className="font-display font-bold text-ink-900 tracking-tight mt-1"
            style={{ fontSize: '20px' }}
          >
            Produtos × menções no chat × leads
          </h2>
        </div>
        <button className="text-[12.5px] font-semibold text-ink-600 hover:text-ink-900 inline-flex items-center gap-1">
          Ordenar: menções <Icon name="chev" className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-ink-50/60 border-y border-ink-100">
              <th className="eyebrow text-ink-400 text-left  px-6 py-2 font-normal">PRODUTO</th>
              <th className="eyebrow text-ink-400 text-right px-3 py-2 font-normal">VIEWS</th>
              <th className="eyebrow text-ink-400 text-right px-3 py-2 font-normal">MENÇÕES</th>
              <th className="eyebrow text-ink-400 text-right px-3 py-2 font-normal">LEADS</th>
              <th className="eyebrow text-ink-400 text-center px-3 py-2 font-normal">DESC.</th>
              <th className="eyebrow text-ink-400 text-center px-3 py-2 font-normal">FOTO</th>
              <th className="eyebrow text-ink-400 text-left  px-3 py-2 pr-6 font-normal">STATUS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {PRODUCTS.map((p) => (
              <tr key={p.name} className="text-[13px]">
                <td className="px-6 py-3 text-ink-900 font-semibold">{p.name}</td>
                <td className="px-3 py-3 text-right font-mono tabular text-ink-700">{p.views}</td>
                <td className="px-3 py-3 text-right font-mono tabular text-ink-700">{p.mentions}</td>
                <td className="px-3 py-3 text-right font-mono tabular font-semibold text-ink-900">{p.leads}</td>
                <td className="px-3 py-3 text-center"><CheckCell ok={p.hasDesc} /></td>
                <td className="px-3 py-3 text-center"><CheckCell ok={p.hasPhoto} /></td>
                <td className="px-3 py-3 pr-6">
                  <span className={`eyebrow text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md ring-1 ${STATUS_CLS[p.status]}`}>
                    {p.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-6 py-4 border-t border-ink-100 bg-ink-50/40 flex items-center justify-between">
        <span className="eyebrow text-ink-500">47 produtos no catálogo · 12 com algum problema</span>
        <button className="text-[12.5px] font-semibold text-brand-700 hover:text-brand-800 inline-flex items-center gap-1">
          Ver todos <Icon name="arrow" className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
