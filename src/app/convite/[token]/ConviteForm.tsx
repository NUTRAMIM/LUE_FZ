'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { acceptInvite } from '@/actions/equipe'
import { createClient } from '@/lib/supabase/client'
import { Wordmark } from '@/components/ui/Wordmark'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/Input'

export function ConviteForm({
  storeName,
  email,
  token,
}: {
  storeName: string
  email: string
  token: string
}) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 6) {
      setError('A senha precisa ter ao menos 6 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.')
      return
    }
    setLoading(true)

    const res = await acceptInvite({ token, password })
    if (!res.ok || !res.email) {
      setError(res.error ?? 'Não foi possível aceitar o convite.')
      setLoading(false)
      return
    }

    // Conta criada — loga no browser pra pegar a sessão antes do redirect.
    const supabase = createClient()
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email: res.email,
      password,
    })
    if (signErr) {
      setError(
        'Conta criada, mas falhou ao entrar. Use a tela de login.',
      )
      setLoading(false)
      return
    }

    router.refresh()
    router.push('/conversas')
  }

  return (
    <div className="bg-brand-mesh relative flex min-h-screen items-center justify-center px-4 py-10">
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <Wordmark size="lg" />
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
            Convite de vendedor
          </p>
        </div>

        <div className="rounded-2xl border border-white bg-white/95 p-8 shadow-[0_30px_80px_-30px_rgba(76,29,149,0.35)]">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Você foi convidado pra {storeName}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Defina uma senha pra acessar o painel de vendas.
          </p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-5">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} readOnly />
            </div>
            <div>
              <Label htmlFor="password">Nova senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="mínimo 6 caracteres"
              />
            </div>
            <div>
              <Label htmlFor="confirm">Confirmar senha</Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={6}
              />
            </div>

            {error && (
              <div className="bg-danger-soft border-danger/20 rounded-lg border px-3 py-2">
                <p className="text-danger text-sm font-medium">{error}</p>
              </div>
            )}

            <Button type="submit" disabled={loading} size="lg" className="w-full">
              {loading ? 'Entrando…' : 'Aceitar e entrar'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
