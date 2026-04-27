/**
 * Dispatch a message to the n8n webhook.
 * Currently in echo mode (n8n integration is deferred).
 * When ready, set N8N_WEBHOOK_URL in .env.local to enable.
 */
export async function dispatchToN8n(payload: {
  conversation_id: string
  message_id: string
  content: string
  visitor_id: string
}) {
  const webhookUrl = process.env.N8N_WEBHOOK_URL
  if (!webhookUrl) {
    // n8n not configured — echo mode
    return null
  }

  const secret = process.env.N8N_WEBHOOK_SECRET
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'X-Webhook-Secret': secret } : {}),
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    console.error(`n8n webhook failed: ${res.status} ${res.statusText}`)
  }

  return res
}
