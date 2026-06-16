'use client'

import { useRef, useState } from 'react'
import { saveStoreSettings } from '@/actions/store-settings'
import { LogoUpload } from '@/components/loja/LogoUpload'
import { Icon } from '@/components/painel/Icons'
import type { StoreSettings } from '@/types/store-settings'
import {
  MAX_FAQ_ITEMS,
  MAX_FAQ_QUESTION_LENGTH,
  MAX_FAQ_ANSWER_LENGTH,
  MAX_DISCOUNT_CUSTOM_LENGTH,
  type DiscountType,
} from '@/lib/store-settings-sanitize'

const PAYMENT_OPTIONS = [
  'PIX',
  'Cartão de Crédito',
  'Cartão de Débito',
  'Boleto Bancário',
]

const SERVICE_STEP_OPTIONS = [
  {
    value: 'Saudação',
    description: 'Recebe o cliente e apresenta a loja em uma frase.',
  },
  {
    value: 'Identificar necessidade',
    description: 'Pergunta sobre estilo, ocasião, prazo ou orçamento.',
  },
  {
    value: 'Apresentar produtos',
    description: 'Sugere itens do catálogo com foto, preço e variações.',
  },
  {
    value: 'Capturar contato',
    description: 'Pede nome e WhatsApp antes de transferir para você.',
  },
]

const DELIVERY_OPTIONS = ['Correios']

const MAX_BIO_LENGTH = 280
const MAX_NAME_LENGTH = 100
const MAX_INSTRUCTIONS_LENGTH = 2000

function toggleValue(arr: string[], value: string): string[] {
  return arr.includes(value)
    ? arr.filter((v) => v !== value)
    : [...arr, value]
}

// Tira espaço sobrando e remove repetidas (sem diferenciar maiúsculas). Usado ao
// carregar as categorias salvas, pra não exibir chip/checkbox duplicado quando o
// valor salvo veio com lixo de espaço ou em duas grafias.
function dedupTrim(arr: string[] | null | undefined): string[] {
  const seen = new Map<string, string>()
  for (const raw of arr ?? []) {
    const c = (raw ?? '').trim()
    if (!c) continue
    const key = c.toLowerCase()
    if (!seen.has(key)) seen.set(key, c)
  }
  return [...seen.values()]
}

function addCustomValue(
  arr: string[],
  predefined: string[],
  value: string
): string[] {
  const trimmed = value.trim()
  if (!trimmed) return arr
  const match = predefined.find(
    (p) => p.toLowerCase() === trimmed.toLowerCase()
  )
  const finalValue = match ?? trimmed
  if (arr.some((v) => v.toLowerCase() === finalValue.toLowerCase())) return arr
  return [...arr, finalValue]
}

function extractInstagramHandle(value: string): string {
  let v = value.trim()
  if (!v) return ''
  // Strip protocol and host so we can keep just the path segment
  v = v.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  v = v.replace(/^(?:m\.|mobile\.)?instagram\.com\//i, '')
  // First path segment is the handle; drop trailing slashes, query, hash
  v = v.split(/[/?#]/)[0]
  // Drop any leading @ (one or many) and filter to allowed chars
  v = v.replace(/^@+/, '').replace(/[^a-zA-Z0-9._]/g, '')
  return v.slice(0, 30)
}

// Normaliza handle ou link colado para a URL canônica do perfil.
function normalizeInstagramUrl(value: string): string {
  const handle = extractInstagramHandle(value)
  return handle ? `https://instagram.com/${handle}` : ''
}

function formatPhone(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11)
  if (d.length === 0) return ''
  if (d.length <= 2) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10)
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

function ChipInput({
  selected,
  predefined,
  onAdd,
  onRemove,
  placeholder,
}: {
  selected: string[]
  predefined: string[]
  onAdd: (value: string) => void
  onRemove: (value: string) => void
  placeholder: string
}) {
  const [value, setValue] = useState('')
  const customChips = selected.filter(
    (s) => !predefined.some((p) => p.toLowerCase() === s.toLowerCase())
  )

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmed = value.trim()
      if (trimmed) {
        onAdd(trimmed)
        setValue('')
      }
    } else if (e.key === 'Backspace' && value === '' && customChips.length > 0) {
      e.preventDefault()
      onRemove(customChips[customChips.length - 1])
    }
  }

  return (
    <div className="chip-input-shell">
      {customChips.map((chip) => (
        <span key={chip} className="pill">
          {chip}
          <button
            type="button"
            onClick={() => onRemove(chip)}
            aria-label={`Remover ${chip}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
    </div>
  )
}

function SectionHeader({
  step,
  title,
  description,
  toneIcon,
  tone,
  trailing,
}: {
  step: string
  title: string
  description: string
  toneIcon: string
  tone: 'brand' | 'success' | 'info'
  trailing?: React.ReactNode
}) {
  return (
    <header className="flex items-start justify-between gap-3 mb-5">
      <div className="flex items-start gap-3">
        <span className={`chip chip-${tone}`}>
          <Icon name={toneIcon} />
        </span>
        <div>
          <div className="eyebrow text-ink-500">{step}</div>
          <h3
            className="font-display font-bold text-ink-900 mt-0.5"
            style={{ fontSize: 17 }}
          >
            {title}
          </h3>
          <p className="text-[12.5px] text-ink-500 mt-0.5">{description}</p>
        </div>
      </div>
      {trailing}
    </header>
  )
}

export function LojaForm({
  userId,
  settings,
  availableCategories,
}: {
  userId: string
  settings: StoreSettings | null
  availableCategories: string[]
}) {
  const [storeName, setStoreName] = useState(settings?.store_name ?? '')
  const [storeBio, setStoreBio] = useState(settings?.store_bio ?? '')
  const [logoUrl, setLogoUrl] = useState(settings?.logo_url ?? '')
  const [sellerPhone, setSellerPhone] = useState(settings?.seller_phone ?? '')
  const [instagramUrl, setInstagramUrl] = useState(
    normalizeInstagramUrl(settings?.instagram_handle ?? ''),
  )
  const [serviceSteps, setServiceSteps] = useState<string[]>(
    settings?.service_steps ?? [],
  )
  const [serviceInstructions, setServiceInstructions] = useState(
    settings?.service_instructions ?? '',
  )
  const [paymentMethods, setPaymentMethods] = useState<string[]>(
    settings?.payment_methods ?? [],
  )
  const [deliveryMethods, setDeliveryMethods] = useState<string[]>(
    settings?.delivery_methods ?? [],
  )
  const [categories, setCategories] = useState<string[]>(
    dedupTrim(settings?.categories),
  )
  const [minOrderEnabled, setMinOrderEnabled] = useState(
    settings?.min_order_enabled ?? false,
  )
  const [minOrderQuantity, setMinOrderQuantity] = useState<string>(
    settings?.min_order_quantity != null
      ? String(settings.min_order_quantity)
      : '',
  )
  const [minOrderValue, setMinOrderValue] = useState<string>(
    settings?.min_order_value != null ? String(settings.min_order_value) : '',
  )
  const [minOrderLogic, setMinOrderLogic] = useState<'all' | 'any'>(
    settings?.min_order_logic === 'any' ? 'any' : 'all',
  )
  const faqIdRef = useRef(settings?.faq?.length ?? 0)
  const [faq, setFaq] = useState(() =>
    (settings?.faq ?? []).map((p, i) => ({
      id: i,
      pergunta: p.pergunta,
      resposta: p.resposta,
    })),
  )

  const [discountType, setDiscountType] = useState<DiscountType | null>(
    settings?.discount_type ?? null,
  )
  const [discountValue, setDiscountValue] = useState<string>(
    settings?.discount_value != null ? String(settings.discount_value) : '',
  )
  const [discountCustom, setDiscountCustom] = useState(
    settings?.discount_custom ?? '',
  )

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    if (!storeName.trim()) {
      setError('Informe o nome da loja.')
      setLoading(false)
      return
    }
    if (sellerPhone && (sellerPhone.length < 10 || sellerPhone.length > 11)) {
      setError(
        'Número do WhatsApp inválido. Use 10 ou 11 dígitos.'
      )
      setLoading(false)
      return
    }
    if (paymentMethods.length === 0) {
      setError('Selecione pelo menos uma forma de pagamento.')
      setLoading(false)
      return
    }

    const parsedQty =
      minOrderQuantity.trim() === '' ? null : parseInt(minOrderQuantity, 10)
    const parsedValue =
      minOrderValue.trim() === '' ? null : parseFloat(minOrderValue)
    const cleanQty =
      parsedQty !== null && Number.isFinite(parsedQty) ? parsedQty : null
    const cleanValue =
      parsedValue !== null && Number.isFinite(parsedValue) ? parsedValue : null

    if (minOrderEnabled && cleanQty === null && cleanValue === null) {
      setError(
        'Defina quantidade ou valor mínimo, ou desative o pedido mínimo.'
      )
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
      seller_phone: sellerPhone,
      instagram_handle: normalizeInstagramUrl(instagramUrl),
      store_bio: storeBio,
      logo_url: logoUrl,
      min_order_enabled: minOrderEnabled,
      min_order_quantity: cleanQty,
      min_order_value: cleanValue,
      min_order_logic: minOrderLogic,
      faq: faq
        .filter((p) => p.pergunta.trim() !== '' && p.resposta.trim() !== '')
        .map((p) => ({ pergunta: p.pergunta, resposta: p.resposta })),
      discount_type: discountType,
      discount_value:
        discountType && discountType !== 'custom' && discountValue.trim() !== ''
          ? parseFloat(discountValue)
          : null,
      discount_custom: discountType === 'custom' ? discountCustom : '',
    })

    if (result.success) {
      setSuccess(true)
    } else {
      setError(result.error ?? 'Erro desconhecido.')
    }
    setLoading(false)
  }

  const minOrderBothFilled =
    minOrderQuantity.trim() !== '' && minOrderValue.trim() !== ''

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* ── Seção 1 · Identidade ───────── */}
      <section className="card p-6" id="sec-identidade">
        <SectionHeader
          step="01 · IDENTIDADE"
          title="Identidade da loja"
          description="Como sua loja se apresenta para os clientes."
          toneIcon="store"
          tone="brand"
        />

        <div className="space-y-6">
          {/* Logo */}
          <div>
            <label className="label">Logomarca</label>
            <LogoUpload
              userId={userId}
              value={logoUrl}
              onChange={setLogoUrl}
            />
          </div>

          {/* Nome */}
          <div>
            <label className="label" htmlFor="storeName">
              Nome da loja<span className="req">*</span>
            </label>
            <input
              id="storeName"
              className="input"
              type="text"
              maxLength={MAX_NAME_LENGTH}
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="Ex: Floricultura Zaira"
              required
            />
            <div className="flex justify-between mt-1.5">
              <p className="helper">
                Exibido no topo do chat e no link público.
              </p>
              <p
                className={`helper counter ${
                  storeName.length >= MAX_NAME_LENGTH ? 'over' : ''
                }`}
              >
                {storeName.length}/{MAX_NAME_LENGTH}
              </p>
            </div>
          </div>

          {/* Bio */}
          <div>
            <label className="label" htmlFor="storeBio">
              Descrição da loja{' '}
              <span className="text-ink-400 font-medium">(bio)</span>
            </label>
            <textarea
              id="storeBio"
              className="input"
              maxLength={MAX_BIO_LENGTH}
              value={storeBio}
              onChange={(e) =>
                setStoreBio(e.target.value.slice(0, MAX_BIO_LENGTH))
              }
              placeholder="Conte o que sua loja vende, seu diferencial e quem é seu público."
            />
            <div className="flex justify-between mt-1.5">
              <p className="helper">
                Aparece para o cliente no início da conversa.
              </p>
              <p
                className={`helper counter ${
                  storeBio.length >= MAX_BIO_LENGTH ? 'over' : ''
                }`}
              >
                {storeBio.length}/{MAX_BIO_LENGTH}
              </p>
            </div>
          </div>

          {/* Categorias */}
          <div>
            <label className="label">Categorias de produtos</label>
            <p className="helper mb-2.5">
              Carregadas automaticamente do seu catálogo. Adicione customizadas
              digitando e pressionando <span className="kbd">Enter</span>.
            </p>
            {availableCategories.length === 0 ? (
              <p className="text-[13px] text-ink-400 mb-3">
                Nenhuma categoria disponível. Importe produtos primeiro.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-y-2.5 gap-x-3 mb-3">
                {availableCategories.map((cat) => (
                  <label
                    key={cat}
                    className="flex items-center gap-2.5 text-[13px] text-ink-800"
                  >
                    <input
                      type="checkbox"
                      className="check"
                      checked={categories.includes(cat)}
                      onChange={() =>
                        setCategories(toggleValue(categories, cat))
                      }
                    />
                    {cat}
                  </label>
                ))}
              </div>
            )}
            <ChipInput
              selected={categories}
              predefined={availableCategories}
              onAdd={(v) =>
                setCategories(addCustomValue(categories, availableCategories, v))
              }
              onRemove={(v) =>
                setCategories(categories.filter((c) => c !== v))
              }
              placeholder="Adicionar categoria…"
            />
          </div>
        </div>
      </section>

      {/* ── Seção 2 · Contato ───────── */}
      <section className="card p-6" id="sec-contato">
        <SectionHeader
          step="02 · CONTATO"
          title="Contato"
          description="Canais para o cliente falar com você fora do chat."
          toneIcon="phone"
          tone="success"
        />

        <div className="grid md:grid-cols-2 gap-5">
          {/* WhatsApp */}
          <div>
            <label className="label" htmlFor="whats">
              Vendedor (WhatsApp)
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-success-600">
                <Icon name="phone" className="w-4 h-4" />
              </div>
              <input
                id="whats"
                className="input"
                style={{ paddingLeft: 36 }}
                type="tel"
                inputMode="numeric"
                placeholder="(11) 98765-4321"
                value={formatPhone(sellerPhone)}
                onChange={(e) =>
                  setSellerPhone(e.target.value.replace(/\D/g, '').slice(0, 11))
                }
              />
            </div>
            <p className="helper mt-1.5">
              Formato (XX) 9XXXX-XXXX. Salvamos só os dígitos.
            </p>
          </div>

          {/* Instagram */}
          <div>
            <label className="label" htmlFor="ig">
              Instagram
            </label>
            <input
              id="ig"
              className="input"
              type="text"
              maxLength={500}
              value={instagramUrl}
              onChange={(e) => setInstagramUrl(e.target.value)}
              onBlur={(e) => setInstagramUrl(normalizeInstagramUrl(e.target.value))}
              placeholder="https://instagram.com/floricultura.zaira"
            />
            <p className="helper mt-1.5">
              Cole o link do perfil ou digite o @. Salvamos o link completo.
            </p>
          </div>
        </div>
      </section>

      {/* ── Seção 3 · Atendimento ───────── */}
      <section className="card p-6" id="sec-atendimento">
        <SectionHeader
          step="03 · ATENDIMENTO"
          title="Agente de IA"
          description="Como o agente conduz a conversa com o cliente."
          toneIcon="sparkle"
          tone="brand"
          trailing={
            <span className="hidden md:inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-700 bg-brand-50 ring-1 ring-brand-100 px-2 py-1 rounded-md">
              <Icon name="sparkle" className="w-3 h-3" />
              MODELO v3.2
            </span>
          }
        />

        <div className="space-y-5">
          <div>
            <label className="label">Etapas do atendimento</label>
            <div className="grid md:grid-cols-2 gap-2.5">
              {SERVICE_STEP_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-start gap-3 p-3 rounded-xl border border-ink-200 hover:border-brand-200 hover:bg-brand-50/40 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    className="check mt-0.5"
                    checked={serviceSteps.includes(opt.value)}
                    onChange={() =>
                      setServiceSteps(toggleValue(serviceSteps, opt.value))
                    }
                  />
                  <span>
                    <span className="text-[13px] font-semibold text-ink-900">
                      {opt.value}
                    </span>
                    <span className="block text-[11.5px] text-ink-500 mt-0.5">
                      {opt.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="label" htmlFor="agentNotes">
              Instruções adicionais para o agente
            </label>
            <textarea
              id="agentNotes"
              className="input"
              maxLength={MAX_INSTRUCTIONS_LENGTH}
              rows={5}
              value={serviceInstructions}
              onChange={(e) => setServiceInstructions(e.target.value)}
              placeholder="Ex: Sempre ofereça parcelamento em até 6× sem juros. Nunca prometa entrega no mesmo dia. Use linguagem informal mas sem gírias."
            />
            <div className="flex justify-between mt-1.5">
              <p className="helper">
                Personalize tom de voz, regras de venda, restrições e detalhes
                que o agente deve sempre lembrar.
              </p>
              <p
                className={`helper counter ${
                  serviceInstructions.length >= MAX_INSTRUCTIONS_LENGTH
                    ? 'over'
                    : ''
                }`}
              >
                {serviceInstructions.length}/{MAX_INSTRUCTIONS_LENGTH}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Seção · Conhecimento (FAQ) ───────── */}
      <section className="card p-6" id="sec-conhecimento">
        <SectionHeader
          step="04 · CONHECIMENTO"
          title="Perguntas e respostas"
          description="Cadastre dúvidas frequentes e a resposta que o agente deve usar."
          toneIcon="sparkle"
          tone="brand"
        />

        <div className="space-y-4">
          {faq.length === 0 && (
            <p className="text-[13px] text-ink-400">
              Nenhuma pergunta cadastrada ainda.
            </p>
          )}

          {faq.map((item, idx) => (
            <div
              key={item.id}
              className="rounded-xl border border-ink-200 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="eyebrow text-ink-500">PERGUNTA {idx + 1}</span>
                <button
                  type="button"
                  className="text-[12px] font-semibold text-ink-400 hover:text-[#DC2626] transition-colors"
                  onClick={() => setFaq(faq.filter((p) => p.id !== item.id))}
                >
                  Remover
                </button>
              </div>

              <div>
                <label className="label" style={{ fontSize: 12 }}>
                  Pergunta
                </label>
                <input
                  className="input"
                  type="text"
                  maxLength={MAX_FAQ_QUESTION_LENGTH}
                  value={item.pergunta}
                  onChange={(e) =>
                    setFaq(
                      faq.map((p) =>
                        p.id === item.id ? { ...p, pergunta: e.target.value } : p,
                      ),
                    )
                  }
                  placeholder="Ex: Vocês fazem troca?"
                />
              </div>

              <div>
                <label className="label" style={{ fontSize: 12 }}>
                  Resposta
                </label>
                <textarea
                  className="input"
                  rows={3}
                  maxLength={MAX_FAQ_ANSWER_LENGTH}
                  value={item.resposta}
                  onChange={(e) =>
                    setFaq(
                      faq.map((p) =>
                        p.id === item.id ? { ...p, resposta: e.target.value } : p,
                      ),
                    )
                  }
                  placeholder="Ex: Sim, em até 7 dias com a etiqueta."
                />
              </div>
            </div>
          ))}

          {faq.length < MAX_FAQ_ITEMS && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                setFaq([
                  ...faq,
                  { id: faqIdRef.current++, pergunta: '', resposta: '' },
                ])
              }
            >
              <Icon name="plus" className="w-4 h-4" />
              Adicionar pergunta
            </button>
          )}
        </div>
      </section>

      {/* ── Seção 4 · Operação ───────── */}
      <section className="card p-6" id="sec-operacao">
        <SectionHeader
          step="05 · OPERAÇÃO"
          title="Operação"
          description="Regras de compra, pagamento e entrega."
          toneIcon="package"
          tone="info"
        />

        <div className="space-y-6">
          {/* Pedido mínimo */}
          <div>
            <label className="flex items-start gap-3 p-3.5 rounded-xl border border-brand-200 bg-brand-50/40 cursor-pointer">
              <input
                type="checkbox"
                className="check mt-0.5"
                checked={minOrderEnabled}
                onChange={() => setMinOrderEnabled((v) => !v)}
              />
              <span className="flex-1">
                <span className="text-[13.5px] font-semibold text-ink-900">
                  Exigir pedido mínimo{' '}
                  <span className="text-ink-400 font-medium">(atacado)</span>
                </span>
                <span className="block text-[11.5px] text-ink-600 mt-0.5">
                  O agente avisa o cliente antes de fechar quando o carrinho
                  não atinge o mínimo.
                </span>
              </span>
            </label>

            <div className={`collapsible ${minOrderEnabled ? 'open' : ''}`}>
              <div>
                <div className="mt-3 ml-4 pl-5 border-l-2 border-brand-100 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label
                        className="label"
                        style={{ fontSize: 12, color: '#4A4F66' }}
                        htmlFor="minQty"
                      >
                        Quantidade mínima de peças
                      </label>
                      <input
                        id="minQty"
                        className="input"
                        type="number"
                        min={1}
                        step={1}
                        value={minOrderQuantity}
                        onChange={(e) => setMinOrderQuantity(e.target.value)}
                        placeholder="6"
                      />
                    </div>
                    <div>
                      <label
                        className="label"
                        style={{ fontSize: 12, color: '#4A4F66' }}
                        htmlFor="minVal"
                      >
                        Valor mínimo (R$)
                      </label>
                      <input
                        id="minVal"
                        className="input"
                        type="number"
                        min={0}
                        step={0.01}
                        value={minOrderValue}
                        onChange={(e) => setMinOrderValue(e.target.value)}
                        placeholder="300,00"
                      />
                    </div>
                  </div>

                  {minOrderBothFilled && (
                    <div>
                      <p className="eyebrow text-ink-500 mb-2">
                        QUANDO AMBOS PREENCHIDOS, EXIGIR
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="flex items-center gap-2.5 p-2.5 rounded-lg border border-ink-200 hover:border-brand-200 cursor-pointer text-[12.5px] text-ink-800 font-medium">
                          <input
                            type="radio"
                            name="minOrderMode"
                            className="radio"
                            checked={minOrderLogic === 'all'}
                            onChange={() => setMinOrderLogic('all')}
                          />
                          Os dois critérios
                        </label>
                        <label className="flex items-center gap-2.5 p-2.5 rounded-lg border border-ink-200 hover:border-brand-200 cursor-pointer text-[12.5px] text-ink-800 font-medium">
                          <input
                            type="radio"
                            name="minOrderMode"
                            className="radio"
                            checked={minOrderLogic === 'any'}
                            onChange={() => setMinOrderLogic('any')}
                          />
                          Qualquer um dos dois
                        </label>
                      </div>
                    </div>
                  )}

                  <p className="helper">
                    Pelo menos um dos campos acima é obrigatório quando o
                    pedido mínimo está ativado.
                  </p>

                  <div className="h-px bg-ink-100" />

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="eyebrow text-ink-500">
                        DESCONTO DE ATACADO (OPCIONAL)
                      </p>
                      {discountType !== null && (
                        <button
                          type="button"
                          className="text-[12px] font-semibold text-ink-400 hover:text-ink-700 transition-colors"
                          onClick={() => setDiscountType(null)}
                        >
                          Sem desconto
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          ['percent_piece', '% por preço da peça'],
                          ['percent_order', '% por preço do pedido'],
                          ['fixed_piece', 'Valor fixo por peça'],
                          ['custom', 'Personalizado'],
                        ] as Array<[DiscountType, string]>
                      ).map(([value, label]) => (
                        <label
                          key={value}
                          className="flex items-center gap-2.5 p-2.5 rounded-lg border border-ink-200 hover:border-brand-200 cursor-pointer text-[12.5px] text-ink-800 font-medium"
                        >
                          <input
                            type="radio"
                            name="discountType"
                            className="radio"
                            checked={discountType === value}
                            onChange={() => setDiscountType(value)}
                          />
                          {label}
                        </label>
                      ))}
                    </div>

                    {(discountType === 'percent_piece' ||
                      discountType === 'percent_order') && (
                      <div
                        className="flex items-center gap-2 mt-3"
                        style={{ maxWidth: 200 }}
                      >
                        <input
                          className="input"
                          type="number"
                          min={0}
                          max={100}
                          step={0.01}
                          value={discountValue}
                          onChange={(e) => setDiscountValue(e.target.value)}
                          placeholder="10"
                        />
                        <span className="text-[13px] text-ink-500 font-medium">
                          %
                        </span>
                      </div>
                    )}

                    {discountType === 'fixed_piece' && (
                      <div
                        className="flex items-center gap-2 mt-3"
                        style={{ maxWidth: 200 }}
                      >
                        <span className="text-[13px] text-ink-500 font-medium">
                          R$
                        </span>
                        <input
                          className="input"
                          type="number"
                          min={0}
                          step={0.01}
                          value={discountValue}
                          onChange={(e) => setDiscountValue(e.target.value)}
                          placeholder="5,00"
                        />
                      </div>
                    )}

                    {discountType === 'custom' && (
                      <input
                        className="input mt-3"
                        type="text"
                        maxLength={MAX_DISCOUNT_CUSTOM_LENGTH}
                        value={discountCustom}
                        onChange={(e) => setDiscountCustom(e.target.value)}
                        placeholder="Ex: 5% acima de 20 peças, 8% acima de 50"
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="h-px bg-ink-100" />

          {/* Pagamentos */}
          <div>
            <label className="label">
              Formas de pagamento<span className="req">*</span>
            </label>
            <div className="grid grid-cols-2 gap-y-2 gap-x-3 mb-3">
              {PAYMENT_OPTIONS.map((method) => (
                <label
                  key={method}
                  className="flex items-center gap-2.5 text-[13px] text-ink-800"
                >
                  <input
                    type="checkbox"
                    className="check"
                    checked={paymentMethods.includes(method)}
                    onChange={() =>
                      setPaymentMethods(toggleValue(paymentMethods, method))
                    }
                  />
                  {method}
                  {method === 'PIX' && paymentMethods.includes('PIX') && (
                    <span className="eyebrow text-success-700 bg-success-50 px-1.5 py-0.5 rounded-md ml-auto">
                      PREFERIDO
                    </span>
                  )}
                </label>
              ))}
            </div>
            <ChipInput
              selected={paymentMethods}
              predefined={PAYMENT_OPTIONS}
              onAdd={(v) =>
                setPaymentMethods(
                  addCustomValue(paymentMethods, PAYMENT_OPTIONS, v)
                )
              }
              onRemove={(v) =>
                setPaymentMethods(paymentMethods.filter((m) => m !== v))
              }
              placeholder="Adicionar forma de pagamento…"
            />
            <p className="helper mt-1.5">
              Selecione pelo menos uma forma de pagamento.
            </p>
          </div>

          <div className="h-px bg-ink-100" />

          {/* Entrega */}
          <div>
            <label className="label">Formas de entrega</label>
            <div className="grid grid-cols-2 gap-y-2 gap-x-3 mb-3">
              {DELIVERY_OPTIONS.map((method) => (
                <label
                  key={method}
                  className="flex items-center gap-2.5 text-[13px] text-ink-800"
                >
                  <input
                    type="checkbox"
                    className="check"
                    checked={deliveryMethods.includes(method)}
                    onChange={() =>
                      setDeliveryMethods(toggleValue(deliveryMethods, method))
                    }
                  />
                  {method}
                  {method === 'Correios' && (
                    <span className="eyebrow text-ink-400 ml-auto">
                      PADRÃO
                    </span>
                  )}
                </label>
              ))}
            </div>
            <ChipInput
              selected={deliveryMethods}
              predefined={DELIVERY_OPTIONS}
              onAdd={(v) =>
                setDeliveryMethods(
                  addCustomValue(deliveryMethods, DELIVERY_OPTIONS, v)
                )
              }
              onRemove={(v) =>
                setDeliveryMethods(deliveryMethods.filter((m) => m !== v))
              }
              placeholder="Adicionar forma de entrega…"
            />
          </div>
        </div>
      </section>

      {/* Feedback */}
      {error && (
        <div className="banner banner-error" role="alert">
          <Icon name="infoCircle" className="w-[18px] h-[18px]" />
          <div>
            <strong className="block mb-0.5 font-display">
              Não foi possível salvar
            </strong>
            <span>{error}</span>
          </div>
        </div>
      )}
      {success && (
        <div className="banner banner-success" role="status">
          <Icon name="check" className="w-[18px] h-[18px]" />
          <div>
            <strong className="block mb-0.5 font-display">
              Configurações salvas
            </strong>
            <span className="text-success-700/90">
              Seu chat público já foi atualizado.
            </span>
          </div>
        </div>
      )}

      {/* Footer / save */}
      <div className="flex items-center justify-between gap-3 pt-3 pb-12">
        <p className="text-[12px] text-ink-500 max-w-[40ch]">
          Alterações são publicadas imediatamente no chat público após salvar.
        </p>
        <button type="submit" disabled={loading} className="btn btn-primary">
          {loading ? (
            <>
              <svg
                className="animate-spin"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              Salvando…
            </>
          ) : (
            <>
              <Icon name="check" className="w-4 h-4" />
              Salvar configurações
            </>
          )}
        </button>
      </div>
    </form>
  )
}
