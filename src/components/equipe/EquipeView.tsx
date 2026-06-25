'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createInvite,
  revokeInvite,
  removeVendor,
  type EquipeData,
} from '@/actions/equipe'
import { Input, Label } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

function expiresInDays(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
}

export function EquipeView({ data }: { data: EquipeData }) {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const totalUsed = data.agentCount + data.pendingCount
  const atLimit = data.maxAgents > 0 && totalUsed >= data.maxAgents
  const noPlan = data.maxAgents === 0

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLastInviteUrl(null)
    startTransition(async () => {
      const res = await createInvite({ fullName, email })
      if (!res.ok || !res.url) {
        if (res.error === 'subscription_required') {
          window.location.href = '/planos'
          return
        }
        setError(res.error ?? 'Erro ao criar convite.')
        return
      }
      setFullName('')
      setEmail('')
      setLastInviteUrl(res.url)
      router.refresh()
    })
  }

  function handleRevoke(inviteId: string) {
    setError(null)
    startTransition(async () => {
      const res = await revokeInvite(inviteId)
      if (res.ok) router.refresh()
      else setError(res.error ?? 'Erro ao revogar convite.')
    })
  }

  function handleRemove(memberId: string) {
    setError(null)
    startTransition(async () => {
      const res = await removeVendor(memberId)
      if (res.ok) router.refresh()
      else setError(res.error ?? 'Erro ao remover vendedor.')
    })
  }

  async function handleCopy(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1400)
    } catch {
      // ignore
    }
  }

  return (
    <div className="max-w-[860px] mx-auto px-8 py-7">
      <div className="eyebrow text-ink-500">EQUIPE</div>
      <h1
        className="font-display font-bold text-ink-900 tracking-tight mt-1"
        style={{ fontSize: '26px' }}
      >
        Vendedores
      </h1>

      {/* Card de uso do plano */}
      <div className="card mt-6 p-5 flex items-center gap-3">
        <div className="flex-1">
          {noPlan ? (
            <p className="text-[13.5px] text-ink-700">
              Ative seu plano pra adicionar vendedores.
            </p>
          ) : (
            <p className="text-[13.5px] text-ink-700">
              <span className="font-semibold text-ink-900">
                {totalUsed} de {data.maxAgents}
              </span>{' '}
              vagas usadas
              {data.pendingCount > 0 && (
                <span className="text-ink-500">
                  {' '}
                  ({data.pendingCount} pendente{data.pendingCount > 1 ? 's' : ''})
                </span>
              )}
            </p>
          )}
        </div>
        {atLimit && !noPlan && (
          <span className="eyebrow text-danger-700 bg-danger-50 px-2 py-1 rounded-md">
            LIMITE ATINGIDO
          </span>
        )}
      </div>

      {/* Lista de membros */}
      <div className="card mt-6 divide-y divide-ink-100">
        {data.members.length === 0 && (
          <div className="px-5 py-6 text-[13px] text-ink-500">
            Nenhum membro ainda.
          </div>
        )}
        {data.members.map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-ink-900 truncate">
                {m.fullName}
              </div>
              <div className="text-[12.5px] text-ink-500 truncate">
                {m.email}
              </div>
            </div>
            <span className="eyebrow text-ink-400">
              {m.role === 'owner' ? 'DONO' : 'VENDEDOR'}
            </span>
            {m.role === 'agent' && (
              <button
                type="button"
                onClick={() => handleRemove(m.id)}
                disabled={pending}
                className="text-[12.5px] font-semibold text-danger-700 hover:text-danger-800 disabled:opacity-50"
              >
                Remover
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Lista de convites pendentes */}
      {data.invites.length > 0 && (
        <div className="card mt-6 divide-y divide-ink-100">
          <div className="px-5 py-3 eyebrow text-ink-500">
            CONVITES PENDENTES
          </div>
          {data.invites.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center gap-3 px-5 py-3.5"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-ink-900 truncate">
                  {inv.fullName}
                </div>
                <div className="text-[12.5px] text-ink-500 truncate">
                  {inv.email}
                </div>
              </div>
              <span className="eyebrow text-ink-400">
                EXPIRA EM {expiresInDays(inv.expiresAt)}D
              </span>
              <button
                type="button"
                onClick={() => handleCopy(inv.url, inv.id)}
                disabled={pending}
                className="text-[12.5px] font-semibold text-brand-700 hover:text-brand-800 disabled:opacity-50"
              >
                {copiedId === inv.id ? 'Copiado!' : 'Copiar link'}
              </button>
              <button
                type="button"
                onClick={() => handleRevoke(inv.id)}
                disabled={pending}
                className="text-[12.5px] font-semibold text-danger-700 hover:text-danger-800 disabled:opacity-50"
              >
                Revogar
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Form de convite */}
      <form
        onSubmit={handleAdd}
        className={`card mt-6 p-5 space-y-4 ${
          atLimit || noPlan ? 'opacity-60' : ''
        }`}
      >
        <div
          className="font-display font-bold text-ink-900"
          style={{ fontSize: '16px' }}
        >
          Convidar vendedor
        </div>
        <div>
          <Label htmlFor="v-name">Nome</Label>
          <Input
            id="v-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            placeholder="Nome do vendedor"
            disabled={atLimit || noPlan || pending}
          />
        </div>
        <div>
          <Label htmlFor="v-email">Email</Label>
          <Input
            id="v-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="vendedor@email.com"
            disabled={atLimit || noPlan || pending}
          />
        </div>
        {error && (
          <p className="text-[13px] font-medium text-danger-700">{error}</p>
        )}
        {lastInviteUrl && (
          <div className="rounded-lg border border-success-200 bg-success-50 px-3 py-2.5 space-y-2">
            <p className="text-[13px] font-semibold text-success-800">
              Convite criado! Mande esse link pro vendedor:
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={lastInviteUrl}
                readOnly
                className="input flex-1 text-[12px]"
              />
              <button
                type="button"
                onClick={() => handleCopy(lastInviteUrl, 'last')}
                className="text-[12.5px] font-semibold text-brand-700 hover:text-brand-800"
              >
                {copiedId === 'last' ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
            <p className="text-[11.5px] text-success-700/80">
              Link expira em 7 dias.
            </p>
          </div>
        )}
        <Button type="submit" disabled={pending || atLimit || noPlan}>
          {pending ? 'Convidando…' : 'Gerar link de convite'}
        </Button>
      </form>
    </div>
  )
}
