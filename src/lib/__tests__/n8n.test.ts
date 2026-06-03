import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { dispatchToN8n, resolveWebhookUrl } from '../n8n'

describe('dispatchToN8n', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.N8N_WEBHOOK_URL
    delete process.env.N8N_WEBHOOK_SECRET
  })

  it('returns null when N8N_WEBHOOK_URL is unset (echo mode)', async () => {
    const result = await dispatchToN8n({
      mensagem: 'oi',
      id_mensagem: 'm1',
      id_conversa: 'c1',
      nome_loja: 'Loja',
      id_loja: 's1',
      tipo_de_mensagem: 'text',
    })
    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POSTs the full payload to the configured URL', async () => {
    process.env.N8N_WEBHOOK_URL = 'https://n8n.example/webhook/chat'
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    await dispatchToN8n({
      mensagem: 'oi',
      id_mensagem: 'm1',
      id_conversa: 'c1',
      nome_loja: 'Minha Loja',
      id_loja: 's1',
      tipo_de_mensagem: 'text',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://n8n.example/webhook/chat')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({
      mensagem: 'oi',
      id_mensagem: 'm1',
      id_conversa: 'c1',
      nome_loja: 'Minha Loja',
      id_loja: 's1',
      tipo_de_mensagem: 'text',
    })
  })

  it('includes X-Webhook-Secret header when N8N_WEBHOOK_SECRET is set', async () => {
    process.env.N8N_WEBHOOK_URL = 'https://n8n.example/webhook/chat'
    process.env.N8N_WEBHOOK_SECRET = 'shh'
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    await dispatchToN8n({
      mensagem: 'oi',
      id_mensagem: 'm1',
      id_conversa: 'c1',
      nome_loja: 'Loja',
      id_loja: 's1',
      tipo_de_mensagem: 'text',
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['X-Webhook-Secret']).toBe('shh')
  })

  it('includes media_url when provided (for image/audio)', async () => {
    process.env.N8N_WEBHOOK_URL = 'https://n8n.example/webhook/chat'
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))

    await dispatchToN8n({
      mensagem: '',
      id_mensagem: 'm1',
      id_conversa: 'c1',
      nome_loja: 'Loja',
      id_loja: 's1',
      tipo_de_mensagem: 'image',
      media_url: 'https://signed.example/foo.jpg',
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body)
    expect(body.tipo_de_mensagem).toBe('image')
    expect(body.media_url).toBe('https://signed.example/foo.jpg')
  })

  it('does not throw on 5xx', async () => {
    process.env.N8N_WEBHOOK_URL = 'https://n8n.example/webhook/chat'
    fetchMock.mockResolvedValue(new Response('boom', { status: 502 }))

    const res = await dispatchToN8n({
      mensagem: 'oi',
      id_mensagem: 'm1',
      id_conversa: 'c1',
      nome_loja: 'Loja',
      id_loja: 's1',
      tipo_de_mensagem: 'text',
    })

    expect(res?.status).toBe(502)
  })
})

describe('resolveWebhookUrl', () => {
  it('uses python url for the test store', () => {
    const url = resolveWebhookUrl('store-test-123', {
      N8N_WEBHOOK_URL: 'https://n8n/webhook',
      CHAT_PY_WEBHOOK_URL: 'https://py/chat',
      CHAT_PY_STORE_IDS: 'store-test-123',
    })
    expect(url).toBe('https://py/chat')
  })

  it('falls back to n8n for other stores', () => {
    const url = resolveWebhookUrl('other', {
      N8N_WEBHOOK_URL: 'https://n8n/webhook',
      CHAT_PY_WEBHOOK_URL: 'https://py/chat',
      CHAT_PY_STORE_IDS: 'store-test-123',
    })
    expect(url).toBe('https://n8n/webhook')
  })
})
