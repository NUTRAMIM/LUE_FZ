import { redirect } from 'next/navigation'
import QRCode from 'qrcode'
import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'
import { getAppUrl } from '@/lib/app-url'
import { getStoreRole } from '@/lib/store-role'
import { Icon } from '@/components/painel/Icons'
import { LojaCopyButton } from '@/components/loja/LojaCopyButton'
import { LojaForm } from './LojaForm'

export default async function LojaPage() {
  const supabase = await createClient()
  const user = await getAuthedUser()

  if (!user) redirect('/login')
  if ((await getStoreRole()) !== 'owner') redirect('/conversas')

  // F1.4: consolida em 2 queries server-side os fetches que antes rolavam
  // separados (chat_slug aqui + store_settings/products no useEffect do
  // LojaForm). LojaForm passa a receber settings/categories via props.
  const [
    { data: settings },
    { data: productCategoryRows },
  ] = await Promise.all([
    supabase
      .from('store_settings')
      .select('*')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('products')
      .select('category')
      .eq('user_id', user.id),
  ])

  const availableCategories = [
    ...new Set(
      (productCategoryRows ?? [])
        .map((p) => p.category)
        .filter((c): c is string => !!c),
    ),
  ].sort()

  const slug = settings?.chat_slug ?? null

  const base = getAppUrl()
  const baseHost = base.replace(/^https?:\/\//, '')
  const fullUrl = slug ? `${base}/chat/${slug}` : ''
  const qrSvg = slug
    ? await QRCode.toString(fullUrl, {
        type: 'svg',
        width: 96,
        margin: 0,
        color: { dark: '#2E1065', light: '#FFFFFF' },
      })
    : null

  return (
    <div className="max-w-[920px] mx-auto px-4 sm:px-6 md:px-8 py-5 md:py-7">
      {/* Topbar */}
      <div className="flex flex-col gap-4 mb-6 md:mb-7 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="eyebrow text-ink-500">CONFIGURAÇÕES · LOJA</div>
          <h1
            className="font-display font-bold text-ink-900 tracking-tight mt-1.5 text-[22px] md:text-[26px] leading-tight"
          >
            Configurações da loja
          </h1>
          <p className="text-[13.5px] text-ink-500 mt-1.5 max-w-[60ch]">
            Defina como sua loja se apresenta e como o agente de IA conduz a
            conversa com seus clientes.
          </p>
        </div>
        {slug && (
          <div className="flex flex-wrap items-center gap-2 md:shrink-0">
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-success-700 bg-success-50 ring-1 ring-success-100 px-2 py-1 rounded-md">
              <span className="live-dot" /> Publicado
            </span>
            <a
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              <Icon name="extern" className="w-4 h-4" />
              Pré-visualizar
            </a>
          </div>
        )}
      </div>

      {/* URL Card */}
      {slug ? (
        <section className="url-card p-4 sm:p-6 mb-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="chip chip-brand"
                  style={{ width: 28, height: 28, borderRadius: 9 }}
                >
                  <Icon name="link" />
                </span>
                <h3 className="font-display font-bold text-brand-900 text-[15px]">
                  Link público do seu chat
                </h3>
              </div>
              <p className="text-[12.5px] text-brand-800/80 mb-3.5">
                Compartilhe nas redes sociais. Seus clientes conversam direto
                com o agente de IA.
              </p>
              <div className="url-pill flex-wrap gap-y-2">
                <span className="text-brand-400 break-all">{baseHost}/chat/</span>
                <span className="slug break-all">{slug}</span>
                <div className="basis-full sm:basis-auto sm:ml-auto flex items-center gap-1.5">
                  <LojaCopyButton value={fullUrl} />
                  <a
                    href={fullUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary"
                    style={{ padding: '6px 10px', fontSize: 11.5 }}
                  >
                    <Icon name="extern" className="w-3.5 h-3.5" />
                    Abrir
                  </a>
                </div>
              </div>
            </div>

            {qrSvg && (
              <div className="flex flex-col items-center gap-2 self-start">
                <div
                  className="qr-tile"
                  aria-label="QR code do link da loja"
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
                <span className="eyebrow text-brand-700">QR · IMPRIMA</span>
              </div>
            )}
          </div>
        </section>
      ) : (
        <div className="card p-5 mb-6 text-[13px] text-ink-600">
          Salve as configurações da loja para gerar a URL pública do seu chat.
        </div>
      )}

      <LojaForm
        userId={user.id}
        settings={settings ?? null}
        availableCategories={availableCategories}
      />

      <footer className="mt-2 mb-4 flex items-center justify-between text-[12px] text-ink-400">
        <div className="eyebrow">LUE FZ</div>
        <div className="eyebrow">CONFIGURAÇÕES · PT-BR</div>
      </footer>
    </div>
  )
}
