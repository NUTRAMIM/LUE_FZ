import { MercadoPagoConfig, Payment } from 'mercadopago'

// Cliente Mercado Pago v2 server-only. NUNCA importar isso em código que
// roda no client — `MERCADOPAGO_ACCESS_TOKEN` é segredo.
//
// Lazy: env de runtime não está disponível durante build/collect page data.

let _payment: Payment | null = null

export function getMpPayment(): Payment {
  if (_payment) return _payment
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN
  if (!token) {
    throw new Error('MERCADOPAGO_ACCESS_TOKEN is not configured')
  }
  const client = new MercadoPagoConfig({ accessToken: token })
  _payment = new Payment(client)
  return _payment
}
