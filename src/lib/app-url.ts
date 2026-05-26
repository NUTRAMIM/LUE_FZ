// Resolve a base URL pública (sem trailing slash). Server-only — usa env vars
// que Vercel injeta no build/runtime quando NEXT_PUBLIC_APP_URL não está setado.
// Ordem de prioridade:
//   1. NEXT_PUBLIC_APP_URL     — override manual (qualquer ambiente)
//   2. VERCEL_PROJECT_PRODUCTION_URL — domínio de produção estável no Vercel
//   3. VERCEL_URL              — URL do deployment atual (preview/branch)
//   4. http://localhost:3000   — fallback de dev
export function getAppUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (explicit) return explicit.replace(/\/$/, '')

  const prodHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  if (prodHost) return `https://${prodHost.replace(/\/$/, '')}`

  const deployHost = process.env.VERCEL_URL?.trim()
  if (deployHost) return `https://${deployHost.replace(/\/$/, '')}`

  return 'http://localhost:3000'
}
