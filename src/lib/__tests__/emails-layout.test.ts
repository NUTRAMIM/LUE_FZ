import { describe, it, expect } from 'vitest'
import { renderEmail } from '../emails/layout'

describe('renderEmail', () => {
  const html = renderEmail({
    preheader: 'pré-cabeçalho',
    heading: 'Título do e-mail',
    bodyHtml: '<p>corpo do e-mail</p>',
    ctaLabel: 'Clique aqui',
    ctaUrl: 'https://exemplo.test/acao',
    footnote: 'Se você não pediu isso, ignore.',
  })

  it('inclui o heading', () => {
    expect(html).toContain('Título do e-mail')
  })

  it('inclui o bodyHtml cru', () => {
    expect(html).toContain('<p>corpo do e-mail</p>')
  })

  it('inclui o botão com a URL e o label do CTA', () => {
    expect(html).toContain('https://exemplo.test/acao')
    expect(html).toContain('Clique aqui')
  })

  it('inclui a marca LUE e o footnote', () => {
    expect(html).toContain('LUE')
    expect(html).toContain('Se você não pediu isso, ignore.')
  })
})
