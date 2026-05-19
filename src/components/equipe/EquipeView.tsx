'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createVendor, removeVendor, type MemberRow } from '@/actions/equipe'
import { Input, Label } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

export function EquipeView({ members }: { members: MemberRow[] }) {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const res = await createVendor({ fullName, email, password })
      if (!res.ok) {
        setError(res.error ?? 'Erro ao adicionar vendedor.')
        return
      }
      setFullName('')
      setEmail('')
      setPassword('')
      router.refresh()
    })
  }

  function handleRemove(memberId: string) {
    startTransition(async () => {
      const res = await removeVendor(memberId)
      if (res.ok) router.refresh()
      else setError(res.error ?? 'Erro ao remover vendedor.')
    })
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

      <div className="card mt-6 divide-y divide-ink-100">
        {members.map((m) => (
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

      <form onSubmit={handleAdd} className="card mt-6 p-5 space-y-4">
        <div
          className="font-display font-bold text-ink-900"
          style={{ fontSize: '16px' }}
        >
          Adicionar vendedor
        </div>
        <div>
          <Label htmlFor="v-name">Nome</Label>
          <Input
            id="v-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            placeholder="Nome do vendedor"
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
          />
        </div>
        <div>
          <Label htmlFor="v-pass">Senha provisória</Label>
          <Input
            id="v-pass"
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            placeholder="mín. 6 caracteres"
          />
        </div>
        {error && (
          <p className="text-[13px] font-medium text-danger-700">{error}</p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? 'Adicionando…' : 'Adicionar vendedor'}
        </Button>
      </form>
    </div>
  )
}
