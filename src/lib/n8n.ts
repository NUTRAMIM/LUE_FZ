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

export function resolveWebhookUrl(
  storeId: string,
  env: { N8N_WEBHOOK_URL?: string; CHAT_PY_WEBHOOK_URL?: string; CHAT_PY_STORE_IDS?: string } = process.env,
): string | undefined {
  const pyStores = (env.CHAT_PY_STORE_IDS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  if (env.CHAT_PY_WEBHOOK_URL && pyStores.includes(storeId)) {
    return env.CHAT_PY_WEBHOOK_URL
  }
  return env.N8N_WEBHOOK_URL
}

export async function dispatchToN8n(
  payload: N8nDispatchPayload,
): Promise<Response | null> {
  const webhookUrl = resolveWebhookUrl(payload.id_loja)
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
