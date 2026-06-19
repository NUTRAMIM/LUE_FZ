import dns from 'node:dns/promises'
import net from 'node:net'

// ---------------------------------------------------------------------------
// SSRF guard compartilhado: usado antes de QUALQUER fetch server-side de uma URL
// que veio do usuário/catálogo (import de inventário, proxy de imagem). Sem isso
// o servidor podia ser induzido a buscar endpoints internos da infra (metadata
// cloud 169.254.169.254, serviços internos do EasyPanel, etc).
// ---------------------------------------------------------------------------

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true // link-local + metadata cloud
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    return false
  }
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  if (lower.startsWith('fe80')) return true // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // ULA
  if (lower.startsWith('::ffff:')) return isPrivateIp(lower.slice('::ffff:'.length))
  return false
}

// Valida que a URL é pública antes de qualquer fetch. Resolve o host e rejeita
// se qualquer IP cair em faixa privada/loopback/link-local. (Não cobre 100% do
// TOCTOU de DNS-rebinding nem redirects para host interno — risco residual
// aceitável; o vetor principal, URL interna direta, fica fechado.)
export async function assertPublicUrl(raw: string): Promise<void> {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    throw new Error('URL inválida.')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('URL deve usar http ou https.')
  }
  const host = u.hostname
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new Error('URL aponta para um host interno.')
  }
  let addrs: { address: string }[]
  try {
    addrs = await dns.lookup(host, { all: true })
  } catch {
    throw new Error('Não foi possível resolver o host da URL.')
  }
  for (const { address } of addrs) {
    if (isPrivateIp(address)) {
      throw new Error('URL aponta para um endereço de rede interna.')
    }
  }
}
