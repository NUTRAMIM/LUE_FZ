'use client'

import { useState } from 'react'
import Link from 'next/link'

interface ImportResult {
  imported: number
  updated: number
  errors: Array<{ sku: string; error: string }>
  total_in_source: number
  source: {
    loja: { nome: string | null; url: string | null }
    vendedor: { nome: string | null; whatsapp: string | null }
    catalogo: { nome: string | null }
  }
}

export default function ImportPage() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleImport(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch('/api/inventory/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Erro ao importar')
        return
      }

      setResult(data)
    } catch (err) {
      setError('Erro de conexão')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <Link href="/estoque" className="text-sm text-blue-600 hover:underline">
          ← Voltar para Estoque
        </Link>
      </div>

      <h2 className="text-xl font-semibold text-gray-900 mb-4">Importar Estoque</h2>
      <p className="text-sm text-gray-500 mb-6">
        Cole a URL do JSON de produtos para importar o estoque.
      </p>

      <form onSubmit={handleImport} className="space-y-4">
        <div>
          <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-1">
            URL do JSON
          </label>
          <input
            id="url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
            placeholder="https://facilzap.com.br/modelo3/integracoes/produtos_json"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !url}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Importando...' : 'Importar'}
        </button>
      </form>

      {error && (
        <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-4">
          <div className="p-4 bg-green-50 border border-green-200 rounded-md">
            <p className="text-sm font-medium text-green-800">
              Importação concluída — {result.source.loja?.nome ?? 'Loja'} / {result.source.catalogo?.nome ?? 'Catálogo'}
            </p>
            <div className="mt-2 text-sm text-green-700 space-y-1">
              <p>Total na fonte: {result.total_in_source}</p>
              <p>Novos: {result.imported}</p>
              <p>Atualizados: {result.updated}</p>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-md">
              <p className="text-sm font-medium text-yellow-800 mb-2">
                {result.errors.length} erro(s):
              </p>
              <ul className="text-sm text-yellow-700 space-y-1">
                {result.errors.map((err, i) => (
                  <li key={i}>SKU {err.sku}: {err.error}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
