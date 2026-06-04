import { describe, it, expect } from 'vitest'
import { extractVariantOptions } from '../inventory/sync'

function v(nome: string) {
  return { id: nome, nome, preco: 0, preco_promocional: null }
}

describe('extractVariantOptions', () => {
  it('extrai cor e tamanho separados, deduplicando exatos', () => {
    const { cores, tamanhos } = extractVariantOptions([
      v('Vermelho P'),
      v('Vermelho M'),
    ])
    expect(cores).toEqual(['Vermelho'])
    expect(tamanhos).toEqual(['M', 'P'])
  })

  it('funde cores que diferem só na caixa, preferindo a forma com minúsculas', () => {
    const { cores } = extractVariantOptions([
      v('AMARELO GOLD M'),
      v('Amarelo Gold P'),
    ])
    expect(cores).toEqual(['Amarelo Gold'])
  })

  it('funde cores que diferem só no acento, preferindo a forma acentuada', () => {
    const { cores } = extractVariantOptions([
      v('FUCSIA P'),
      v('FÚCSIA M'),
    ])
    expect(cores).toEqual(['FÚCSIA'])
  })

  it('funde caixa e acento ao mesmo tempo numa única cor', () => {
    const { cores } = extractVariantOptions([
      v('CAFE M'),
      v('Café P'),
      v('CAFÉ G'),
    ])
    expect(cores).toEqual(['Café'])
  })
})

describe('extractVariantOptions - bicolor (pares preservados)', () => {
  it('mantém o par junto, normalizando ordem e caixa', () => {
    const { cores } = extractVariantOptions([
      v('AZUL/ROYAL P'),
      v('Royal/Azul M'),
    ])
    expect(cores).toEqual(['Azul/Royal'])
  })

  it('mantém o par mesmo com espaço depois da barra', () => {
    const { cores } = extractVariantOptions([
      v('MARSALA/ ROSA CLARO P'),
      v('Marsala/Rosa Claro M'),
    ])
    expect(cores).toEqual(['Marsala/Rosa Claro'])
  })

  it('usa a melhor forma de cada lado, compartilhada com a cor sólida', () => {
    const { cores } = extractVariantOptions([
      v('Fúcsia P'),
      v('FUCSIA/AREIA M'),
    ])
    expect(cores).toEqual(['AREIA/Fúcsia', 'Fúcsia'])
  })
})

describe('extractVariantOptions - typos (fuzzy conservador)', () => {
  it('funde nomes longos com 1 caractere de diferença', () => {
    const { cores } = extractVariantOptions([
      v('Rosa Gold P'),
      v('ROSA GOLG M'),
    ])
    expect(cores).toEqual(['Rosa Gold'])
  })

  it('NÃO funde nomes curtos parecidos', () => {
    const { cores } = extractVariantOptions([
      v('Rosa P'),
      v('Rose M'),
    ])
    expect(cores).toEqual(['Rosa', 'Rose'])
  })
})
