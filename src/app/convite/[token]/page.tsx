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
}: {
  title: string
  body: string
}) {
  return (
    <div className="bg-brand-mesh relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="relative w-full max-w-md rounded-2xl border border-white bg-white/95 p-8 shadow-[0_30px_80px_-30px_rgba(76,29,149,0.35)]">
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
          {title}
        </h1>
        <p className="mt-2 text-sm text-slate-600">{body}</p>
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
        title="Convite já usado"
        body="Esse link já foi aceito. Se você precisa de acesso, peça outro pro dono da loja."
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
