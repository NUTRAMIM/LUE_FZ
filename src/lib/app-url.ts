// Domínio canônico de produção — apontado na Vercel para este app.
const PRODUCTION_URL = 'https://ialue.com.br'

// Resolve a base URL pública (sem trailing slash). Server-only — usa env vars
// que Vercel injeta no build/runtime quando NEXT_PUBLIC_APP_URL não está setado.
// Ordem de prioridade:
//   1. ialue.com.br         — domínio canônico em produção (VERCEL_ENV=production),
//                             vence sempre pra não vazar a URL da Vercel no link público
//   2. NEXT_PUBLIC_APP_URL  — override manual (preview/dev)
//   3. VERCEL_URL           — URL do deployment atual (preview/branch)
//   4. http://localhost:3000 — fallback de dev
export function getAppUrl(): string {
  if (process.env.VERCEL_ENV === 'production') return PRODUCTION_URL

  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, '')

  const deployHost = process.env.VERCEL_URL?.trim()
  if (deployHost) return `https://${deployHost.replace(/\/$/, '')}`

  return 'http://localhost:3000'
}
