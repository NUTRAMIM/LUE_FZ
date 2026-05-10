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

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/chat',
  maxAge: 60 * 60 * 24 * 365,
}
