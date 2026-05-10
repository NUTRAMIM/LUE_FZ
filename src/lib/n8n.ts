/**
 * Dispatch a customer chat message to the n8n webhook.
 * Echo mode (returns null without calling) when N8N_WEBHOOK_URL is unset.
 */
export interface N8nDispatchPayload {
  mensagem: string
  id_mensagem: string
  id_conversa: string
  nome_loja: string
  id_loja: string
  tipo_de_mensagem: 'text' | 'image' | 'audio'
  media_url?: string
}

export async function dispatchToN8n(
  payload: N8nDispatchPayload,
): Promise<Response | null> {
  const webhookUrl = process.env.N8N_WEBHOOK_URL
  if (!webhookUrl) return null

  const secret = process.env.N8N_WEBHOOK_SECRET
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (secret) headers['X-Webhook-Secret'] = secret

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    console.error(`n8n webhook failed: ${res.status} ${res.statusText}`)
  }

  return res
}
