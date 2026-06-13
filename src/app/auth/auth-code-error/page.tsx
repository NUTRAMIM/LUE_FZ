import Link from 'next/link'
import { Wordmark } from '@/components/ui/Wordmark'

export default function AuthCodeErrorPage() {
  return (
    <div className="bg-brand-mesh relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <Wordmark size="lg" />
        </div>
        <div className="rounded-2xl border border-white bg-white/95 p-8 text-center shadow-[0_30px_80px_-30px_rgba(76,29,149,0.35)] backdrop-blur-sm">
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Link inválido ou expirado
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Este link de confirmação não é mais válido. Tente fazer login novamente
            ou peça um novo link de redefinição de senha.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-brand-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Voltar ao login
          </Link>
        </div>
      </div>
    </div>
  )
}
