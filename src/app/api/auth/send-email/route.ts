import { Webhook } from 'standardwebhooks'
import { getResend } from '@/lib/resend'
import { pickTemplate, buildActionUrl } from '@/lib/emails/hook'
import { getAppUrl } from '@/lib/app-url'

interface SendEmailPayload {
  user: { email: string }
  email_data: {
    token_hash: string
    email_action_type: string
    site_url: string
  }
}

export async function POST(request: Request) {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET
  if (!secret) {
    console.error('send-email hook: SEND_EMAIL_HOOK_SECRET ausente')
    return Response.json(
      { error: { http_code: 500, message: 'Configuração ausente.' } },
      { status: 500 },
    )
  }

  // Precisa do corpo CRU (string) para validar a assinatura — não usar req.json().
  const payload = await request.text()
  const headers = Object.fromEntries(request.headers)

  let data: SendEmailPayload
  try {
    // Secret vem como "v1,whsec_...". A lib standardwebhooks espera sem o "v1,".
    // Se a verificação falhar em runtime, testar remover "v1,whsec_" (ver spec).
    const wh = new Webhook(secret.replace(/^v1,/, ''))
    data = wh.verify(payload, headers) as SendEmailPayload
  } catch (err) {
    console.error('send-email hook: assinatura inválida', err)
    return Response.json(
      { error: { http_code: 401, message: 'Assinatura inválida.' } },
      { status: 401 },
    )
  }

  const { user, email_data } = data
  if (!user?.email || !email_data?.token_hash || !email_data?.email_action_type) {
    console.error('send-email hook: payload com formato inesperado')
    return Response.json(
      { error: { http_code: 400, message: 'Payload inválido.' } },
      { status: 400 },
    )
  }

  const template = pickTemplate(email_data.email_action_type)
  const actionUrl = buildActionUrl(email_data, getAppUrl())

  const { error } = await getResend().emails.send({
    from: process.env.EMAIL_FROM!,
    to: [user.email],
    subject: template.subject,
    html: template.render(actionUrl),
  })

  if (error) {
    console.error('send-email hook: falha no Resend', error)
    return Response.json(
      { error: { http_code: 500, message: 'Falha ao enviar o e-mail.' } },
      { status: 500 },
    )
  }

  return Response.json({})
}
