'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Wordmark } from '@/components/ui/Wordmark'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/Input'
import { IconLock, IconArrowRight } from '@/components/icons'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

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
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(
        'Não foi possível redefinir a senha. O link pode ter expirado — peça um novo em "Esqueceu a senha?".',
      )
      setLoading(false)
      return
    }

    router.refresh()
    router.push('/painel')
  }

  return (
    <div className="bg-brand-mesh relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <Wordmark size="lg" />
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
            Redefinir senha
          </p>
        </div>

        <div className="rounded-2xl border border-white bg-white/95 p-8 shadow-[0_30px_80px_-30px_rgba(76,29,149,0.35)] backdrop-blur-sm">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Criar nova senha
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Escolha uma nova senha para sua conta.
          </p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-5">
            <div>
              <Label htmlFor="password">Nova senha</Label>
              <div className="relative">
                <IconLock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="••••••••"
                  className="pl-10"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="confirm">Confirmar senha</Label>
              <div className="relative">
                <IconLock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={6}
                  placeholder="••••••••"
                  className="pl-10"
                />
              </div>
            </div>

            {error && (
              <div className="bg-danger-soft border-danger/20 rounded-lg border px-3 py-2">
                <p className="text-danger text-sm font-medium">{error}</p>
              </div>
            )}

            <Button type="submit" disabled={loading} size="lg" className="w-full">
              {loading ? (
                'Salvando...'
              ) : (
                <>
                  Salvar nova senha
                  <IconArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
