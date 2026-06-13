'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Wordmark } from '@/components/ui/Wordmark'
import { Button } from '@/components/ui/Button'
import { Input, Label } from '@/components/ui/Input'
import { IconMail, IconLock, IconArrowRight } from '@/components/icons'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<'login' | 'signup' | 'forgot'>('login')
  const isSignUp = view === 'signup'
  const isForgot = view === 'forgot'
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()

    if (isForgot) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password`,
      })
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
      setSuccessMsg(
        'Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha.',
      )
      setLoading(false)
      return
    }

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
      setError(null)
      setView('login')
      setPassword('')
      setSuccessMsg('Conta criada! Verifique seu email para confirmar, depois faça login.')
      setLoading(false)
      return
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    router.refresh()
    // Reentra em /login com sessão ativa — middleware decide o destino
    // (agent → /conversas, owner → /painel) num único redirect.
    router.push('/login')
  }

  return (
    <div className="bg-brand-mesh relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* Decorative orbs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -right-32 h-[40rem] w-[40rem] rounded-full bg-brand-300/30 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 -left-32 h-[36rem] w-[36rem] rounded-full bg-fuchsia-300/25 blur-3xl"
      />

      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <Wordmark size="lg" />
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-slate-500">
            Painel do Operador
          </p>
        </div>

        <div className="rounded-2xl border border-white bg-white/95 p-8 shadow-[0_30px_80px_-30px_rgba(76,29,149,0.35)] backdrop-blur-sm">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            {isForgot
              ? 'Recuperar senha'
              : isSignUp
                ? 'Criar uma conta'
                : 'Bem-vindo de volta'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {isForgot
              ? 'Enviaremos um link para redefinir sua senha.'
              : isSignUp
                ? 'Configure seu acesso em 30 segundos.'
                : 'Entre para acessar seu painel.'}
          </p>

          <form onSubmit={handleSubmit} className="mt-7 space-y-5">
            <div>
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <IconMail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="operador@empresa.com"
                  className="pl-10"
                />
              </div>
            </div>

            {!isForgot && (
              <div>
                <Label htmlFor="password">Senha</Label>
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
                <div className="mt-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setView('forgot')
                      setError(null)
                      setSuccessMsg(null)
                    }}
                    className="text-xs font-medium text-brand-600 hover:text-brand-700"
                  >
                    Esqueceu a senha?
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-danger-soft border-danger/20 rounded-lg border px-3 py-2">
                <p className="text-danger text-sm font-medium">{error}</p>
              </div>
            )}
            {successMsg && (
              <div className="bg-success-soft border-success/20 rounded-lg border px-3 py-2">
                <p className="text-success text-sm font-medium">{successMsg}</p>
              </div>
            )}

            <Button type="submit" disabled={loading} size="lg" className="w-full">
              {loading ? (
                isForgot ? (
                  'Enviando...'
                ) : isSignUp ? (
                  'Criando...'
                ) : (
                  'Entrando...'
                )
              ) : (
                <>
                  {isForgot
                    ? 'Enviar link'
                    : isSignUp
                      ? 'Criar conta'
                      : 'Entrar'}
                  <IconArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              ou
            </span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <p className="mt-5 text-center text-sm text-slate-600">
            {isForgot ? (
              <>
                Lembrou a senha?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setView('login')
                    setError(null)
                    setSuccessMsg(null)
                  }}
                  className="font-semibold text-brand-600 transition-colors hover:text-brand-700"
                >
                  Voltar ao login
                </button>
              </>
            ) : (
              <>
                {isSignUp ? 'Já tem uma conta?' : 'Ainda não tem conta?'}{' '}
                <button
                  type="button"
                  onClick={() => {
                    setView(isSignUp ? 'login' : 'signup')
                    setError(null)
                    setSuccessMsg(null)
                  }}
                  className="font-semibold text-brand-600 transition-colors hover:text-brand-700"
                >
                  {isSignUp ? 'Fazer login' : 'Criar conta'}
                </button>
              </>
            )}
          </p>
        </div>

        <p className="mt-6 text-center text-[11px] text-slate-400">
          © 2026 LUE · Acesso seguro ·{' '}
          <a href="/termos" className="underline hover:text-slate-600">
            Termos e Privacidade
          </a>
        </p>
      </div>
    </div>
  )
}
