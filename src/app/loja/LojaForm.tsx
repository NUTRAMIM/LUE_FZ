'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { saveStoreSettings } from '@/actions/store-settings'

const PAYMENT_OPTIONS = [
  'PIX',
  'Cartão de Crédito',
  'Cartão de Débito',
  'Boleto Bancário',
]

const SERVICE_STEP_OPTIONS = [
  { value: 'Saudação', description: 'Cumprimentar o cliente e se apresentar' },
  { value: 'Identificar necessidade', description: 'Perguntar o que o cliente precisa' },
  { value: 'Apresentar produtos', description: 'Mostrar opções de produtos do catálogo' },
  { value: 'Capturar contato', description: 'Pegar número de telefone e e-mail do cliente' },
]

const DELIVERY_OPTIONS = [
  'Correios',
]

function toggleValue(arr: string[], value: string): string[] {
  return arr.includes(value)
    ? arr.filter(v => v !== value)
    : [...arr, value]
}

export function LojaForm() {
  const [storeName, setStoreName] = useState('')
  const [serviceSteps, setServiceSteps] = useState<string[]>([])
  const [serviceInstructions, setServiceInstructions] = useState('')
  const [paymentMethods, setPaymentMethods] = useState<string[]>([])
  const [deliveryMethods, setDeliveryMethods] = useState<string[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [availableCategories, setAvailableCategories] = useState<string[]>([])

  const [initialLoading, setInitialLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    async function loadSettings() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setInitialLoading(false)
        return
      }

      const { data } = await supabase
        .from('store_settings')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()

      // Load distinct categories from user's products
      const { data: products } = await supabase
        .from('products')
        .select('category')

      const uniqueCats = [...new Set(
        (products ?? [])
          .map(p => p.category)
          .filter((c): c is string => !!c)
      )].sort()
      setAvailableCategories(uniqueCats)

      if (data) {
        setStoreName(data.store_name)
        setServiceSteps(data.service_steps ?? [])
        setServiceInstructions(data.service_instructions ?? '')
        setPaymentMethods(data.payment_methods ?? [])
        setDeliveryMethods(data.delivery_methods ?? [])
        setCategories(data.categories ?? [])
      }
      setInitialLoading(false)
    }
    loadSettings()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    if (!storeName.trim()) {
      setError('Nome da loja é obrigatório.')
      setLoading(false)
      return
    }
    if (paymentMethods.length === 0) {
      setError('Selecione pelo menos uma forma de pagamento.')
      setLoading(false)
      return
    }

    const result = await saveStoreSettings({
      store_name: storeName,
      service_steps: serviceSteps,
      service_instructions: serviceInstructions,
      payment_methods: paymentMethods,
      delivery_methods: deliveryMethods,
      categories,
    })

    if (result.success) {
      setSuccess(true)
    } else {
      setError(result.error ?? 'Erro desconhecido.')
    }
    setLoading(false)
  }

  if (initialLoading) {
    return <p className="text-gray-500">Carregando...</p>
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Nome da Loja */}
      <div>
        <label htmlFor="storeName" className="block text-sm font-medium text-gray-700 mb-1">
          Nome da Loja *
        </label>
        <input
          id="storeName"
          type="text"
          value={storeName}
          onChange={e => setStoreName(e.target.value)}
          maxLength={100}
          required
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Ex: Minha Loja Online"
        />
      </div>

      {/* Categorias de Produtos */}
      <fieldset>
        <legend className="block text-sm font-medium text-gray-700 mb-2">
          Categorias de Produtos
        </legend>
        <p className="text-xs text-gray-500 mb-3">
          Selecione as categorias da loja. As opções são carregadas automaticamente dos produtos importados.
        </p>
        {availableCategories.length === 0 ? (
          <p className="text-sm text-gray-400">Nenhuma categoria disponível. Importe produtos primeiro.</p>
        ) : (
          <div className="space-y-2">
            {availableCategories.map(cat => (
              <label key={cat} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={categories.includes(cat)}
                  onChange={() => setCategories(toggleValue(categories, cat))}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">{cat}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {/* Etapas do Atendimento */}
      <fieldset>
        <legend className="block text-sm font-medium text-gray-700 mb-2">
          Etapas do Atendimento
        </legend>
        <p className="text-xs text-gray-500 mb-3">
          Selecione as etapas que o agente de IA deve seguir durante o atendimento.
        </p>
        <div className="space-y-2">
          {SERVICE_STEP_OPTIONS.map(option => (
            <label key={option.value} className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={serviceSteps.includes(option.value)}
                onChange={() => setServiceSteps(toggleValue(serviceSteps, option.value))}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">
                <strong>{option.value}</strong>
                <span className="text-gray-500"> — {option.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Instruções Adicionais */}
      <div>
        <label htmlFor="serviceInstructions" className="block text-sm font-medium text-gray-700 mb-1">
          Instruções Adicionais para o Agente
        </label>
        <p className="text-xs text-gray-500 mb-2">
          Escreva instruções personalizadas que o agente de IA deve seguir no atendimento.
        </p>
        <textarea
          id="serviceInstructions"
          value={serviceInstructions}
          onChange={e => setServiceInstructions(e.target.value)}
          maxLength={2000}
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
          placeholder="Ex: Sempre ofereça frete grátis para compras acima de R$200..."
        />
        <p className="text-xs text-gray-400 mt-1">
          {serviceInstructions.length}/2000 caracteres
        </p>
      </div>

      {/* Formas de Pagamento */}
      <fieldset>
        <legend className="block text-sm font-medium text-gray-700 mb-2">
          Formas de Pagamento *
        </legend>
        <div className="space-y-2">
          {PAYMENT_OPTIONS.map(method => (
            <label key={method} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={paymentMethods.includes(method)}
                onChange={() => setPaymentMethods(toggleValue(paymentMethods, method))}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">{method}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Formas de Entrega */}
      <fieldset>
        <legend className="block text-sm font-medium text-gray-700 mb-2">
          Formas de Entrega
        </legend>
        <div className="space-y-2">
          {DELIVERY_OPTIONS.map(method => (
            <label key={method} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={deliveryMethods.includes(method)}
                onChange={() => setDeliveryMethods(toggleValue(deliveryMethods, method))}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">{method}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Feedback */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      {success && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-md">
          <p className="text-sm text-green-700">Configurações salvas com sucesso!</p>
        </div>
      )}

      {/* Botão Salvar */}
      <button
        type="submit"
        disabled={loading}
        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Salvando...' : 'Salvar Configurações'}
      </button>
    </form>
  )
}
