import { Resend } from 'resend'

let client: Resend | null = null

/** Devolve o client Resend, instanciando sob demanda. Lança se a key faltar. */
export function getResend(): Resend {
  if (!client) {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      throw new Error('RESEND_API_KEY ausente no ambiente.')
    }
    client = new Resend(apiKey)
  }
  return client
}
