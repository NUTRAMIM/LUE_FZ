import { describe, it, expect } from 'vitest'
import { parseSegments, groupConsecutiveImages } from '../message-segments'

describe('parseSegments', () => {
  it('retorna texto único quando não há URL de imagem', () => {
    const { segments, hasImage } = parseSegments('olá tudo bem?')
    expect(hasImage).toBe(false)
    expect(segments).toEqual([{ type: 'text', value: 'olá tudo bem?' }])
  })

  it('detecta URL de imagem isolada', () => {
    const { segments, hasImage } = parseSegments('https://x.com/a.jpg')
    expect(hasImage).toBe(true)
    expect(segments).toEqual([{ type: 'image', src: 'https://x.com/a.jpg' }])
  })

  it('intercala texto e múltiplas imagens preservando ordem', () => {
    const text = 'veja: https://x.com/a.jpg e https://x.com/b.png aqui'
    const { segments } = parseSegments(text)
    expect(segments).toEqual([
      { type: 'text', value: 'veja:' },
      { type: 'image', src: 'https://x.com/a.jpg' },
      { type: 'text', value: 'e' },
      { type: 'image', src: 'https://x.com/b.png' },
      { type: 'text', value: 'aqui' },
    ])
  })

  it('reconhece jpg, jpeg, png, webp, gif com querystring', () => {
    const { segments } = parseSegments(
      'a https://x.com/1.jpg b https://x.com/2.jpeg?w=100 c https://x.com/3.PNG d https://x.com/4.webp e https://x.com/5.gif',
    )
    const images = segments.filter((s) => s.type === 'image')
    expect(images).toHaveLength(5)
  })
})

describe('groupConsecutiveImages', () => {
  it('mantém array vazio', () => {
    expect(groupConsecutiveImages([])).toEqual([])
  })

  it('preserva texto isolado', () => {
    expect(groupConsecutiveImages([{ type: 'text', value: 'oi' }])).toEqual([
      { type: 'text', value: 'oi' },
    ])
  })

  it('mantém uma imagem solitária como image', () => {
    expect(
      groupConsecutiveImages([{ type: 'image', src: 'a.jpg' }]),
    ).toEqual([{ type: 'image', src: 'a.jpg' }])
  })

  it('agrupa 2+ imagens consecutivas em imageGroup', () => {
    expect(
      groupConsecutiveImages([
        { type: 'image', src: 'a.jpg' },
        { type: 'image', src: 'b.jpg' },
        { type: 'image', src: 'c.jpg' },
      ]),
    ).toEqual([{ type: 'imageGroup', srcs: ['a.jpg', 'b.jpg', 'c.jpg'] }])
  })

  it('mantém imagens separadas por texto como isoladas', () => {
    expect(
      groupConsecutiveImages([
        { type: 'image', src: 'a.jpg' },
        { type: 'text', value: 'meio' },
        { type: 'image', src: 'b.jpg' },
      ]),
    ).toEqual([
      { type: 'image', src: 'a.jpg' },
      { type: 'text', value: 'meio' },
      { type: 'image', src: 'b.jpg' },
    ])
  })

  it('agrupa só onde há ≥2 consecutivas, mantendo isoladas como isoladas', () => {
    expect(
      groupConsecutiveImages([
        { type: 'text', value: 'a' },
        { type: 'image', src: '1.jpg' },
        { type: 'image', src: '2.jpg' },
        { type: 'text', value: 'b' },
        { type: 'image', src: '3.jpg' },
      ]),
    ).toEqual([
      { type: 'text', value: 'a' },
      { type: 'imageGroup', srcs: ['1.jpg', '2.jpg'] },
      { type: 'text', value: 'b' },
      { type: 'image', src: '3.jpg' },
    ])
  })
})
