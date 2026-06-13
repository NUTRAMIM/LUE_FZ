import {
  confirmSignupTemplate,
  resetPasswordTemplate,
  genericAuthTemplate,
  type EmailTemplate,
} from './templates'

/** Campos do `email_data` do payload do Send Email Hook que usamos. */
export interface HookEmailData {
  token_hash: string
  email_action_type: string
}

/** Para onde `/auth/confirm` redireciona após verificar o token. */
export function nextFor(actionType: string): string {
  if (actionType === 'recovery') return '/reset-password'
  return '/painel'
}

/** Escolhe o template pelo tipo de ação; desconhecido cai no genérico. */
export function pickTemplate(actionType: string): EmailTemplate {
  switch (actionType) {
    case 'signup':
      return confirmSignupTemplate
    case 'recovery':
      return resetPasswordTemplate
    default:
      return genericAuthTemplate
  }
}

// Monta o link de ação que vai no e-mail, apontando para /auth/confirm.
// `baseUrl` é a URL pública da app (getAppUrl()), NÃO o `site_url` do payload do
// Supabase — assim o link não depende da config "Site URL" do dashboard, que é
// fácil de errar e mandaria o usuário pra um host errado (ex.: *.supabase.co).
export function buildActionUrl(data: HookEmailData, baseUrl: string): string {
  const params = new URLSearchParams({
    token_hash: data.token_hash,
    type: data.email_action_type,
    next: nextFor(data.email_action_type),
  })
  return `${baseUrl}/auth/confirm?${params.toString()}`
}
