import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { ConviteForm } from './ConviteForm'

export const dynamic = 'force-dynamic'

type Status =
  | { kind: 'valid'; storeName: string; email: string; token: string }
  | { kind: 'expired' }
  | { kind: 'used' }
  | { kind: 'invalid' }

async function resolveStatus(token: string): Promise<Status> {
  if (!token) return { kind: 'invalid' }
  const admin = createAdminClient()
  const { data: invite } = await admin
    .from('store_invites')
    .select('email, store_id, expires_at, accepted_at')
    .eq('token', token)
    .maybeSingle()
  if (!invite) return { kind: 'invalid' }
  if (invite.accepted_at) return { kind: 'used' }
  if (new Date(invite.expires_at) <= new Date()) return { kind: 'expired' }

  const { data: store } = await admin
    .from('store_settings')
    .select('store_name')
    .eq('id', invite.store_id)
    .maybeSingle()
  return {
    kind: 'valid',
    storeName: store?.store_name ?? 'a loja',
    email: invite.email,
    token,
  }
}

function MessageCard({
  title,
  body,
  actionHref,
  actionLabel,
}: {
  title: string
  body: string
  actionHref?: string
  actionLabel?: string
}) {
  return (
    <div className="bg-brand-mesh relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="relative w-full max-w-md rounded-2xl border border-white bg-white/95 p-8 shadow-[0_30px_80px_-30px_rgba(76,29,149,0.35)]">
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
          {title}
        </h1>
        <p className="mt-2 text-sm text-slate-600">{body}</p>
        {actionHref && actionLabel && (
          <Link
            href={actionHref}
            className="bg-brand-600 hover:bg-brand-700 active:bg-brand-800 focus-visible:ring-brand-400 mt-6 inline-flex h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold text-white shadow-[0_6px_18px_-6px_rgba(124,58,237,0.55)] transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            {actionLabel}
          </Link>
        )}
      </div>
    </div>
  )
}

export default async function ConvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const status = await resolveStatus(token)

  if (status.kind === 'expired') {
    return (
      <MessageCard
        title="Convite expirado"
        body="Esse link de convite passou da validade. Peça outro pro dono da loja."
      />
    )
  }
  if (status.kind === 'used') {
    return (
      <MessageCard
        title="Você já tem conta"
        body="Esse convite já foi aceito e sua conta de vendedor já existe. Entre com seu email e a senha que você definiu pra acessar o painel."
        actionHref="/login"
        actionLabel="Ir para o login"
      />
    )
  }
  if (status.kind === 'invalid') {
    return (
      <MessageCard
        title="Convite inválido"
        body="Esse link não é válido. Confira com o dono da loja."
      />
    )
  }

  return (
    <ConviteForm
      storeName={status.storeName}
      email={status.email}
      token={status.token}
    />
  )
}
