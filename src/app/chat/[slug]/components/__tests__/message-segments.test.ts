import { describe, it, expect } from 'vitest'
import { parseSegments, groupConsecutiveMedia } from '../message-segments'

describe('parseSegments', () => {
  it('retorna texto único quando não há URL de mídia', () => {
    const { segments, hasMedia } = parseSegments('olá tudo bem?')
    expect(hasMedia).toBe(false)
    expect(segments).toEqual([{ type: 'text', value: 'olá tudo bem?' }])
  })

  it('detecta URL de imagem isolada', () => {
    const { segments, hasMedia } = parseSegments('https://x.com/a.jpg')
    expect(hasMedia).toBe(true)
    expect(segments).toEqual([{ type: 'image', src: 'https://x.com/a.jpg' }])
  })

  it('detecta URL de vídeo (mp4/webm/mov)', () => {
    const { segments, hasMedia } = parseSegments(
      'a https://x.com/v.mp4 b https://x.com/w.webm c https://x.com/z.mov',
    )
    expect(hasMedia).toBe(true)
    expect(segments.filter((s) => s.type === 'video')).toEqual([
      { type: 'video', src: 'https://x.com/v.mp4' },
      { type: 'video', src: 'https://x.com/w.webm' },
      { type: 'video', src: 'https://x.com/z.mov' },
    ])
  })

  it('intercala imagens e vídeo preservando ordem', () => {
    const text = 'https://x.com/a.jpg https://x.com/b.png https://x.com/v.mp4'
    const { segments } = parseSegments(text)
    expect(segments).toEqual([
      { type: 'image', src: 'https://x.com/a.jpg' },
      { type: 'image', src: 'https://x.com/b.png' },
      { type: 'video', src: 'https://x.com/v.mp4' },
    ])
  })

  it('reconhece vídeo com querystring', () => {
    const { segments } = parseSegments('https://x.com/v.mp4?token=abc')
    expect(segments).toEqual([{ type: 'video', src: 'https://x.com/v.mp4?token=abc' }])
  })
})

describe('groupConsecutiveMedia', () => {
  it('mantém array vazio', () => {
    expect(groupConsecutiveMedia([])).toEqual([])
  })

  it('mantém uma imagem solitária como image', () => {
    expect(groupConsecutiveMedia([{ type: 'image', src: 'a.jpg' }])).toEqual([
      { type: 'image', src: 'a.jpg' },
    ])
  })

  it('mantém um vídeo solitário como video', () => {
    expect(groupConsecutiveMedia([{ type: 'video', src: 'v.mp4' }])).toEqual([
      { type: 'video', src: 'v.mp4' },
    ])
  })

  it('agrupa imagens + vídeo final num mediaGroup, com vídeo por último', () => {
    expect(
      groupConsecutiveMedia([
        { type: 'image', src: 'a.jpg' },
        { type: 'image', src: 'b.jpg' },
        { type: 'video', src: 'v.mp4' },
      ]),
    ).toEqual([
      {
        type: 'mediaGroup',
        items: [
          { type: 'image', src: 'a.jpg' },
          { type: 'image', src: 'b.jpg' },
          { type: 'video', src: 'v.mp4' },
        ],
      },
    ])
  })

  it('mídia separada por texto não agrupa', () => {
    expect(
      groupConsecutiveMedia([
        { type: 'image', src: 'a.jpg' },
        { type: 'text', value: 'meio' },
        { type: 'video', src: 'v.mp4' },
      ]),
    ).toEqual([
      { type: 'image', src: 'a.jpg' },
      { type: 'text', value: 'meio' },
      { type: 'video', src: 'v.mp4' },
    ])
  })
})
