import { describe, it, expect } from 'vitest'
import { slugifyName, generateSku } from '../sku'

describe('slugifyName', () => {
  it('lowercases and kebab-cases simple names', () => {
    expect(slugifyName('Camiseta Azul')).toBe('camiseta-azul')
  })

  it('strips diacritics', () => {
    expect(slugifyName('Vestido Coração')).toBe('vestido-coracao')
  })

  it('collapses non-alphanumeric runs into single dash', () => {
    expect(slugifyName('Bermuda  ___  Verão  2025!!!')).toBe('bermuda-verao-2025')
  })

  it('trims leading/trailing dashes', () => {
    expect(slugifyName('---hello---')).toBe('hello')
  })

  it('truncates to 40 chars', () => {
    const long = 'a'.repeat(60)
    expect(slugifyName(long).length).toBe(40)
  })

  it('returns empty string for input with no alphanumerics', () => {
    expect(slugifyName('!!! ___ ???')).toBe('')
  })
})

describe('generateSku', () => {
  it('combines slug with 6-hex-char suffix', () => {
    const sku = generateSku('Camiseta Azul')
    expect(sku).toMatch(/^camiseta-azul-[0-9a-f]{6}$/)
  })

  it('falls back to "produto" prefix when slug is empty', () => {
    const sku = generateSku('!!!')
    expect(sku).toMatch(/^produto-[0-9a-f]{6}$/)
  })

  it('generates different suffixes on consecutive calls', () => {
    const suffixes = new Set(
      Array.from({ length: 20 }, () => generateSku('teste').split('-').pop()),
    )
    expect(suffixes.size).toBeGreaterThan(15)
  })
})
