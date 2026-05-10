import { describe, it, expect, beforeEach } from 'vitest'
import {
  COOKIE_NAME,
  buildVisitorCookieValue,
  parseVisitorCookieValue,
  generateVisitorId,
} from '../visitor-cookie'

const SECRET = 'dGVzdC1zZWNyZXQtZm9yLXVuaXQtdGVzdHM='

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET
})

describe('visitor-cookie', () => {
  it('exports the cookie name lue_visitor', () => {
    expect(COOKIE_NAME).toBe('lue_visitor')
  })

  it('generateVisitorId returns a UUID v4', () => {
    const id = generateVisitorId()
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('roundtrips: build then parse returns the original visitor_id', () => {
    const id = generateVisitorId()
    const cookie = buildVisitorCookieValue(id)
    expect(parseVisitorCookieValue(cookie)).toBe(id)
  })

  it('parse rejects empty string', () => {
    expect(parseVisitorCookieValue('')).toBeNull()
  })

  it('parse rejects malformed value (no dot)', () => {
    expect(parseVisitorCookieValue('justastring')).toBeNull()
  })

  it('parse rejects tampered visitor_id (wrong signature)', () => {
    const id = generateVisitorId()
    const cookie = buildVisitorCookieValue(id)
    const [, sig] = cookie.split('.')
    const tampered = `00000000-0000-4000-8000-000000000000.${sig}`
    expect(parseVisitorCookieValue(tampered)).toBeNull()
  })

  it('parse rejects when SESSION_SECRET differs', () => {
    const id = generateVisitorId()
    const cookie = buildVisitorCookieValue(id)
    process.env.SESSION_SECRET = 'ZGlmZmVyZW50LXNlY3JldA=='
    expect(parseVisitorCookieValue(cookie)).toBeNull()
  })

  it('build throws if SESSION_SECRET is missing', () => {
    delete process.env.SESSION_SECRET
    expect(() => buildVisitorCookieValue(generateVisitorId())).toThrow(
      /SESSION_SECRET/,
    )
  })
})
