import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

export const COOKIE_NAME = 'lue_visitor'

function getSecret(): Buffer {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    throw new Error('SESSION_SECRET env var is required for visitor cookie')
  }
  return Buffer.from(secret, 'base64')
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url')
}

export function generateVisitorId(): string {
  return randomUUID()
}

export function buildVisitorCookieValue(visitorId: string): string {
  return `${visitorId}.${sign(visitorId)}`
}

export function parseVisitorCookieValue(raw: string | undefined): string | null {
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot <= 0 || dot === raw.length - 1) return null
  const visitorId = raw.slice(0, dot)
  const providedSig = raw.slice(dot + 1)
  let expectedSig: string
  try {
    expectedSig = sign(visitorId)
  } catch {
    return null
  }
  const a = Buffer.from(providedSig)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length) return null
  if (!timingSafeEqual(a, b)) return null
  return visitorId
}

// Em produção o chat é embarcado em iframe cross-site (site do lojista), então
// o cookie de visitante só é enviado nesse contexto third-party com
// SameSite=None; Secure, + Partitioned (CHIPS) pra sobreviver ao bloqueio de
// cookies de terceiros dos navegadores (Safari/Chrome). Sem isto, o POST do
// sendMessage não recebe o cookie, o visitorId muda e a conversa "some"
// ("Conversa não encontrada"). Em dev (http://localhost) mantemos Lax porque
// None exige Secure e o cookie seria descartado sem HTTPS.
const IS_PROD = process.env.NODE_ENV === 'production'

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PROD,
  sameSite: (IS_PROD ? 'none' : 'lax') as 'none' | 'lax',
  partitioned: IS_PROD,
  path: '/chat',
  maxAge: 60 * 60 * 24 * 365,
}
